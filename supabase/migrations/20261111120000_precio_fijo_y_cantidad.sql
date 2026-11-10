-- Precio fijo por unidad y venta por cantidad (decisión de los socios, 10 nov 2026, para la balinería: el
-- precio por gramo da muy por debajo del mercado y casi siempre se vende en cantidad).
-- - Cada referencia puede tener un precio fijo por unidad (productos.precio_unitario_cop) que reemplaza
--   peso × precio por gramo de la categoría en ventas, catálogo e inventario; y un precio fijo de aliado
--   (precio_aliado_unitario_cop). Sin ellos todo sigue igual. Las ventas ya registradas no cambian.
-- - registrar_venta acepta piezas como {producto_id, peso_gramos, cantidad}: toma esa cantidad de piezas
--   del lote más antiguo (igual que la venta a aliados).

alter table public.productos
  add column precio_unitario_cop bigint check (precio_unitario_cop > 0),
  add column precio_aliado_unitario_cop bigint check (precio_aliado_unitario_cop > 0);

create or replace view public.productos_catalogo
with (security_invoker = true)
as
select
  p.id,
  p.codigo,
  p.nombre,
  p.categoria_id,
  c.nombre as categoria,
  c.precio_gramo_cop,
  c.mano_obra_gramo_cop,
  p.stock_minimo,
  p.activo and c.activa as activo,
  p.nota,
  p.created_at,
  p.publicado,
  p.descripcion_publica,
  c.precio_aliado_gramo_cop,
  p.precio_unitario_cop,
  p.precio_aliado_unitario_cop
from public.productos p
join public.categorias c on c.id = p.categoria_id;

create or replace view public.unidades_detalle
with (security_invoker = true)
as
select
  u.id,
  u.lote_id,
  l.fecha as lote_fecha,
  pr.nombre as proveedor,
  u.producto_id,
  p.codigo,
  p.nombre as producto,
  c.nombre as categoria,
  u.peso_gramos,
  u.estado,
  l.oro_gramo_cop,
  u.mano_obra_gramo_cop,
  round(u.peso_gramos * (l.oro_gramo_cop + u.mano_obra_gramo_cop))::bigint as costo_cop,
  coalesce(p.precio_unitario_cop, round(u.peso_gramos * c.precio_gramo_cop)::bigint) as precio_cop,
  u.created_at,
  coalesce(p.precio_aliado_unitario_cop, round(u.peso_gramos * c.precio_aliado_gramo_cop)::bigint) as precio_aliado_cop
from public.unidades u
join public.lotes l on l.id = u.lote_id
left join public.proveedores pr on pr.id = l.proveedor_id
join public.productos p on p.id = u.producto_id
join public.categorias c on c.id = p.categoria_id;

create or replace function public.catalogo_publico()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.producto order by x.categoria, x.nombre), '[]'::jsonb)
  from (
    select
      c.nombre as categoria,
      p.nombre,
      jsonb_build_object(
        'codigo', p.codigo,
        'nombre', p.nombre,
        'descripcion', p.descripcion_publica,
        'categoria', c.nombre,
        'fotos', (
          select jsonb_agg(f.producto_id || '/' || f.id order by f.orden, f.created_at)
          from public.fotos_producto f
          where f.producto_id = p.id
        ),
        'opciones', (
          select jsonb_agg(jsonb_build_object('peso_gramos', o.peso_gramos, 'precio_cop', o.precio_cop) order by o.peso_gramos)
          from (
            select distinct u.peso_gramos, coalesce(p.precio_unitario_cop, round(u.peso_gramos * c.precio_gramo_cop)::bigint) as precio_cop
            from public.unidades u
            where u.producto_id = p.id and u.estado = 'disponible'
          ) o
        )
      ) as producto
    from public.productos p
    join public.categorias c on c.id = p.categoria_id
    where p.publicado and p.activo and c.activa
      and exists (select 1 from public.fotos_producto f where f.producto_id = p.id)
      and exists (select 1 from public.unidades u where u.producto_id = p.id and u.estado = 'disponible')
  ) x
$$;

