-- Cajas de premio del Círculo (decisión de los socios, 11 nov 2026): cada premio entregado lleva su propio
-- chip. Al escanearlo se ve la bienvenida con el nombre, el premio que acaba de conseguir (nombre del nivel y una
-- nota opcional, p. ej. el diseño o el peso), su certificado y su avance en el Círculo.
-- - premios.codigo_chip y premios.referencia: se generan solos al marcar el premio entregado (y para los que ya
--   estaban), con el mismo formato que los de las cajas; los generadores revisan las dos tablas para no repetir.
-- - premios.detalle: la nota pública del premio (la nota interna sigue en premios.nota).
-- - pagina_caja: si el código no es de una caja, busca un premio y devuelve tipo 'premio'. Sin WhatsApp, precios
--   ni ids. Abrir un chip de premio no suma escaneo (los escaneos son de cajas).

create or replace function privado.nuevo_codigo_chip()
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_codigo text;
begin
  loop
    v_codigo := privado.codigo_aleatorio('abcdefghijkmnpqrstuvwxyz23456789', 10);
    exit when not exists (select 1 from public.cajas where codigo_chip = v_codigo)
      and not exists (select 1 from public.premios where codigo_chip = v_codigo);
  end loop;
  return v_codigo;
end
$$;

create or replace function privado.nueva_referencia()
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_ref text;
begin
  loop
    v_ref := 'SS-' || privado.codigo_aleatorio('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 5);
    exit when not exists (select 1 from public.cajas where referencia = v_ref)
      and not exists (select 1 from public.premios where referencia = v_ref);
  end loop;
  return v_ref;
end
$$;

alter table public.premios
  add column codigo_chip text unique check (codigo_chip ~ '^[a-km-np-z2-9]{10}$'),
  add column referencia text unique check (referencia ~ '^SS-[A-HJ-NP-Z2-9]{5}$'),
  add column detalle text check (detalle is null or char_length(btrim(detalle)) between 1 and 120);

-- Los premios ya entregados también reciben su chip.
do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.premios where codigo_chip is null loop
    update public.premios
    set codigo_chip = privado.nuevo_codigo_chip(), referencia = privado.nueva_referencia()
    where id = v_id;
  end loop;
end
$$;

alter table public.premios
  alter column codigo_chip set default privado.nuevo_codigo_chip(),
  alter column codigo_chip set not null,
  alter column referencia set default privado.nueva_referencia(),
  alter column referencia set not null;

-- Los valores por defecto llaman a estas funciones al insertar desde el panel.
grant execute on function privado.nuevo_codigo_chip(), privado.nueva_referencia(), privado.codigo_aleatorio(text, int)
  to authenticated;

create or replace function public.pagina_caja(p_codigo text, p_contar boolean default true)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_caja public.cajas;
  v_cliente public.clientes;
  v_piezas jsonb;
  v_interacciones int;
  v_fecha date;
  v_premio public.premios;
begin
  if p_codigo is null or p_codigo !~ '^[a-km-np-z2-9]{10}$' then
    return null;
  end if;

  -- Solo ventas vigentes de un cliente (las de aliados no llevan chip).
  select ca.* into v_caja
  from public.cajas ca
  join public.ventas v on v.id = ca.venta_id
  where ca.codigo_chip = p_codigo and not v.anulada and v.cliente_id is not null;
  if not found then
    -- Caja de premio del Círculo: su propio chip, con el premio y el avance del cliente.
    select pr.* into v_premio from public.premios pr where pr.codigo_chip = p_codigo;
    if not found then
      return null;
    end if;
    select cl.* into v_cliente from public.clientes cl where cl.id = v_premio.cliente_id;
    select k.interacciones into v_interacciones
    from privado.circulo_conteo() k
    where k.cliente_id = v_cliente.id;
    return jsonb_build_object(
      'tipo', 'premio',
      'referencia', v_premio.referencia,
      'fecha', v_premio.fecha_entrega,
      'nombre', privado.primer_nombre(v_cliente.nombre),
      'hito', v_premio.hito,
      'detalle', v_premio.detalle,
      'circulo', jsonb_build_object(
        'interacciones', v_interacciones,
        'hitos', to_jsonb(privado.circulo_hitos()),
        'proximo_hito', (select min(h) from unnest(privado.circulo_hitos()) h where h > v_interacciones),
        'codigo_referido', v_cliente.codigo_referido
      )
    );
  end if;

  select cl.* into v_cliente
  from public.clientes cl
  join public.ventas v on v.cliente_id = cl.id
  where v.id = v_caja.venta_id;

  select v.fecha into v_fecha from public.ventas v where v.id = v_caja.venta_id;

  if p_contar then
    insert into public.escaneos (caja_id) values (v_caja.id);
  end if;

  select coalesce(jsonb_agg(
      jsonb_build_object('descripcion', p.descripcion, 'peso_gramos', p.peso_gramos, 'ley', p.ley)
      order by p.orden, p.descripcion
    ), '[]'::jsonb)
  into v_piezas
  from public.piezas p
  where p.caja_id = v_caja.id;

  if v_caja.es_regalo then
    -- Sin el contador del comprador: solo su primer nombre y su código para el mensaje de WhatsApp.
    return jsonb_build_object(
      'tipo', 'regalo',
      'referencia', v_caja.referencia,
      'fecha', v_fecha,
      'nombre_destinatario', v_caja.nombre_destinatario,
      'mensaje', v_caja.mensaje_regalo,
      'nombre_comprador', privado.primer_nombre(v_cliente.nombre),
      'codigo_referido_comprador', v_cliente.codigo_referido,
      'piezas', v_piezas
    );
  end if;

  select k.interacciones into v_interacciones
  from privado.circulo_conteo() k
  where k.cliente_id = v_cliente.id;

  return jsonb_build_object(
    'tipo', 'propia',
    'referencia', v_caja.referencia,
    'fecha', v_fecha,
    'nombre', privado.primer_nombre(v_cliente.nombre),
    'piezas', v_piezas,
    'circulo', jsonb_build_object(
      'interacciones', v_interacciones,
      'hitos', to_jsonb(privado.circulo_hitos()),
      'proximo_hito', (select min(h) from unnest(privado.circulo_hitos()) h where h > v_interacciones),
      'codigo_referido', v_cliente.codigo_referido
    )
  );
end
$$;
