-- Fase 4E: conteo físico, ajustes y auditoría del inventario.
-- Un conteo compara lo que hay en la vitrina con lo que dice el sistema para un producto, peso por
-- peso. Las piezas que faltan se dan de baja (estado 'baja') con su motivo; si aparece una pieza
-- dada de baja, se reintegra. Cada cambio queda en la tabla ajustes con quién y cuándo.

create table public.conteos (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos (id) on delete restrict,
  fecha date not null default privado.hoy(),
  -- Piezas que había en el sistema y las que se contaron, para el historial.
  en_sistema int not null check (en_sistema >= 0),
  contadas int not null check (contadas >= 0),
  nota text,
  creado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index conteos_producto_id_idx on public.conteos (producto_id);

create table public.ajustes (
  id uuid primary key default gen_random_uuid(),
  unidad_id uuid not null references public.unidades (id) on delete cascade,
  conteo_id uuid references public.conteos (id) on delete set null,
  -- baja: sale del inventario disponible; reintegro: vuelve a estar disponible.
  tipo text not null check (tipo in ('baja', 'reintegro')),
  motivo text not null check (length(btrim(motivo)) between 1 and 60),
  nota text,
  creado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index ajustes_unidad_id_idx on public.ajustes (unidad_id);
create index ajustes_conteo_id_idx on public.ajustes (conteo_id);

-- Ajustes con la pieza, su producto y quién lo hizo (nombre del admin).
create view public.ajustes_detalle
with (security_invoker = true)
as
select
  a.id,
  a.tipo,
  a.motivo,
  a.nota,
  a.conteo_id,
  a.created_at,
  a.creado_por,
  ad.nombre as creado_por_nombre,
  d.id as unidad_id,
  d.producto_id,
  d.codigo,
  d.producto,
  d.peso_gramos,
  d.costo_cop,
  d.estado
from public.ajustes a
join public.unidades_detalle d on d.id = a.unidad_id
left join public.admins ad on ad.user_id = a.creado_por;

-- ---------------------------------------------------------------------------
-- API del panel
-- ---------------------------------------------------------------------------

-- Da de baja o reintegra piezas sueltas. p = { tipo: 'baja'|'reintegro', unidades: [ids], motivo, nota? }
create function public.ajustar_inventario(p jsonb)
returns int
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tipo text := p ->> 'tipo';
  v_ids uuid[];
  v_desde text;
  v_hasta text;
  v_n int;
begin
  if not privado.es_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v_tipo not in ('baja', 'reintegro') then
    raise exception 'Tipo de ajuste no válido';
  end if;
  if nullif(btrim(p ->> 'motivo'), '') is null then
    raise exception 'Falta el motivo del ajuste';
  end if;
  select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(p -> 'unidades') x;
  if cardinality(v_ids) = 0 then
    raise exception 'Elige al menos una pieza';
  end if;

  v_desde := case v_tipo when 'baja' then 'disponible' else 'baja' end;
  v_hasta := case v_tipo when 'baja' then 'baja' else 'disponible' end;
  perform 1 from public.unidades where id = any (v_ids) for update;
  if exists (select 1 from public.unidades where id = any (v_ids) and estado <> v_desde)
     or (select count(*) from public.unidades where id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'Solo se puede % una pieza %', case v_tipo when 'baja' then 'dar de baja' else 'reintegrar' end,
      case v_tipo when 'baja' then 'disponible' else 'dada de baja' end;
  end if;

  update public.unidades set estado = v_hasta where id = any (v_ids);
  get diagnostics v_n = row_count;
  insert into public.ajustes (unidad_id, tipo, motivo, nota)
  select u, v_tipo, btrim(p ->> 'motivo'), nullif(btrim(p ->> 'nota'), '') from unnest(v_ids) u;
  return v_n;
end
$$;

-- Registra el conteo físico de un producto. Por cada peso que faltó, da de baja esa cantidad de
-- piezas disponibles de ese peso (las del lote más reciente, para que las que quedan sigan en orden
-- de llegada). p = { producto_id, nota?, motivo?, contadas, faltantes: [{ peso_gramos, cantidad }] }
create function public.registrar_conteo(p jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_producto uuid := (p ->> 'producto_id')::uuid;
  v_motivo text := coalesce(nullif(btrim(p ->> 'motivo'), ''), 'Faltante en conteo');
  v_conteo uuid;
  v_falta jsonb;
  v_ids uuid[];
  v_bajas int := 0;
  v_en_sistema int;
begin
  if not privado.es_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  perform 1 from public.unidades where producto_id = v_producto and estado = 'disponible' for update;
  select count(*) into v_en_sistema from public.unidades where producto_id = v_producto and estado = 'disponible';

  insert into public.conteos (producto_id, en_sistema, contadas, nota)
  values (v_producto, v_en_sistema, (p ->> 'contadas')::int, nullif(btrim(p ->> 'nota'), ''))
  returning id into v_conteo;

  for v_falta in select * from jsonb_array_elements(coalesce(p -> 'faltantes', '[]'::jsonb)) loop
    if (v_falta ->> 'cantidad')::int <= 0 then
      continue;
    end if;
    select array_agg(id) into v_ids
    from (
      select u.id
      from public.unidades u
      join public.lotes l on l.id = u.lote_id
      where u.producto_id = v_producto and u.estado = 'disponible'
        and u.peso_gramos = (v_falta ->> 'peso_gramos')::numeric
      order by l.fecha desc, u.created_at desc
      limit (v_falta ->> 'cantidad')::int
    ) x;
    if coalesce(cardinality(v_ids), 0) < (v_falta ->> 'cantidad')::int then
      raise exception 'Faltan más piezas de % g de las que hay en el sistema', v_falta ->> 'peso_gramos';
    end if;
    update public.unidades set estado = 'baja' where id = any (v_ids);
    insert into public.ajustes (unidad_id, conteo_id, tipo, motivo, nota)
    select u, v_conteo, 'baja', v_motivo, nullif(btrim(p ->> 'nota'), '') from unnest(v_ids) u;
    v_bajas := v_bajas + cardinality(v_ids);
  end loop;

  return jsonb_build_object('conteo_id', v_conteo, 'bajas', v_bajas, 'en_sistema', v_en_sistema);
end
$$;

-- ---------------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------------

alter table public.conteos enable row level security;
alter table public.ajustes enable row level security;

-- Los ajustes son historia: los admins los leen y crean por las funciones, pero no los editan ni borran.
create policy admin_lectura on public.conteos for select to authenticated using (privado.es_admin());
create policy admin_lectura on public.ajustes for select to authenticated using (privado.es_admin());

-- Para mostrar quién hizo cada ajuste, los admins pueden ver los nombres de los demás admins.
create policy admin_ve_admins on public.admins for select to authenticated using (privado.es_admin());

revoke all on public.conteos, public.ajustes, public.ajustes_detalle from anon;
revoke insert, update, delete on public.conteos, public.ajustes from authenticated;
revoke execute on function public.ajustar_inventario(jsonb), public.registrar_conteo(jsonb) from public, anon;
grant execute on function public.ajustar_inventario(jsonb), public.registrar_conteo(jsonb) to authenticated;
