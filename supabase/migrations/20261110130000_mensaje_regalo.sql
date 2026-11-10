-- Mensaje personalizado del regalo: el comprador puede dejar un texto que se muestra en la bienvenida
-- de la caja de regalo, debajo del nombre de quien la recibe. Se escribe al registrar la venta o
-- después, en el detalle (sin cambiar el chip). Solo en cajas de regalo, hasta 300 caracteres.

alter table public.cajas
  add column mensaje_regalo text
    check (mensaje_regalo is null or char_length(btrim(mensaje_regalo)) between 1 and 300),
  add constraint cajas_mensaje_solo_regalo check (es_regalo or mensaje_regalo is null);

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
begin
  if not privado.es_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if jsonb_typeof(p -> 'cajas') is distinct from 'array' or jsonb_array_length(p -> 'cajas') = 0 then
    raise exception 'La venta debe tener al menos una caja';
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
