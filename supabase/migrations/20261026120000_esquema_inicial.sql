-- Esquema inicial: clientes, ventas, cajas, piezas, premios, escaneos y reglas del Círculo SS.
--
-- Acceso:
--   * anon (visitante del chip): solo puede llamar a public.pagina_caja(codigo).
--   * authenticated: ve y edita todo si está en public.admins (los dos socios).
--   * Las funciones internas viven en el esquema `privado`, que la API no expone.

create schema if not exists privado;
revoke all on schema privado from public;

-- ---------------------------------------------------------------------------
-- Reglas del Círculo SS (cambiar aquí con una nueva migración)
-- ---------------------------------------------------------------------------

create function privado.circulo_reglas()
returns table (monto_minimo bigint, solo_primera_compra_referido boolean, tope int)
language sql immutable
set search_path = ''
as $$
  -- monto_minimo: una compra cuenta como interacción desde este monto (COP).
  -- solo_primera_compra_referido: del referido solo suma a quien lo refirió su primera compra que califique.
  -- tope: el contador se detiene aquí.
  select 600000::bigint, true, 10
$$;

create function privado.circulo_hitos()
returns int[]
language sql immutable
set search_path = ''
as $$ select array[3, 5, 10] $$;

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------

create function privado.hoy()
returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'America/Bogota')::date $$;

create function privado.primer_nombre(p_nombre text)
returns text
language sql immutable
set search_path = ''
as $$ select split_part(regexp_replace(btrim(p_nombre), '\s+', ' ', 'g'), ' ', 1) $$;

-- Cadena aleatoria con un alfabeto de exactamente 32 caracteres: como 256 es múltiplo de 32,
-- byte % 32 no introduce sesgo. gen_random_uuid() usa el generador seguro de Postgres.
create function privado.codigo_aleatorio(p_alfabeto text, p_largo int)
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_resultado text := '';
begin
  if length(p_alfabeto) <> 32 then
    raise exception 'El alfabeto debe tener 32 caracteres';
  end if;
  for i in 1..p_largo loop
    v_resultado := v_resultado
      || substr(p_alfabeto, get_byte(uuid_send(gen_random_uuid()), 0) % 32 + 1, 1);
  end loop;
  return v_resultado;
end
$$;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) between 1 and 60),
  apellido text check (apellido is null or length(btrim(apellido)) between 1 and 60),
  whatsapp text not null unique check (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  codigo_referido text not null unique check (codigo_referido ~ '^[A-Z]{1,12}-[0-9]{4}$'),
  -- Se asigna solo al crear el cliente y no se puede cambiar (ver trigger).
  referido_por uuid references public.clientes (id) on delete restrict,
  autorizo_datos boolean not null default false,
  autorizo_datos_fecha date,
  created_at timestamptz not null default now(),
  constraint clientes_no_autorreferido check (referido_por is null or referido_por <> id),
  constraint clientes_autorizacion_con_fecha check (not autorizo_datos or autorizo_datos_fecha is not null)
);

create index clientes_referido_por_idx on public.clientes (referido_por);

create table public.ventas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  fecha date not null default privado.hoy(),
  monto_cop bigint not null check (monto_cop > 0),
  nota text,
  anulada boolean not null default false,
  anulada_at timestamptz,
  created_at timestamptz not null default now()
);

create index ventas_cliente_id_idx on public.ventas (cliente_id);

create table public.cajas (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas (id) on delete cascade,
  -- Llave de la página pública: 10 caracteres de un alfabeto de 32 (sin l ni o), 50 bits aleatorios.
  codigo_chip text not null unique check (codigo_chip ~ '^[a-km-np-z2-9]{10}$'),
  -- Referencia corta para hablar de la caja por WhatsApp (no da acceso a la página).
  referencia text not null unique check (referencia ~ '^SS-[A-HJ-NP-Z2-9]{5}$'),
  es_regalo boolean not null default false,
  nombre_destinatario text check (nombre_destinatario is null or length(btrim(nombre_destinatario)) between 1 and 60),
  created_at timestamptz not null default now(),
  constraint cajas_destinatario_solo_regalo check (es_regalo or nombre_destinatario is null)
);

create index cajas_venta_id_idx on public.cajas (venta_id);

create table public.piezas (
  id uuid primary key default gen_random_uuid(),
  caja_id uuid not null references public.cajas (id) on delete cascade,
  descripcion text not null check (length(btrim(descripcion)) between 1 and 120),
  peso_gramos numeric(7, 2) not null check (peso_gramos > 0),
  ley text not null check (length(btrim(ley)) between 1 and 20),
  orden smallint not null default 0
);

create index piezas_caja_id_idx on public.piezas (caja_id);

create table public.premios (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  hito smallint not null check (hito in (3, 5, 10)),
  fecha_entrega date not null default privado.hoy(),
  nota text,
  created_at timestamptz not null default now(),
  -- Evita entregar dos veces el mismo premio.
  constraint premios_una_vez unique (cliente_id, hito)
);

