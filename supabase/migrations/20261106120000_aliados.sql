-- Fase A1: catálogo para aliados (personas que venden con comisión).
-- Cada categoría puede tener un precio por gramo especial para aliados. Cada aliado tiene un enlace
-- privado (un código de 20 caracteres, imposible de adivinar) con el que ve lo disponible: cada peso
-- con su precio de aliado, el precio público sugerido y cuántas piezas hay. Costos, lotes y
-- proveedor nunca salen. Una categoría sin precio de aliado no aparece en su catálogo.

alter table public.categorias
  add column precio_aliado_gramo_cop bigint check (precio_aliado_gramo_cop > 0);

-- La vista del panel trae también el precio de aliado (al final, para no romperla).
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
  c.precio_aliado_gramo_cop
from public.productos p
join public.categorias c on c.id = p.categoria_id;

-- Valor por defecto de aliados.token. Corre con los permisos de su dueño (security definer) para que
-- el panel no necesite ejecutar el generador de códigos general.
create function privado.nuevo_token_aliado()
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  loop
    v_token := privado.codigo_aleatorio('abcdefghijkmnpqrstuvwxyz23456789', 20);
    exit when not exists (select 1 from public.aliados where token = v_token);
  end loop;
  return v_token;
end
$$;

create table public.aliados (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) between 1 and 80),
  whatsapp text check (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  -- Código del enlace privado: /aliados/{token}. Lo pone la base (al crear o al regenerar).
  token text not null unique default privado.nuevo_token_aliado() check (token ~ '^[a-km-np-z2-9]{20}$'),
  activo boolean not null default true,
  nota text,
  -- Última vez que abrió su catálogo (para saber quién lo usa).
  ultimo_acceso timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- API pública: catálogo del aliado
-- ---------------------------------------------------------------------------

-- Con el código del enlace devuelve el primer nombre del aliado y los productos disponibles con foto
-- de las categorías que tienen precio de aliado (estén o no en el catálogo público). Por producto:
-- código, nombre, descripción, categoría, fotos y por cada peso disponible el precio de aliado, el
-- público sugerido y la cantidad. null si el código no existe o el aliado está inactivo. Anota el
-- último acceso.
create function public.catalogo_aliado(p_token text)
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
              'precio_cop', round(o.peso_gramos * c.precio_aliado_gramo_cop)::bigint,
              'precio_publico_cop', round(o.peso_gramos * c.precio_gramo_cop)::bigint,
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
    where p.activo and c.activa and c.precio_aliado_gramo_cop is not null
      and exists (select 1 from public.fotos_producto f where f.producto_id = p.id)
      and exists (select 1 from public.unidades u where u.producto_id = p.id and u.estado = 'disponible')
  ) x;

  return jsonb_build_object('aliado', privado.primer_nombre(v_aliado.nombre), 'productos', v_productos);
end
$$;

-- ---------------------------------------------------------------------------
-- API del panel
-- ---------------------------------------------------------------------------

-- Cambia el código del enlace de un aliado (el anterior deja de funcionar). Devuelve el nuevo.
create function public.regenerar_enlace_aliado(p_aliado_id uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not privado.es_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  v_token := privado.nuevo_token_aliado();
  update public.aliados set token = v_token where id = p_aliado_id;
  if not found then
    raise exception 'Aliado no encontrado';
  end if;
  return v_token;
end
$$;

-- ---------------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------------

alter table public.aliados enable row level security;
create policy admin_todo on public.aliados for all to authenticated
  using (privado.es_admin()) with check (privado.es_admin());

revoke all on public.aliados from anon;
revoke execute on function privado.nuevo_token_aliado() from public, anon;
-- Valor por defecto de una columna que el panel inserta: authenticated necesita ejecutarlo.
grant execute on function privado.nuevo_token_aliado() to authenticated;
revoke execute on function public.catalogo_aliado(text), public.regenerar_enlace_aliado(uuid) from public, anon;
grant execute on function public.catalogo_aliado(text) to anon, authenticated;
grant execute on function public.regenerar_enlace_aliado(uuid) to authenticated;
