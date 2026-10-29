-- Fase 4B: lotes y existencias.
-- Cada lote trae el costo del oro por gramo con que se fabricó. Cada pieza física del lote tiene su
-- referencia (producto) y su propio peso. Las existencias son las piezas disponibles.
--   costo de una pieza  = peso × (oro por gramo del lote + mano de obra por gramo de su categoría)
--   precio de una pieza = peso × precio por gramo de su categoría (el del día; la venta lo congela en 4C)
-- La mano de obra se copia a la pieza al entrar, para que un cambio posterior en la categoría no
-- altere el costo de lo que ya está en inventario. El oro se lee del lote: si se corrige el lote, se
-- corrige el costo de sus piezas.

create table public.proveedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) between 1 and 80),
  contacto text,
  nota text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index proveedores_nombre_unico on public.proveedores (lower(btrim(nombre)));

create table public.lotes (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid references public.proveedores (id) on delete restrict,
  fecha date not null default privado.hoy(),
  -- Lo que costó el gramo de oro con que se hizo este lote, en pesos.
  oro_gramo_cop bigint not null check (oro_gramo_cop > 0),
  nota text,
  creado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index lotes_proveedor_id_idx on public.lotes (proveedor_id);

create table public.unidades (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.lotes (id) on delete cascade,
  producto_id uuid not null references public.productos (id) on delete restrict,
  peso_gramos numeric(7, 2) not null check (peso_gramos > 0),
  -- Copiada de la categoría al entrar (ver privado.unidades_copiar_mano_obra).
  mano_obra_gramo_cop bigint not null check (mano_obra_gramo_cop >= 0),
  -- disponible: en vitrina; vendida: salió en una venta (fase 4C); baja: pérdida o ajuste (fase 4E).
  estado text not null default 'disponible' check (estado in ('disponible', 'vendida', 'baja')),
  created_at timestamptz not null default now()
);

create index unidades_lote_id_idx on public.unidades (lote_id);
create index unidades_producto_estado_idx on public.unidades (producto_id, estado);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function privado.unidades_copiar_mano_obra()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  select c.mano_obra_gramo_cop into new.mano_obra_gramo_cop
  from public.productos p
  join public.categorias c on c.id = p.categoria_id
  where p.id = new.producto_id;
  return new;
end
$$;

create trigger unidades_copiar_mano_obra
before insert on public.unidades
for each row execute function privado.unidades_copiar_mano_obra();

-- Una pieza vendida o dada de baja es historia: no se borra ni cambia de peso o de referencia.
create function privado.unidades_proteger_historia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado <> 'disponible' then
    if tg_op = 'DELETE' then
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

create trigger unidades_proteger_historia
before update or delete on public.unidades
for each row execute function privado.unidades_proteger_historia();

-- ---------------------------------------------------------------------------
-- Vistas
-- ---------------------------------------------------------------------------

-- Cada pieza con su referencia, lote, costo y precio del día.
create view public.unidades_detalle
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
  round(u.peso_gramos * c.precio_gramo_cop)::bigint as precio_cop,
  u.created_at
from public.unidades u
join public.lotes l on l.id = u.lote_id
left join public.proveedores pr on pr.id = l.proveedor_id
join public.productos p on p.id = u.producto_id
join public.categorias c on c.id = p.categoria_id;

-- Existencias por referencia: piezas y gramos disponibles, costo y valor de venta del día.
create view public.existencias
with (security_invoker = true)
as
select
  pc.id,
  pc.codigo,
  pc.nombre,
  pc.categoria_id,
  pc.categoria,
  pc.precio_gramo_cop,
  pc.stock_minimo,
  pc.activo,
  count(d.id)::int as disponibles,
  coalesce(sum(d.peso_gramos), 0)::numeric(10, 2) as gramos,
  coalesce(sum(d.costo_cop), 0)::bigint as costo_cop,
  coalesce(sum(d.precio_cop), 0)::bigint as valor_cop,
  count(d.id) < pc.stock_minimo as bajo_minimo
from public.productos_catalogo pc
left join public.unidades_detalle d on d.producto_id = pc.id and d.estado = 'disponible'
group by pc.id, pc.codigo, pc.nombre, pc.categoria_id, pc.categoria, pc.precio_gramo_cop, pc.stock_minimo, pc.activo;

-- Lotes con su número de piezas, gramos y costo total.
create view public.lotes_resumen
with (security_invoker = true)
as
select
  l.id,
  l.fecha,
  l.proveedor_id,
  pr.nombre as proveedor,
  l.oro_gramo_cop,
  l.nota,
  l.created_at,
  count(d.id)::int as piezas,
  count(d.id) filter (where d.estado = 'disponible')::int as disponibles,
  coalesce(sum(d.peso_gramos), 0)::numeric(10, 2) as gramos,
  coalesce(sum(d.costo_cop), 0)::bigint as costo_cop
from public.lotes l
left join public.proveedores pr on pr.id = l.proveedor_id
left join public.unidades_detalle d on d.lote_id = l.id
group by l.id, pr.nombre;

-- ---------------------------------------------------------------------------
-- API del panel
-- ---------------------------------------------------------------------------

-- Registra un lote con todas sus piezas de una vez (o nada si algo falla).
-- p = { proveedor_id?, fecha?, oro_gramo_cop, nota?, piezas: [{ producto_id, peso_gramos }] }
create function public.registrar_lote(p jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_lote_id uuid;
  v_n int;
  v_inactivo text;
begin
  if not privado.es_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if jsonb_typeof(p -> 'piezas') is distinct from 'array' or jsonb_array_length(p -> 'piezas') = 0 then
    raise exception 'El lote debe tener al menos una pieza';
  end if;

  select pc.codigo into v_inactivo
  from jsonb_array_elements(p -> 'piezas') x
  join public.productos_catalogo pc on pc.id = (x ->> 'producto_id')::uuid
  where not pc.activo
  limit 1;
  if v_inactivo is not null then
    raise exception 'El producto % está inactivo', v_inactivo;
  end if;

  insert into public.lotes (proveedor_id, fecha, oro_gramo_cop, nota)
  values (
    nullif(p ->> 'proveedor_id', '')::uuid,
    coalesce((p ->> 'fecha')::date, privado.hoy()),
    (p ->> 'oro_gramo_cop')::bigint,
    nullif(btrim(p ->> 'nota'), '')
  )
  returning id into v_lote_id;

  insert into public.unidades (lote_id, producto_id, peso_gramos, mano_obra_gramo_cop)
  select v_lote_id, (x ->> 'producto_id')::uuid, (x ->> 'peso_gramos')::numeric, 0
  from jsonb_array_elements(p -> 'piezas') x;
  get diagnostics v_n = row_count;

  return jsonb_build_object('lote_id', v_lote_id, 'piezas', v_n);
end
$$;

-- ---------------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------------

alter table public.proveedores enable row level security;
alter table public.lotes enable row level security;
alter table public.unidades enable row level security;

create policy admin_todo on public.proveedores for all to authenticated
  using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo on public.lotes for all to authenticated
  using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo on public.unidades for all to authenticated
  using (privado.es_admin()) with check (privado.es_admin());

revoke all on public.proveedores, public.lotes, public.unidades, public.unidades_detalle,
  public.existencias, public.lotes_resumen from anon;
revoke execute on function public.registrar_lote(jsonb) from public, anon;
revoke execute on function privado.unidades_copiar_mano_obra(), privado.unidades_proteger_historia()
  from public, anon;
grant execute on function public.registrar_lote(jsonb) to authenticated;
