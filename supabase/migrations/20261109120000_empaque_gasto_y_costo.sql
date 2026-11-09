-- Empaques: la compra se registra en Gastos (categoría de empaques, con la cantidad comprada) y de ahí sale
-- el costo por caja de cada venta (decisión de los socios). El informe no suma la compra como gasto para no
-- contarla dos veces: el empaque entra como costo directo de cada venta.
--
-- Costo por empaque de una venta = total ÷ cantidad de la compra de empaques más reciente con fecha igual
-- o anterior a la venta. Se calcula en la vista: corregir o borrar una compra actualiza las ventas solo.

alter table public.categorias_gasto add column es_empaque boolean not null default false;
create unique index categorias_gasto_un_empaque on public.categorias_gasto (es_empaque) where es_empaque;
update public.categorias_gasto set es_empaque = true, activa = true where nombre = 'Empaques';

-- Cuántos empaques trae la compra (solo para la categoría de empaques).
alter table public.gastos add column cantidad int check (cantidad > 0);
update public.gastos g set cantidad = (regexp_match(g.descripcion, '^Compra de (\d+) empaques$'))[1]::int
where g.categoria_id = (select id from public.categorias_gasto where es_empaque);

-- Empaques usados por venta: uno por caja (se puede corregir en el detalle de la venta).
alter table public.ventas add column empaques int not null default 0 check (empaques >= 0);
update public.ventas v set empaques = (select count(*) from public.cajas c where c.venta_id = v.id);

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

revoke execute on function privado.cajas_contar_empaque() from public, anon;

drop view public.ventas_contables;

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
  coalesce(e.unitario, 0)::bigint as empaque_unitario_cop,
  (v.empaques * coalesce(e.unitario, 0))::bigint as empaque_cop,
  v.domicilio_pagado_cop,
  v.comision_pct,
  v.comision_cop,
  (v.monto_cop + v.domicilio_cobrado_cop)::bigint as ingresos_cop,
  (coalesce(p.costo, 0) + v.empaques * coalesce(e.unitario, 0) + v.domicilio_pagado_cop + v.comision_cop)::bigint
    as costos_cop,
  (v.monto_cop + v.domicilio_cobrado_cop
    - coalesce(p.costo, 0) - v.empaques * coalesce(e.unitario, 0) - v.domicilio_pagado_cop - v.comision_cop)::bigint
    as utilidad_cop
from public.ventas v
left join public.medios_pago mp on mp.id = v.medio_pago_id
left join lateral (
  select sum(pz.costo_cop) as costo, bool_and(pz.costo_cop is not null) as completo, count(*) as piezas
  from public.cajas c
  join public.piezas pz on pz.caja_id = c.id
  where c.venta_id = v.id
) p on true
left join lateral (
  select round(g.monto_cop::numeric / g.cantidad) as unitario
  from public.gastos g
  join public.categorias_gasto cg on cg.id = g.categoria_id
  where cg.es_empaque and g.cantidad is not null and g.fecha <= v.fecha
  order by g.fecha desc, g.created_at desc
  limit 1
) e on true;

revoke all on public.ventas_contables from anon;
