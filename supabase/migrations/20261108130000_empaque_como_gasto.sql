-- Empaques como gasto (decisión de los socios): la compra de empaques se registra en Gastos, categoría
-- "Empaques", con la fecha de la compra. Las ventas dejan de restar un costo de empaque (no se cuenta dos
-- veces). Las compras ya registradas en costos_empaque pasan a gastos y esa tabla desaparece.

insert into public.categorias_gasto (nombre) values ('Empaques') on conflict (nombre) do update set activa = true;

insert into public.gastos (fecha, categoria_id, descripcion, monto_cop, nota, created_at)
select
  ce.desde,
  (select id from public.categorias_gasto where nombre = 'Empaques'),
  'Compra de ' || ce.cantidad || ' empaques',
  ce.total_cop,
  ce.nota,
  ce.created_at
from public.costos_empaque ce;

-- Fuera el costo de empaque por venta.
drop view public.ventas_contables;
drop trigger cajas_contar_empaque on public.cajas;
drop trigger costos_empaque_aplicar on public.costos_empaque;
drop function privado.cajas_contar_empaque();
drop function privado.costos_empaque_aplicar();

create or replace function privado.ventas_costos()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.medio_pago_id is distinct from old.medio_pago_id then
    new.comision_pct := coalesce((select mp.comision_pct from public.medios_pago mp where mp.id = new.medio_pago_id), 0);
  end if;
  new.comision_cop := round((new.monto_cop + new.domicilio_cobrado_cop) * new.comision_pct / 100)::bigint;
  return new;
end
$$;

alter table public.ventas drop column empaques, drop column empaque_unitario_cop;
drop table public.costos_empaque;
drop function privado.costo_empaque(date);

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
  v.domicilio_pagado_cop,
  v.comision_pct,
  v.comision_cop,
  (v.monto_cop + v.domicilio_cobrado_cop)::bigint as ingresos_cop,
  (coalesce(p.costo, 0) + v.domicilio_pagado_cop + v.comision_cop)::bigint as costos_cop,
  (v.monto_cop + v.domicilio_cobrado_cop - coalesce(p.costo, 0) - v.domicilio_pagado_cop - v.comision_cop)::bigint
    as utilidad_cop
from public.ventas v
left join public.medios_pago mp on mp.id = v.medio_pago_id
left join lateral (
  select sum(pz.costo_cop) as costo, bool_and(pz.costo_cop is not null) as completo, count(*) as piezas
  from public.cajas c
  join public.piezas pz on pz.caja_id = c.id
  where c.venta_id = v.id
) p on true;

revoke all on public.ventas_contables from anon;
