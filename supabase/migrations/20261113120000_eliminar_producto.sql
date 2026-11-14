-- Eliminar un producto creado por error (decisión de los socios, 13 nov 2026).
-- Se borran el producto, sus piezas (disponibles o dadas de baja), sus fotos, conteos y ajustes, y los
-- lotes que quedan sin ninguna pieza. Si alguna pieza suya salió en una venta (aunque esté anulada),
-- no se elimina: las ventas, la contabilidad y las páginas de los chips la necesitan; se desactiva.

-- Las piezas dadas de baja son historia y no se borran, salvo dentro de eliminar_producto, que marca
-- la transacción con privado.eliminando_producto.
create or replace function privado.unidades_proteger_historia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado <> 'disponible' then
    if tg_op = 'DELETE' then
      if old.estado = 'baja' and current_setting('privado.eliminando_producto', true) = 'si' then
        return old;
      end if;
      raise exception 'No se puede borrar una pieza %', old.estado;
    end if;
    if new.peso_gramos <> old.peso_gramos or new.producto_id <> old.producto_id or new.lote_id <> old.lote_id then
      raise exception 'No se puede cambiar una pieza %', old.estado;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

-- Devuelve cuántas piezas y lotes se borraron y los ids de las fotos (el panel borra sus archivos).
create function public.eliminar_producto(p_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_lotes uuid[];
  v_fotos jsonb;
  v_piezas int;
  v_lotes_borrados int;
begin
  if not privado.es_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if not exists (select 1 from public.productos where id = p_id) then
    raise exception 'El producto no existe';
  end if;
  if exists (
    select 1
    from public.unidades u
    where u.producto_id = p_id
      and (u.estado = 'vendida' or exists (select 1 from public.piezas pz where pz.unidad_id = u.id))
  ) then
    raise exception 'Este producto tiene piezas vendidas: no se puede eliminar. Desactívalo para que no salga en venta ni en el catálogo.';
  end if;

  perform set_config('privado.eliminando_producto', 'si', true);

  select coalesce(array_agg(distinct lote_id), '{}') into v_lotes from public.unidades where producto_id = p_id;
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_fotos from public.fotos_producto where producto_id = p_id;

  -- Los ajustes de cada pieza se van con ella (on delete cascade).
  delete from public.unidades where producto_id = p_id;
  get diagnostics v_piezas = row_count;
  delete from public.conteos where producto_id = p_id;
  -- Las fotos se van con el producto (on delete cascade).
  delete from public.productos where id = p_id;

  delete from public.lotes l
  where l.id = any (v_lotes)
    and not exists (select 1 from public.unidades u where u.lote_id = l.id);
  get diagnostics v_lotes_borrados = row_count;

  perform set_config('privado.eliminando_producto', '', true);

  return jsonb_build_object('piezas', v_piezas, 'lotes', v_lotes_borrados, 'fotos', v_fotos);
end
$$;

revoke execute on function public.eliminar_producto(uuid) from public, anon;
grant execute on function public.eliminar_producto(uuid) to authenticated;
