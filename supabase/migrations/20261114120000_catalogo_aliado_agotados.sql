-- Catálogo de aliados con las mismas reglas del público (decisión de los socios, 14 nov 2026):
-- solo productos marcados para el catálogo, activos y con foto; sin piezas disponibles salen como
-- agotados ('opciones' vacío, al final de su categoría). Un producto sin precio de aliado (ni fijo ni
-- de su categoría) ya no se oculta: llega con precio_cop null ("Precio por confirmar") y no se le
-- puede registrar una venta a aliado hasta tener precio (registrar_venta_aliado ya lo rechaza).

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

  select coalesce(jsonb_agg(x.producto order by x.categoria, x.agotado, x.nombre), '[]'::jsonb) into v_productos
  from (
    select
      c.nombre as categoria,
      p.nombre,
      not exists (select 1 from public.unidades u where u.producto_id = p.id and u.estado = 'disponible') as agotado,
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
        'opciones', coalesce((
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
        ), '[]'::jsonb)
      ) as producto
    from public.productos p
    join public.categorias c on c.id = p.categoria_id
    where p.publicado and p.activo and c.activa
      and exists (select 1 from public.fotos_producto f where f.producto_id = p.id)
  ) x;

  return jsonb_build_object('aliado', privado.primer_nombre(v_aliado.nombre), 'productos', v_productos);
end
$$;
