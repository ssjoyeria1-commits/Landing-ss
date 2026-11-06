-- Contabilidad: costos directos de cada venta (piezas, empaque, mensajero y comisión del medio de
-- pago), domicilio cobrado como entrada, y gastos del negocio por categoría. Decisiones de los
-- socios (7 nov 2026): un empaque por caja con costo configurable (cada venta guarda el del momento),
-- domicilio cobrado y pagado, medio de pago con su % de comisión, sin impuestos por ahora.

-- ---------------------------------------------------------------------------
-- Medios de pago
-- ---------------------------------------------------------------------------

create table public.medios_pago (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique check (char_length(nombre) between 1 and 40),
  -- Porcentaje que cobra el medio sobre lo pagado (piezas + domicilio cobrado).
  comision_pct numeric(5, 2) not null default 0 check (comision_pct >= 0 and comision_pct <= 20),
  activo boolean not null default true,
  orden smallint not null default 0,
  created_at timestamptz not null default now()
);

insert into public.medios_pago (nombre, orden) values
  ('Efectivo', 1), ('Transferencia', 2), ('Nequi', 3), ('Daviplata', 4), ('Datáfono', 5), ('Link de pago', 6);

-- ---------------------------------------------------------------------------
-- Costo del empaque: cada compra de empaques fija el costo por unidad desde una fecha
-- ---------------------------------------------------------------------------

create table public.costos_empaque (
  id uuid primary key default gen_random_uuid(),
  desde date not null default privado.hoy(),
  cantidad int not null check (cantidad > 0),
  total_cop bigint not null check (total_cop > 0),
  costo_unitario_cop bigint generated always as (round(total_cop::numeric / cantidad)::bigint) stored,
  nota text,
  created_at timestamptz not null default now()
);

-- Costo por empaque vigente en una fecha (0 si todavía no se ha registrado ninguno).
create function privado.costo_empaque(p_fecha date)
returns bigint
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select ce.costo_unitario_cop from public.costos_empaque ce
    where ce.desde <= p_fecha
    order by ce.desde desc, ce.created_at desc
    limit 1
  ), 0)
$$;

-- ---------------------------------------------------------------------------
-- Costos y cobros de cada venta
-- ---------------------------------------------------------------------------

alter table public.ventas
  add column medio_pago_id uuid references public.medios_pago (id) on delete restrict,
  -- Copia del % del medio al elegirlo: si el medio cambia su comisión, las ventas viejas no cambian.
  add column comision_pct numeric(5, 2) not null default 0,
  add column comision_cop bigint not null default 0,
  -- Empaques usados (uno por caja, se puede corregir) y su costo por unidad del momento.
  add column empaques int not null default 0 check (empaques >= 0),
  add column empaque_unitario_cop bigint not null default 0 check (empaque_unitario_cop >= 0),
  -- Lo que se le cobró al cliente por el domicilio (entrada) y lo que se le pagó al mensajero (costo).
  add column domicilio_cobrado_cop bigint not null default 0 check (domicilio_cobrado_cop >= 0),
  add column domicilio_pagado_cop bigint not null default 0 check (domicilio_pagado_cop >= 0);

create index ventas_fecha_idx on public.ventas (fecha);

-- Ventas que ya existían: un empaque por caja (su costo se llena al registrar el primer costo de empaque).
update public.ventas v set empaques = (select count(*) from public.cajas c where c.venta_id = v.id);

-- Calcula la comisión y fija el costo del empaque al crear la venta.
create function privado.ventas_costos()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.medio_pago_id is distinct from old.medio_pago_id then
    new.comision_pct := coalesce((select mp.comision_pct from public.medios_pago mp where mp.id = new.medio_pago_id), 0);
  end if;
  new.comision_cop := round((new.monto_cop + new.domicilio_cobrado_cop) * new.comision_pct / 100)::bigint;
  if tg_op = 'INSERT' and new.empaque_unitario_cop = 0 then
    new.empaque_unitario_cop := privado.costo_empaque(new.fecha);
  end if;
  return new;
end
$$;

create trigger ventas_costos
before insert or update of medio_pago_id, monto_cop, domicilio_cobrado_cop on public.ventas
for each row execute function privado.ventas_costos();

-- Cada caja nueva suma un empaque a su venta.
create function privado.cajas_contar_empaque()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.ventas set empaques = empaques + 1 where id = new.venta_id;
  return new;
end
$$;

create trigger cajas_contar_empaque
after insert on public.cajas
for each row execute function privado.cajas_contar_empaque();

