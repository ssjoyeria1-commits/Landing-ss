-- Fase A4: ventas a aliados.
-- Una venta es de un cliente (como hasta ahora) o de un aliado, nunca de los dos. La de un aliado
-- va a su precio (peso × precio de aliado por gramo de la categoría), no tiene cliente y por eso no
-- cuenta en el Círculo SS de nadie. Queda "pendiente de pago" hasta que se marque pagada. Su caja
-- existe para guardar las piezas, pero no lleva chip: pagina_caja no muestra nada para ella.

alter table public.ventas
  alter column cliente_id drop not null,
  add column aliado_id uuid references public.aliados (id) on delete restrict,
  -- Fecha en que el aliado pagó; null = pendiente. Solo para ventas a aliados.
  add column pagada_aliado_at timestamptz,
  add constraint ventas_cliente_o_aliado check ((cliente_id is null) <> (aliado_id is null)),
  add constraint ventas_pago_solo_aliado check (aliado_id is not null or pagada_aliado_at is null);

create index ventas_aliado_id_idx on public.ventas (aliado_id);

-- ---------------------------------------------------------------------------
-- Página del chip: las cajas de ventas a aliados no muestran nada (no llevan chip)
-- ---------------------------------------------------------------------------

create or replace function public.pagina_caja(p_codigo text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_caja public.cajas;
  v_cliente public.clientes;
  v_piezas jsonb;
  v_interacciones int;
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
    return null;
  end if;

  select cl.* into v_cliente
  from public.clientes cl
  join public.ventas v on v.cliente_id = cl.id
  where v.id = v_caja.venta_id;

  insert into public.escaneos (caja_id) values (v_caja.id);

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
      'nombre_destinatario', v_caja.nombre_destinatario,
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

-- ---------------------------------------------------------------------------
-- API del panel: registrar una venta a un aliado
-- ---------------------------------------------------------------------------

-- p = { aliado_id, fecha?, nota?, descuento_cop?, lineas: [{ producto_id, peso_gramos, cantidad }] }
-- Por cada línea toma esa cantidad de piezas disponibles de ese producto y peso (las del lote más
-- antiguo primero), con su precio de aliado y su costo. Todo o nada. Devuelve venta_id, monto y la
-- referencia de la caja.
create function public.registrar_venta_aliado(p jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_aliado public.aliados;
  v_linea jsonb;
  v_ids uuid[];
  v_todas uuid[] := '{}';
  v_cantidad int;
  v_subtotal bigint;
  v_descuento bigint := coalesce((p ->> 'descuento_cop')::bigint, 0);
  v_venta_id uuid;
  v_caja_id uuid;
  v_ref text;
  v_sin_precio text;
begin
  if not privado.es_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select * into v_aliado from public.aliados where id = (p ->> 'aliado_id')::uuid;
  if not found then
    raise exception 'Aliado no encontrado';
  end if;
  if not v_aliado.activo then
    raise exception 'El aliado % está inactivo', v_aliado.nombre;
  end if;
  if jsonb_typeof(p -> 'lineas') is distinct from 'array' or jsonb_array_length(p -> 'lineas') = 0 then
    raise exception 'Elige al menos una pieza';
  end if;

  for v_linea in select * from jsonb_array_elements(p -> 'lineas') loop
    v_cantidad := (v_linea ->> 'cantidad')::int;
    if v_cantidad is null or v_cantidad <= 0 then
      continue;
    end if;
    select array_agg(id) into v_ids
    from (
      select u.id
      from public.unidades u
      join public.lotes l on l.id = u.lote_id
      where u.producto_id = (v_linea ->> 'producto_id')::uuid
        and u.peso_gramos = (v_linea ->> 'peso_gramos')::numeric
        and u.estado = 'disponible'
        and not (u.id = any (v_todas))
      order by l.fecha, u.created_at
      limit v_cantidad
      for update of u
    ) x;
    if coalesce(cardinality(v_ids), 0) < v_cantidad then
      raise exception 'No hay % piezas disponibles de ese producto con % g', v_cantidad, v_linea ->> 'peso_gramos';
    end if;
    v_todas := v_todas || v_ids;
  end loop;

  if cardinality(v_todas) = 0 then
    raise exception 'Elige al menos una pieza';
  end if;

  -- Toda pieza debe ser de una categoría con precio de aliado.
  select d.codigo into v_sin_precio
  from public.unidades_detalle d
  join public.productos pr on pr.id = d.producto_id
  join public.categorias c on c.id = pr.categoria_id
  where d.id = any (v_todas) and c.precio_aliado_gramo_cop is null
  limit 1;
  if v_sin_precio is not null then
    raise exception 'La categoría de % no tiene precio para aliados', v_sin_precio;
  end if;

  select sum(round(d.peso_gramos * c.precio_aliado_gramo_cop))::bigint into v_subtotal
  from public.unidades_detalle d
  join public.productos pr on pr.id = d.producto_id
  join public.categorias c on c.id = pr.categoria_id
  where d.id = any (v_todas);
  if v_descuento < 0 or v_descuento >= v_subtotal then
    raise exception 'El descuento debe ser menor que el valor de las piezas';
  end if;

  insert into public.ventas (aliado_id, fecha, monto_cop, descuento_cop, nota)
  values (
    v_aliado.id,
    coalesce((p ->> 'fecha')::date, privado.hoy()),
    v_subtotal - v_descuento,
    v_descuento,
    nullif(btrim(p ->> 'nota'), '')
  )
  returning id into v_venta_id;

  -- Una caja interna para las piezas: su código de chip existe pero no abre nada (ver pagina_caja).
  v_ref := privado.nueva_referencia();
  insert into public.cajas (venta_id, codigo_chip, referencia)
  values (v_venta_id, privado.nuevo_codigo_chip(), v_ref)
  returning id into v_caja_id;

  insert into public.piezas (caja_id, descripcion, peso_gramos, ley, orden, unidad_id, precio_cop, costo_cop)
  select
    v_caja_id, d.producto, d.peso_gramos, '18k',
    (row_number() over (order by d.codigo, d.peso_gramos) - 1)::smallint,
    d.id, round(d.peso_gramos * c.precio_aliado_gramo_cop)::bigint, d.costo_cop
  from public.unidades_detalle d
  join public.productos pr on pr.id = d.producto_id
  join public.categorias c on c.id = pr.categoria_id
  where d.id = any (v_todas);

  update public.unidades set estado = 'vendida' where id = any (v_todas);

  return jsonb_build_object('venta_id', v_venta_id, 'monto_cop', v_subtotal - v_descuento, 'referencia', v_ref);
end
$$;

revoke execute on function public.registrar_venta_aliado(jsonb) from public, anon;
grant execute on function public.registrar_venta_aliado(jsonb) to authenticated;