create or replace function public.catalogo_aliado(p_token text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_aliado public.aliados;
  v_productos jsonb;
begin
  if p_token is null or p_token !~ '^[a-km-np-z2-9]{20}$' then
    return null;
  end if;
  select * into v_aliado from public.aliados where token = p_token and activo;
  if not found then
    return null;
  end if;
  update public.aliados set ultimo_acceso = now() where id = v_aliado.id;

  select coalesce(jsonb_agg(x.producto order by x.categoria, x.nombre), '[]'::jsonb) into v_productos
  from (
    select
      c.nombre as categoria,
      p.nombre,
      jsonb_build_object(
        'codigo', p.codigo,
        'nombre', p.nombre,
        'descripcion', p.descripcion_publica,
        'categoria', c.nombre,
        'fotos', (
          select jsonb_agg(f.producto_id || '/' || f.id order by f.orden, f.created_at)
          from public.fotos_producto f
          where f.producto_id = p.id
        ),
        'opciones', (
          select jsonb_agg(
            jsonb_build_object(
              'peso_gramos', o.peso_gramos,
              'precio_cop', coalesce(p.precio_aliado_unitario_cop, round(o.peso_gramos * c.precio_aliado_gramo_cop)::bigint),
              'precio_publico_cop', coalesce(p.precio_unitario_cop, round(o.peso_gramos * c.precio_gramo_cop)::bigint),
              'cantidad', o.cantidad
            )
            order by o.peso_gramos
          )
          from (
            select u.peso_gramos, count(*)::int as cantidad
            from public.unidades u
            where u.producto_id = p.id and u.estado = 'disponible'
            group by u.peso_gramos
          ) o
        )
      ) as producto
    from public.productos p
    join public.categorias c on c.id = p.categoria_id
    where p.activo and c.activa and (p.precio_aliado_unitario_cop is not null or c.precio_aliado_gramo_cop is not null)
      and exists (select 1 from public.fotos_producto f where f.producto_id = p.id)
      and exists (select 1 from public.unidades u where u.producto_id = p.id and u.estado = 'disponible')
  ) x;

  return jsonb_build_object('aliado', privado.primer_nombre(v_aliado.nombre), 'productos', v_productos);
end
$$;

create or replace function public.registrar_venta_aliado(p jsonb)
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
  where d.id = any (v_todas) and d.precio_aliado_cop is null
  limit 1;
  if v_sin_precio is not null then
    raise exception 'La referencia % no tiene precio para aliados', v_sin_precio;
  end if;

  select sum(d.precio_aliado_cop)::bigint into v_subtotal
  from public.unidades_detalle d
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
    d.id, d.precio_aliado_cop, d.costo_cop
  from public.unidades_detalle d
  where d.id = any (v_todas);

  update public.unidades set estado = 'vendida' where id = any (v_todas);

  return jsonb_build_object('venta_id', v_venta_id, 'monto_cop', v_subtotal - v_descuento, 'referencia', v_ref);
end
$$;

create or replace function public.registrar_venta(p jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_whatsapp text := btrim(p -> 'cliente' ->> 'whatsapp');
  v_autoriza boolean := coalesce((p -> 'cliente' ->> 'autorizo_datos')::boolean, false);
  v_fecha_autoriza date := coalesce((p -> 'cliente' ->> 'autorizo_datos_fecha')::date, privado.hoy());
  v_codigo_referidor text := nullif(upper(btrim(p ->> 'codigo_referido_de')), '');
  v_cliente public.clientes;
  v_creado boolean := false;
  v_referidor uuid;
  v_venta_id uuid;
  v_caja jsonb;
  v_caja_id uuid;
  v_es_regalo boolean;
  v_codigo text;
  v_ref text;
  v_cajas jsonb := '[]'::jsonb;
  v_piezas jsonb;
  v_pieza jsonb;
  v_unidad record;
  v_unidades uuid[];
  v_con_precio int;
  v_total_piezas int;
  v_subtotal bigint := 0;
  v_descuento bigint := coalesce((p ->> 'descuento_cop')::bigint, 0);
  v_monto bigint;
  v_orden int;
  v_nuevas jsonb := '[]'::jsonb;
  v_lista jsonb;
  v_elegidas uuid[];
  v_ids uuid[];
  v_cantidad int;
begin
  if not privado.es_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if jsonb_typeof(p -> 'cajas') is distinct from 'array' or jsonb_array_length(p -> 'cajas') = 0 then
    raise exception 'La venta debe tener al menos una caja';
  end if;

  -- Piezas por cantidad: {producto_id, peso_gramos, cantidad} pasa a ser esa cantidad de piezas del
  -- inventario de ese producto y peso, las del lote más antiguo (sin repetir las que ya vienen elegidas).
  if jsonb_typeof(p -> 'cajas') = 'array' then
    select coalesce(array_agg((x ->> 'unidad_id')::uuid), '{}') into v_elegidas
    from jsonb_array_elements(p -> 'cajas') c, jsonb_array_elements(coalesce(c -> 'piezas', '[]'::jsonb)) x
    where nullif(x ->> 'unidad_id', '') is not null;
    for v_caja in select * from jsonb_array_elements(p -> 'cajas') loop
      v_lista := '[]'::jsonb;
      for v_pieza in select * from jsonb_array_elements(coalesce(v_caja -> 'piezas', '[]'::jsonb)) loop
        if nullif(v_pieza ->> 'producto_id', '') is null then
          v_lista := v_lista || jsonb_build_array(v_pieza);
          continue;
        end if;
        v_cantidad := coalesce((v_pieza ->> 'cantidad')::int, 1);
        if v_cantidad < 1 or v_cantidad > 1000 then
          raise exception 'La cantidad debe estar entre 1 y 1000';
        end if;
        select array_agg(x.id) into v_ids
        from (
          select u.id
          from public.unidades u
          join public.lotes l on l.id = u.lote_id
          where u.producto_id = (v_pieza ->> 'producto_id')::uuid
            and u.peso_gramos = (v_pieza ->> 'peso_gramos')::numeric
            and u.estado = 'disponible'
            and not (u.id = any (v_elegidas))
          order by l.fecha, u.created_at
          limit v_cantidad
          for update of u
        ) x;
        if coalesce(cardinality(v_ids), 0) < v_cantidad then
          raise exception 'No hay % piezas disponibles de ese producto con % g', v_cantidad, v_pieza ->> 'peso_gramos';
        end if;
        v_elegidas := v_elegidas || v_ids;
        select v_lista || jsonb_agg(jsonb_build_object('unidad_id', i)) into v_lista from unnest(v_ids) i;
      end loop;
      v_nuevas := v_nuevas || jsonb_build_array(jsonb_set(v_caja, '{piezas}', v_lista));
    end loop;
    p := jsonb_set(p, '{cajas}', v_nuevas);
  end if;

  -- Todas las piezas, de todas las cajas.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_piezas
  from jsonb_array_elements(p -> 'cajas') c, jsonb_array_elements(c -> 'piezas') x;
  v_total_piezas := jsonb_array_length(v_piezas);
  select count(*) into v_con_precio
  from jsonb_array_elements(v_piezas) x
  where nullif(x ->> 'unidad_id', '') is not null or (x ->> 'precio_cop') is not null;

  -- Piezas del inventario: deben existir y estar disponibles; se bloquean hasta terminar.
  select coalesce(array_agg((x ->> 'unidad_id')::uuid), '{}') into v_unidades
  from jsonb_array_elements(v_piezas) x
  where nullif(x ->> 'unidad_id', '') is not null;
  if cardinality(v_unidades) <> (select count(distinct u) from unnest(v_unidades) u) then
    raise exception 'La misma pieza del inventario está dos veces en la venta';
  end if;
  perform 1 from public.unidades where id = any (v_unidades) for update;
  if (select count(*) from public.unidades where id = any (v_unidades)) <> cardinality(v_unidades) then
    raise exception 'Una de las piezas elegidas no existe en el inventario';
  end if;
  select d.codigo, d.peso_gramos into v_unidad
  from public.unidades_detalle d
  where d.id = any (v_unidades) and d.estado <> 'disponible'
  limit 1;
  if found then
    raise exception 'La pieza % de % g ya no está disponible', v_unidad.codigo, v_unidad.peso_gramos;
  end if;

  -- Monto: suma de los precios de las piezas menos el descuento. Las ventas sin precios por pieza
  -- (las registradas antes del inventario) siguen mandando el monto total.
  if v_total_piezas > 0 and v_con_precio = v_total_piezas then
    select coalesce(sum(case
        when nullif(x ->> 'unidad_id', '') is not null then d.precio_cop
        else (x ->> 'precio_cop')::bigint
      end), 0)
    into v_subtotal
    from jsonb_array_elements(v_piezas) x
    left join public.unidades_detalle d on d.id = nullif(x ->> 'unidad_id', '')::uuid;
    if v_descuento < 0 or v_descuento >= v_subtotal then
      raise exception 'El descuento debe ser menor que el valor de las piezas';
    end if;
    v_monto := v_subtotal - v_descuento;
  elsif v_con_precio = 0 then
    v_monto := (p ->> 'monto_cop')::bigint;
    v_descuento := 0;
  else
    raise exception 'Todas las piezas deben tener precio (del inventario o escrito a mano)';
  end if;

  select * into v_cliente from public.clientes where whatsapp = v_whatsapp for update;

  if found then
    if v_codigo_referidor is not null then
      raise exception 'Solo se puede asignar un referido a un cliente nuevo; este cliente ya está registrado (%)',
        v_cliente.codigo_referido;
    end if;
    if v_autoriza and not v_cliente.autorizo_datos then
      update public.clientes
      set autorizo_datos = true, autorizo_datos_fecha = v_fecha_autoriza
      where id = v_cliente.id
      returning * into v_cliente;
    end if;
  else
    if not v_autoriza then
      raise exception 'Falta la autorización de tratamiento de datos del cliente';
    end if;
    if v_codigo_referidor is not null then
      select id into v_referidor from public.clientes where codigo_referido = v_codigo_referidor;
      if not found then
        raise exception 'No existe el código de referido %', v_codigo_referidor;
      end if;
    end if;
    insert into public.clientes
      (nombre, apellido, whatsapp, codigo_referido, referido_por, autorizo_datos, autorizo_datos_fecha)
    values (
      btrim(p -> 'cliente' ->> 'nombre'),
      nullif(btrim(p -> 'cliente' ->> 'apellido'), ''),
      v_whatsapp,
      privado.nuevo_codigo_referido(p -> 'cliente' ->> 'nombre'),
      v_referidor,
      true,
      v_fecha_autoriza
    )
    returning * into v_cliente;
    v_creado := true;
  end if;

  insert into public.ventas (cliente_id, fecha, monto_cop, descuento_cop, nota)
  values (
    v_cliente.id,
    coalesce((p ->> 'fecha')::date, privado.hoy()),
    v_monto,
    v_descuento,
    nullif(btrim(p ->> 'nota'), '')
  )
  returning id into v_venta_id;

  for v_caja in select * from jsonb_array_elements(p -> 'cajas') loop
    if jsonb_typeof(v_caja -> 'piezas') is distinct from 'array' or jsonb_array_length(v_caja -> 'piezas') = 0 then
      raise exception 'Cada caja debe tener al menos una pieza';
    end if;

    v_es_regalo := coalesce((v_caja ->> 'es_regalo')::boolean, false);
    v_codigo := privado.nuevo_codigo_chip();
    v_ref := privado.nueva_referencia();

    insert into public.cajas (venta_id, codigo_chip, referencia, es_regalo, nombre_destinatario, mensaje_regalo)
    values (
      v_venta_id, v_codigo, v_ref, v_es_regalo,
      case when v_es_regalo then nullif(btrim(v_caja ->> 'nombre_destinatario'), '') end,
      case when v_es_regalo then nullif(btrim(v_caja ->> 'mensaje_regalo'), '') end
    )
    returning id into v_caja_id;

    v_orden := 0;
    for v_pieza in select * from jsonb_array_elements(v_caja -> 'piezas') loop
      if nullif(v_pieza ->> 'unidad_id', '') is not null then
        -- Del inventario: descripción, peso, precio y costo salen de la pieza y quedan congelados.
        insert into public.piezas (caja_id, descripcion, peso_gramos, ley, orden, unidad_id, precio_cop, costo_cop)
        select v_caja_id, d.producto, d.peso_gramos, '18k', v_orden, d.id, d.precio_cop, d.costo_cop
        from public.unidades_detalle d
        where d.id = (v_pieza ->> 'unidad_id')::uuid;
      else
        insert into public.piezas (caja_id, descripcion, peso_gramos, ley, orden, precio_cop)
        values (
          v_caja_id,
          btrim(v_pieza ->> 'descripcion'),
          (v_pieza ->> 'peso_gramos')::numeric,
          coalesce(nullif(btrim(v_pieza ->> 'ley'), ''), '18k'),
          v_orden,
          (v_pieza ->> 'precio_cop')::bigint
        );
      end if;
      v_orden := v_orden + 1;
    end loop;

    v_cajas := v_cajas || jsonb_build_object(
      'id', v_caja_id, 'codigo_chip', v_codigo, 'referencia', v_ref, 'es_regalo', v_es_regalo
    );
  end loop;

  update public.unidades set estado = 'vendida' where id = any (v_unidades);

  return jsonb_build_object(
    'venta_id', v_venta_id,
    'monto_cop', v_monto,
    'cliente', jsonb_build_object(
      'id', v_cliente.id,
      'nombre', v_cliente.nombre,
      'codigo_referido', v_cliente.codigo_referido,
      'creado', v_creado
    ),
    'cajas', v_cajas
  );
end
$$;
