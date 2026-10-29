-- Fase 4A: catálogo del inventario.
-- Categorías: mano de obra y precio de venta, ambos por gramo (los fija SS Joyería por categoría).
-- Productos: referencias (el diseño). Cada pieza física tiene su propio peso y entra al inventario
-- con su lote en la fase 4B; las existencias de una referencia son sus piezas disponibles.
-- Todas las piezas son de oro de 18 quilates.

alter table public.piezas alter column ley set default '18k';

create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) between 1 and 40),
  -- Costo de la mano de obra por gramo, en pesos (entra en el costo de cada pieza).
  mano_obra_gramo_cop bigint not null check (mano_obra_gramo_cop >= 0),
  -- Precio de venta por gramo, en pesos.
  precio_gramo_cop bigint not null check (precio_gramo_cop > 0),
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

-- Sin dos categorías con el mismo nombre, aunque cambien mayúsculas o espacios.
create unique index categorias_nombre_unico on public.categorias (lower(btrim(nombre)));

create table public.productos (
  id uuid primary key default gen_random_uuid(),
  -- Código de la referencia (el de la etiqueta), p. ej. AN-014.
  codigo text not null unique check (codigo ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  categoria_id uuid not null references public.categorias (id) on delete restrict,
  -- Por debajo de esta cantidad el panel avisa que hay que reponer.
  stock_minimo integer not null default 0 check (stock_minimo >= 0),
  activo boolean not null default true,
  nota text,
  created_at timestamptz not null default now()
);

create index productos_categoria_id_idx on public.productos (categoria_id);

-- Productos con los datos de su categoría (el precio de cada pieza será su peso × el precio por gramo).
create view public.productos_catalogo
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
  p.created_at
from public.productos p
join public.categorias c on c.id = p.categoria_id;

alter table public.categorias enable row level security;
alter table public.productos enable row level security;

create policy admin_todo on public.categorias for all to authenticated
  using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo on public.productos for all to authenticated
  using (privado.es_admin()) with check (privado.es_admin());

-- Supabase da a anon acceso a las tablas nuevas del esquema public: costos y precios son internos.
revoke all on public.categorias, public.productos, public.productos_catalogo from anon;