-- Al registrar un costo de empaque, las ventas desde esa fecha que aún no tenían costo lo toman
-- (así el primer registro cubre las ventas anteriores). Las que ya tenían costo no cambian.
create function privado.costos_empaque_aplicar()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.ventas set empaque_unitario_cop = new.costo_unitario_cop
  where fecha >= new.desde and empaque_unitario_cop = 0;
  return new;
end
$$;

create trigger costos_empaque_aplicar
after insert on public.costos_empaque
for each row execute function privado.costos_empaque_aplicar();

-- ---------------------------------------------------------------------------
-- Gastos del negocio
-- ---------------------------------------------------------------------------

create table public.categorias_gasto (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique check (char_length(nombre) between 1 and 60),
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

-- La compra de empaques no va aquí: se registra en el costo del empaque y entra a cada venta.
-- La compra de oro (lotes) tampoco: es inventario y entra como costo de cada pieza vendida.
insert into public.categorias_gasto (nombre) values
  ('Arriendo'), ('Servicios públicos'), ('Internet y teléfono'), ('Publicidad y redes'),
  ('Sueldos y honorarios'), ('Transporte'), ('Papelería y oficina'), ('Mantenimiento y reparaciones'),
  ('Comisiones y gastos bancarios'), ('Impuestos y trámites'), ('Software y suscripciones'),
  ('Fotografía y contenido'), ('Otros');

create table public.gastos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default privado.hoy(),
  categoria_id uuid not null references public.categorias_gasto (id) on delete restrict,
  descripcion text not null check (char_length(descripcion) between 1 and 120),
  monto_cop bigint not null check (monto_cop > 0),
  medio_pago_id uuid references public.medios_pago (id) on delete restrict,
  nota text,
  created_at timestamptz not null default now()
);

create index gastos_fecha_idx on public.gastos (fecha);

-- ---------------------------------------------------------------------------
-- Vista contable: ingresos, costos directos y utilidad de cada venta
-- ---------------------------------------------------------------------------

create view public.ventas_contables
with (security_invoker = true)
as
select
  v.id,
  v.fecha,
  v.anulada,
  v.cliente_id,
  v.aliado_id,
  case when v.aliado_id is null then 'cliente' else 'aliado' end as tipo,
  v.pagada_aliado_at,
  v.medio_pago_id,
  mp.nombre as medio_pago,
  v.monto_cop,
  v.descuento_cop,
  v.domicilio_cobrado_cop,
  coalesce(p.costo, 0)::bigint as costo_piezas_cop,
  coalesce(p.completo, true) as costo_completo,
  coalesce(p.piezas, 0)::int as piezas,
  v.empaques,
  (v.empaques * v.empaque_unitario_cop)::bigint as empaque_cop,
  v.domicilio_pagado_cop,
  v.comision_pct,
  v.comision_cop,
  (v.monto_cop + v.domicilio_cobrado_cop)::bigint as ingresos_cop,
  (coalesce(p.costo, 0) + v.empaques * v.empaque_unitario_cop + v.domicilio_pagado_cop + v.comision_cop)::bigint
    as costos_cop,
  (v.monto_cop + v.domicilio_cobrado_cop
    - coalesce(p.costo, 0) - v.empaques * v.empaque_unitario_cop - v.domicilio_pagado_cop - v.comision_cop)::bigint
    as utilidad_cop
from public.ventas v
left join public.medios_pago mp on mp.id = v.medio_pago_id
left join lateral (
  select sum(pz.costo_cop) as costo, bool_and(pz.costo_cop is not null) as completo, count(*) as piezas
  from public.cajas c
  join public.piezas pz on pz.caja_id = c.id
  where c.venta_id = v.id
) p on true;

-- ---------------------------------------------------------------------------
-- Permisos: solo los admins, nada para anon
-- ---------------------------------------------------------------------------

alter table public.medios_pago enable row level security;
alter table public.costos_empaque enable row level security;
alter table public.categorias_gasto enable row level security;
alter table public.gastos enable row level security;

create policy admin_todo on public.medios_pago for all to authenticated
  using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo on public.costos_empaque for all to authenticated
  using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo on public.categorias_gasto for all to authenticated
  using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo on public.gastos for all to authenticated
  using (privado.es_admin()) with check (privado.es_admin());

revoke all on public.medios_pago, public.costos_empaque, public.categorias_gasto, public.gastos,
  public.ventas_contables from anon;
revoke execute on function privado.costo_empaque(date), privado.ventas_costos(), privado.cajas_contar_empaque(),
  privado.costos_empaque_aplicar() from public, anon;
-- La fecha por defecto de costos_empaque y gastos usa privado.hoy() (ya concedida a authenticated).