create table public.escaneos (
  id bigint generated always as identity primary key,
  caja_id uuid not null references public.cajas (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index escaneos_caja_id_idx on public.escaneos (caja_id);

-- Usuarios del panel. Se agregan a mano desde el editor SQL de Supabase.
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nombre text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function privado.clientes_proteger_codigos()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.referido_por is distinct from old.referido_por then
    raise exception 'El referido de un cliente no se puede cambiar';
  end if;
  if new.codigo_referido is distinct from old.codigo_referido then
    raise exception 'El código de referido de un cliente no se puede cambiar';
  end if;
  return new;
end
$$;

create trigger clientes_proteger_codigos
before update on public.clientes
for each row execute function privado.clientes_proteger_codigos();

create function privado.ventas_marcar_anulada()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.anulada and not old.anulada then
    new.anulada_at := now();
  elsif not new.anulada then
    new.anulada_at := null;
  end if;
  return new;
end
$$;

create trigger ventas_marcar_anulada
before update of anulada on public.ventas
for each row execute function privado.ventas_marcar_anulada();

-- ---------------------------------------------------------------------------
-- Generadores de códigos
-- ---------------------------------------------------------------------------

create function privado.nuevo_codigo_chip()
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_codigo text;
begin
  loop
    v_codigo := privado.codigo_aleatorio('abcdefghijkmnpqrstuvwxyz23456789', 10);
    exit when not exists (select 1 from public.cajas where codigo_chip = v_codigo);
  end loop;
  return v_codigo;
end
$$;

create function privado.nueva_referencia()
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_ref text;
begin
  loop
    v_ref := 'SS-' || privado.codigo_aleatorio('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 5);
    exit when not exists (select 1 from public.cajas where referencia = v_ref);
  end loop;
  return v_ref;
end
$$;

-- Primer nombre en mayúsculas, sin tildes ni espacios (máx. 12 letras), guion y 4 dígitos: MARIA-4821.
create function privado.nuevo_codigo_referido(p_nombre text)
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_base text;
  v_codigo text;
begin
  v_base := upper(translate(
    privado.primer_nombre(p_nombre),
    'áàâäãéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
    'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
  ));
  v_base := coalesce(nullif(left(regexp_replace(v_base, '[^A-Z]', '', 'g'), 12), ''), 'SS');

  for i in 1..100 loop
    v_codigo := v_base || '-' || lpad(floor(random() * 10000)::int::text, 4, '0');
    if not exists (select 1 from public.clientes where codigo_referido = v_codigo) then
      return v_codigo;
    end if;
  end loop;
  raise exception 'No se pudo generar un código de referido único para %', v_base;
end
$$;

-- ---------------------------------------------------------------------------
-- Contador del Círculo SS
-- ---------------------------------------------------------------------------

-- Interacciones por cliente: compras propias que califican + aporte de sus referidos.
-- Corre con los permisos de quien llama (los admins ven todo por RLS).
create function privado.circulo_conteo()
returns table (cliente_id uuid, propias int, por_referidos int, interacciones int)
language sql stable
set search_path = ''
as $$
  with reglas as (
    select * from privado.circulo_reglas()
  ),
  calificadas as (
    select v.cliente_id, count(*)::int as n
    from public.ventas v
    cross join reglas r
    where not v.anulada and v.monto_cop >= r.monto_minimo
    group by v.cliente_id
  ),
  aporte_referidos as (
    select c.referido_por as cliente_id,
      sum(case when r.solo_primera_compra_referido then least(q.n, 1) else q.n end)::int as n
    from public.clientes c
    join calificadas q on q.cliente_id = c.id
    cross join reglas r
    where c.referido_por is not null
    group by c.referido_por
  )
  select c.id,
    coalesce(q.n, 0),
    coalesce(a.n, 0),
    least(coalesce(q.n, 0) + coalesce(a.n, 0), r.tope)
  from public.clientes c
  cross join reglas r
  left join calificadas q on q.cliente_id = c.id
  left join aporte_referidos a on a.cliente_id = c.id
$$;

create view public.clientes_circulo
with (security_invoker = true)
as
select
  c.id,
  c.nombre,
  c.apellido,
  c.whatsapp,
  c.codigo_referido,
  c.referido_por,
  ref.codigo_referido as referido_por_codigo,
  c.autorizo_datos,
  c.autorizo_datos_fecha,
  c.created_at,
  k.propias,
  k.por_referidos,
  k.interacciones,
  (select min(h) from unnest(privado.circulo_hitos()) h where h > k.interacciones) as proximo_hito,
  array(
    select h from unnest(privado.circulo_hitos()) h
    where h <= k.interacciones
      and not exists (select 1 from public.premios p where p.cliente_id = c.id and p.hito = h)
    order by h
  ) as premios_pendientes
from public.clientes c
join privado.circulo_conteo() k on k.cliente_id = c.id
left join public.clientes ref on ref.id = c.referido_por;

-- ---------------------------------------------------------------------------
-- Autorización
-- ---------------------------------------------------------------------------

create function privado.es_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()))
$$;

alter table public.clientes enable row level security;
alter table public.ventas enable row level security;
alter table public.cajas enable row level security;
alter table public.piezas enable row level security;
alter table public.premios enable row level security;
alter table public.escaneos enable row level security;
alter table public.admins enable row level security;

create policy admin_todo on public.clientes for all to authenticated
  using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo on public.ventas for all to authenticated
  using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo on public.cajas for all to authenticated
  using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo on public.piezas for all to authenticated
  using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo on public.premios for all to authenticated
  using (privado.es_admin()) with check (privado.es_admin());
create policy admin_lectura on public.escaneos for select to authenticated
  using (privado.es_admin());
-- Cada usuario solo puede comprobar si él mismo es admin.
create policy admin_propio on public.admins for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- API: página pública del chip
-- ---------------------------------------------------------------------------

-- Devuelve solo lo que muestra la página (primer nombre, piezas, contador) o null si el código
-- no existe o la venta está anulada. Nunca devuelve WhatsApp ni ids internos. Registra el escaneo.
create function public.pagina_caja(p_codigo text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_caja public.cajas;
  v_cliente public.clientes;
  v_piezas jsonb;
  v_interacciones int;
begin
  if p_codigo is null or p_codigo !~ '^[a-km-np-z2-9]{10}$' then
    return null;
  end if;

  select ca.* into v_caja
  from public.cajas ca
  join public.ventas v on v.id = ca.venta_id
  where ca.codigo_chip = p_codigo and not v.anulada;
  if not found then
    return null;
  end if;

  select cl.* into v_cliente
  from public.clientes cl
  join public.ventas v on v.cliente_id = cl.id
  where v.id = v_caja.venta_id;

  insert into public.escaneos (caja_id) values (v_caja.id);

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
      'nombre_destinatario', v_caja.nombre_destinatario,
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

-- ---------------------------------------------------------------------------
-- API: panel de administración
-- ---------------------------------------------------------------------------

-- Registra una venta completa en una transacción. Formato de p:
-- {
--   "cliente": { "whatsapp": "+573001234567", "nombre": "María", "apellido": "Pérez",
--                "autorizo_datos": true, "autorizo_datos_fecha": "2026-10-26" },
--   "codigo_referido_de": "JUAN-1234",            -- opcional; solo para clientes nuevos
--   "monto_cop": 850000, "fecha": "2026-10-26", "nota": "...",
--   "cajas": [ { "es_regalo": true, "nombre_destinatario": "Ana",
--                "piezas": [ { "descripcion": "Cadena", "peso_gramos": 5.2, "ley": "18k" } ] } ]
-- }
create function public.registrar_venta(p jsonb)
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
begin
  if not privado.es_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if jsonb_typeof(p -> 'cajas') is distinct from 'array' or jsonb_array_length(p -> 'cajas') = 0 then
    raise exception 'La venta debe tener al menos una caja';
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

  insert into public.ventas (cliente_id, fecha, monto_cop, nota)
  values (
    v_cliente.id,
    coalesce((p ->> 'fecha')::date, privado.hoy()),
    (p ->> 'monto_cop')::bigint,
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

    insert into public.cajas (venta_id, codigo_chip, referencia, es_regalo, nombre_destinatario)
    values (
      v_venta_id, v_codigo, v_ref, v_es_regalo,
      case when v_es_regalo then nullif(btrim(v_caja ->> 'nombre_destinatario'), '') end
    )
    returning id into v_caja_id;

    insert into public.piezas (caja_id, descripcion, peso_gramos, ley, orden)
    select v_caja_id, btrim(x ->> 'descripcion'), (x ->> 'peso_gramos')::numeric, btrim(x ->> 'ley'), (o - 1)::smallint
    from jsonb_array_elements(v_caja -> 'piezas') with ordinality as t (x, o);

    v_cajas := v_cajas || jsonb_build_object(
      'id', v_caja_id, 'codigo_chip', v_codigo, 'referencia', v_ref, 'es_regalo', v_es_regalo
    );
  end loop;

  return jsonb_build_object(
    'venta_id', v_venta_id,
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

-- Asigna un código nuevo a una caja (p. ej. si el sticker falló). El código anterior deja de funcionar.
create function public.regenerar_chip(p_caja_id uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_codigo text;
begin
  if not privado.es_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  v_codigo := privado.nuevo_codigo_chip();
  update public.cajas set codigo_chip = v_codigo where id = p_caja_id;
  if not found then
    raise exception 'La caja no existe';
  end if;
  return v_codigo;
end
$$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

-- Postgres da EXECUTE a PUBLIC por defecto y Supabase da acceso a anon en el esquema public.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema privado from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;

grant usage on schema privado to authenticated;
grant execute on function
  privado.hoy(),  -- valor por defecto de fechas al insertar desde el panel
  privado.es_admin(),
  privado.circulo_conteo(),
  privado.circulo_reglas(),
  privado.circulo_hitos()
to authenticated;

grant execute on function public.pagina_caja(text) to anon, authenticated;
grant execute on function public.registrar_venta(jsonb), public.regenerar_chip(uuid) to authenticated;
