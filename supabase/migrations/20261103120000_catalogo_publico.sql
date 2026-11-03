-- Fase C1: catálogo público con fotos.
-- Cada producto (referencia) puede tener hasta 5 fotos y se muestra en /catalogo si los socios lo
-- marcan como publicado, tiene al menos una foto y le queda al menos una pieza disponible. Por cada
-- peso disponible se muestra su precio, sin decir cuántas piezas hay. Costos, cantidades, lotes y
-- proveedor nunca salen al público.

alter table public.productos
  add column publicado boolean not null default false,
  add column descripcion_publica text check (length(descripcion_publica) <= 400);

-- La vista del panel trae también los datos del catálogo (se agregan al final para no romperla).
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
  p.descripcion_publica
from public.productos p
join public.categorias c on c.id = p.categoria_id;

-- Fotos de un producto. Los archivos están en el bucket "catalogo" en
-- {producto_id}/{id}.webp (grande, ~1200 px) y {producto_id}/{id}-mini.webp (cuadrícula, ~480 px).
create table public.fotos_producto (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos (id) on delete cascade,
  orden smallint not null default 0,
  created_at timestamptz not null default now()
);

create index fotos_producto_producto_id_idx on public.fotos_producto (producto_id, orden);

create function privado.fotos_limite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.fotos_producto where producto_id = new.producto_id) >= 5 then
    raise exception 'Un producto puede tener hasta 5 fotos';
  end if;
  return new;
end
$$;

create trigger fotos_limite before insert on public.fotos_producto
for each row execute function privado.fotos_limite();

-- ---------------------------------------------------------------------------
-- API pública: catálogo
-- ---------------------------------------------------------------------------

-- Productos publicados con foto y piezas disponibles. Por producto: código, nombre, descripción,
-- categoría, fotos ({producto_id}/{id}, en orden) y los pesos disponibles con su precio (un peso
-- aparece una vez aunque haya varias piezas de ese peso).
create function public.catalogo_publico()
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
            select distinct u.peso_gramos, round(u.peso_gramos * c.precio_gramo_cop)::bigint as precio_cop
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

-- ---------------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------------

alter table public.fotos_producto enable row level security;
create policy admin_todo on public.fotos_producto for all to authenticated
  using (privado.es_admin()) with check (privado.es_admin());

revoke all on public.fotos_producto from anon;
revoke execute on function privado.fotos_limite() from public, anon;
revoke execute on function public.catalogo_publico() from public;
grant execute on function public.catalogo_publico() to anon, authenticated;

-- Bucket público de fotos: cualquiera puede ver una foto por su dirección (las páginas las enlazan),
-- pero nadie puede listar el bucket y solo los admins suben, cambian o borran. Máximo 600 KB y solo
-- WebP o JPEG (el panel las achica antes de subirlas).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalogo', 'catalogo', true, 614400, array['image/webp', 'image/jpeg']);

create policy catalogo_admin_sube on storage.objects for insert to authenticated
  with check (bucket_id = 'catalogo' and privado.es_admin());
create policy catalogo_admin_cambia on storage.objects for update to authenticated
  using (bucket_id = 'catalogo' and privado.es_admin()) with check (bucket_id = 'catalogo' and privado.es_admin());
create policy catalogo_admin_borra on storage.objects for delete to authenticated
  using (bucket_id = 'catalogo' and privado.es_admin());
-- Subir con "upsert" y borrar necesitan leer el objeto: solo los admins.
create policy catalogo_admin_lee on storage.objects for select to authenticated
  using (bucket_id = 'catalogo' and privado.es_admin());
