-- Compras de empaque editables (los socios registraron una con la fecha
-- equivocada). El costo del empaque de cada venta pasa a depender solo de la fecha: es el de la compra
-- vigente ese día ("Aplica desde" hasta la compra siguiente). Al crear, corregir o borrar una compra,
-- se recalculan las ventas que cambian. Las ventas anteriores a la primera compra quedan en $ 0.

create or replace function privado.costos_empaque_aplicar()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.ventas v set empaque_unitario_cop = x.costo
  from (select vv.id, privado.costo_empaque(vv.fecha) as costo from public.ventas vv) x
  where x.id = v.id and v.empaque_unitario_cop <> x.costo;
  return null;
end
$$;

drop trigger costos_empaque_aplicar on public.costos_empaque;

create trigger costos_empaque_aplicar
after insert or update or delete on public.costos_empaque
for each statement execute function privado.costos_empaque_aplicar();

revoke execute on function privado.costos_empaque_aplicar() from public, anon;

-- Deja las ventas actuales de acuerdo con la regla nueva.
update public.ventas v set empaque_unitario_cop = x.costo
from (select vv.id, privado.costo_empaque(vv.fecha) as costo from public.ventas vv) x
where x.id = v.id and v.empaque_unitario_cop <> x.costo;
