-- Fase 4D: informes cruzados de ventas e inventario.
-- Una fila por pieza vendida, con su producto, categoría y lote (si salió del inventario), su precio,
-- la parte del descuento de la venta que le toca (proporcional a su precio), su costo, su margen y
-- los días que estuvo en inventario. Las piezas sin precio (ventas de antes del inventario) quedan
-- con precio nulo y los informes las dejan por fuera.

create view public.piezas_vendidas
with (security_invoker = true)
as
with base as (
  select
    pz.id,
    v.id as venta_id,
    v.fecha,
    v.anulada,
    v.cliente_id,
    c.referencia,
    pz.descripcion,
    pz.peso_gramos,
    pz.precio_cop,
    pz.costo_cop,
    pz.unidad_id,
    d.producto_id,
    d.codigo,
    d.categoria,
    d.lote_id,
    d.lote_fecha,
    v.descuento_cop,
    sum(pz.precio_cop) over (partition by v.id) as subtotal_venta
  from public.piezas pz
  join public.cajas c on c.id = pz.caja_id
  join public.ventas v on v.id = c.venta_id
  left join public.unidades_detalle d on d.id = pz.unidad_id
)
select
  id,
  venta_id,
  fecha,
  anulada,
  cliente_id,
  referencia,
  descripcion,
  peso_gramos,
  producto_id,
  codigo,
  coalesce(categoria, case when precio_cop is not null then 'Fuera del inventario' end) as categoria,
  lote_id,
  lote_fecha,
  precio_cop,
  case when precio_cop is not null and subtotal_venta > 0
    then round(descuento_cop * precio_cop::numeric / subtotal_venta)::bigint
  end as descuento_cop,
  case when precio_cop is not null and subtotal_venta > 0
    then precio_cop - round(descuento_cop * precio_cop::numeric / subtotal_venta)::bigint
  end as precio_neto_cop,
  costo_cop,
  case when precio_cop is not null and costo_cop is not null and subtotal_venta > 0
    then precio_cop - round(descuento_cop * precio_cop::numeric / subtotal_venta)::bigint - costo_cop
  end as margen_cop,
  (fecha - lote_fecha) as dias_en_inventario
from base;

revoke all on public.piezas_vendidas from anon;
