-- Catálogo público: los productos publicados con foto pero sin piezas disponibles salen como agotados
-- (decisión de los socios, 13 nov 2026). Llegan con 'opciones' vacío y van al final de su categoría.
-- Sigue sin decir cuántas piezas hay.

create or replace function public.catalogo_publico()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.producto order by x.categoria, x.agotado, x.nombre), '[]'::jsonb)
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
          select jsonb_agg(jsonb_build_object('peso_gramos', o.peso_gramos, 'precio_cop', o.precio_cop) order by o.peso_gramos)
          from (
            select distinct u.peso_gramos, coalesce(p.precio_unitario_cop, round(u.peso_gramos * c.precio_gramo_cop)::bigint) as precio_cop
            from public.unidades u
            where u.producto_id = p.id and u.estado = 'disponible'
          ) o
        ), '[]'::jsonb)
      ) as producto
    from public.productos p
    join public.categorias c on c.id = p.categoria_id
    where p.publicado and p.activo and c.activa
      and exists (select 1 from public.fotos_producto f where f.producto_id = p.id)
  ) x
$$;
