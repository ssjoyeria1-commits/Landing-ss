-- Cajas de premio del Círculo (decisiones de los socios, 11 nov 2026): cada premio lleva su propio chip. Al
-- escanearlo se ve la bienvenida con el nombre, el premio que acaba de conseguir (nombre del nivel y una nota
-- opcional, p. ej. el diseño o el peso), su certificado y su avance en el Círculo.
-- - El premio (y su chip) se crea solo apenas el cliente llega al nivel: después de cada venta o anulación se
--   revisa el contador del cliente y el de quien lo refirió. "Marcar entregado" solo anota la fecha de entrega
--   (premios.fecha_entrega queda vacía mientras está pendiente). Si una anulación lo baja de nivel, el premio
--   no entregado se borra; los entregados no se tocan.
-- - premios.codigo_chip y premios.referencia: con el mismo formato que los de las cajas; los generadores revisan
--   las dos tablas para no repetir.
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

-- Pendiente = sin fecha de entrega.
alter table public.premios
  alter column fecha_entrega drop not null,
  alter column fecha_entrega drop default;

-- Crea los premios que el cliente ya alcanzó (con su chip) y borra los no entregados que ya no le corresponden.
create function privado.sincronizar_premios(p_cliente uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_interacciones int;
begin
  if p_cliente is null then
    return;
  end if;
  select k.interacciones into v_interacciones from privado.circulo_conteo() k where k.cliente_id = p_cliente;
  v_interacciones := coalesce(v_interacciones, 0);
  insert into public.premios (cliente_id, hito, fecha_entrega)
  select p_cliente, h, null from unnest(privado.circulo_hitos()) h where h <= v_interacciones
  on conflict (cliente_id, hito) do nothing;
  delete from public.premios
  where cliente_id = p_cliente and hito > v_interacciones and fecha_entrega is null;
end
$$;

-- Después de cada venta (o anulación): el comprador y quien lo refirió.
create function privado.ventas_premios()
returns trigger
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform privado.sincronizar_premios(new.cliente_id);
  perform privado.sincronizar_premios((select c.referido_por from public.clientes c where c.id = new.cliente_id));
  if tg_op = 'UPDATE' and old.cliente_id is distinct from new.cliente_id then
    perform privado.sincronizar_premios(old.cliente_id);
    perform privado.sincronizar_premios((select c.referido_por from public.clientes c where c.id = old.cliente_id));
  end if;
  return null;
end
$$;

create trigger ventas_premios
after insert or update of anulada, monto_cop, cliente_id on public.ventas
for each row execute function privado.ventas_premios();

revoke execute on function privado.sincronizar_premios(uuid), privado.ventas_premios() from public, anon;

-- Los clientes que ya alcanzaron niveles reciben sus premios pendientes (con chip).
do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.clientes loop
    perform privado.sincronizar_premios(v_id);
  end loop;
end
$$;

create or replace view public.clientes_circulo
with (security_invoker = true)
as
select
  c.id,
  c.nombre,
  c.apellido,
  c.whatsapp,
  c.codigo_referido,
  c.referido_por,
  ref.codigo_referido as referido_por_codigo,
  c.autorizo_datos,
  c.autorizo_datos_fecha,
  c.created_at,
  k.propias,
  k.por_referidos,
  k.interacciones,
  (select min(h) from unnest(privado.circulo_hitos()) h where h > k.interacciones) as proximo_hito,
  array(
    select h from unnest(privado.circulo_hitos()) h
    where h <= k.interacciones
      and not exists (select 1 from public.premios p where p.cliente_id = c.id and p.hito = h and p.fecha_entrega is not null)
    order by h
  ) as premios_pendientes
from public.clientes c
join privado.circulo_conteo() k on k.cliente_id = c.id
left join public.clientes ref on ref.id = c.referido_por;

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
      'fecha', coalesce(v_premio.fecha_entrega, v_premio.created_at::date),
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
