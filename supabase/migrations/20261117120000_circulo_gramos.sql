-- Círculo SS por gramos (decisiones de los socios, 17 nov 2026). Reemplaza el conteo de interacciones:
-- - Cada compra de un cliente suma todos sus gramos (las piezas de sus cajas), sin monto mínimo. Las ventas
--   anuladas y las ventas a aliados no suman.
-- - Quien refirió a alguien suma el 10% de los gramos de la PRIMERA compra de su referido (la más antigua
--   que no esté anulada), redondeado a centésimas.
-- - Premios a los 5, 10 y 15 gramos; el contador se detiene en 15.
-- El premio y su chip se siguen creando solos (privado.sincronizar_premios), ahora también cuando cambian
-- las piezas de una venta, porque los gramos salen de ellas.

drop view if exists public.clientes_circulo;
drop function if exists privado.circulo_conteo();
drop function if exists privado.circulo_reglas();

create function privado.circulo_reglas()
returns table (porcentaje_referido numeric, solo_primera_compra_referido boolean, tope numeric)
language sql immutable
set search_path = ''
as $$
  -- porcentaje_referido: parte de los gramos del referido que suma a quien lo refirió.
  -- solo_primera_compra_referido: solo cuenta la primera compra del referido.
  -- tope: el contador se detiene aquí (gramos).
  select 0.10::numeric, true, 15::numeric
$$;

create or replace function privado.circulo_hitos()
returns int[]
language sql immutable
set search_path = ''
as $$ select array[5, 10, 15] $$;

-- Gramos por cliente: los de sus compras + el aporte de sus referidos. Con los permisos de quien llama
-- (los admins ven todo por RLS; pagina_caja y sincronizar_premios corren como definer).
create function privado.circulo_conteo()
returns table (cliente_id uuid, gramos_propios numeric, gramos_referidos numeric, gramos numeric)
language sql stable
set search_path = ''
as $$
  with reglas as (
    select * from privado.circulo_reglas()
  ),
  por_venta as (
    select v.id, v.cliente_id, v.fecha, v.created_at, coalesce(sum(p.peso_gramos), 0) as gramos
    from public.ventas v
    left join public.cajas ca on ca.venta_id = v.id
    left join public.piezas p on p.caja_id = ca.id
    where not v.anulada and v.cliente_id is not null
    group by v.id
  ),
  propios as (
    select cliente_id, sum(gramos) as gramos from por_venta group by cliente_id
  ),
  -- La primera compra de cada cliente (o todas, si la regla cambiara).
  contables_referido as (
    select pv.cliente_id, pv.gramos,
      row_number() over (partition by pv.cliente_id order by pv.fecha, pv.created_at, pv.id) as n
    from por_venta pv
  ),
  aporte_referidos as (
    select c.referido_por as cliente_id, sum(round(q.gramos * r.porcentaje_referido, 2)) as gramos
    from public.clientes c
    join contables_referido q on q.cliente_id = c.id
    cross join reglas r
    where c.referido_por is not null and (not r.solo_primera_compra_referido or q.n = 1)
    group by c.referido_por
  )
  select c.id,
    coalesce(p.gramos, 0),
    coalesce(a.gramos, 0),
    least(coalesce(p.gramos, 0) + coalesce(a.gramos, 0), r.tope)
  from public.clientes c
  cross join reglas r
  left join propios p on p.cliente_id = c.id
  left join aporte_referidos a on a.cliente_id = c.id
$$;

-- Gramos de un solo cliente (para la página del chip y los premios, sin calcular a todos).
create function privado.circulo_gramos(p_cliente uuid)
returns numeric
language sql stable
set search_path = ''
as $$
  with reglas as (
    select * from privado.circulo_reglas()
  ),
  por_venta as (
    select v.id, v.cliente_id, v.fecha, v.created_at, coalesce(sum(p.peso_gramos), 0) as gramos
    from public.ventas v
    left join public.cajas ca on ca.venta_id = v.id
    left join public.piezas p on p.caja_id = ca.id
    where not v.anulada
      and (v.cliente_id = p_cliente or v.cliente_id in (select id from public.clientes where referido_por = p_cliente))
    group by v.id
  ),
  numeradas as (
    select pv.*, row_number() over (partition by pv.cliente_id order by pv.fecha, pv.created_at, pv.id) as n
    from por_venta pv
  )
  select least(
    coalesce((select sum(gramos) from numeradas where cliente_id = p_cliente), 0)
      + coalesce((
        select sum(round(q.gramos * r.porcentaje_referido, 2))
        from numeradas q cross join reglas r
        where q.cliente_id <> p_cliente and (not r.solo_primera_compra_referido or q.n = 1)
      ), 0),
    (select tope from reglas)
  )
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
  k.gramos_propios,
  k.gramos_referidos,
  k.gramos,
  (select min(h) from unnest(privado.circulo_hitos()) h where h > k.gramos) as proximo_hito,
  array(
    select h from unnest(privado.circulo_hitos()) h
    where h <= k.gramos
      and not exists (select 1 from public.premios p where p.cliente_id = c.id and p.hito = h and p.fecha_entrega is not null)
    order by h
  ) as premios_pendientes
from public.clientes c
join privado.circulo_conteo() k on k.cliente_id = c.id
left join public.clientes ref on ref.id = c.referido_por;

-- Premios en 5, 10 y 15 g. Los pendientes del sistema anterior se borran y se vuelven a crear abajo.
delete from public.premios where fecha_entrega is null;
alter table public.premios drop constraint if exists premios_hito_check;
alter table public.premios add constraint premios_hito_check check (hito in (5, 10, 15));

create or replace function privado.sincronizar_premios(p_cliente uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_gramos numeric;
begin
  if p_cliente is null then
    return;
  end if;
  v_gramos := coalesce(privado.circulo_gramos(p_cliente), 0);
  insert into public.premios (cliente_id, hito, fecha_entrega)
  select p_cliente, h, null from unnest(privado.circulo_hitos()) h where h <= v_gramos
  on conflict (cliente_id, hito) do nothing;
  delete from public.premios
  where cliente_id = p_cliente and hito > v_gramos and fecha_entrega is null;
end
$$;

-- Las piezas dan los gramos: al agregar, quitar o cambiar una, se revisan el comprador y quien lo refirió.
create function privado.piezas_premios()
returns trigger
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_caja uuid := coalesce(new.caja_id, old.caja_id);
  v_cliente uuid;
begin
  select v.cliente_id into v_cliente
  from public.cajas ca join public.ventas v on v.id = ca.venta_id
  where ca.id = v_caja;
  if v_cliente is not null then
    perform privado.sincronizar_premios(v_cliente);
    perform privado.sincronizar_premios((select c.referido_por from public.clientes c where c.id = v_cliente));
  end if;
  return null;
end
$$;

create trigger piezas_premios
after insert or update of peso_gramos or delete on public.piezas
for each row execute function privado.piezas_premios();

revoke execute on function
  privado.circulo_reglas(), privado.circulo_conteo(), privado.circulo_gramos(uuid), privado.piezas_premios()
from public, anon;
-- La vista clientes_circulo corre con los permisos del admin que la consulta.
grant execute on function privado.circulo_reglas(), privado.circulo_conteo(), privado.circulo_hitos() to authenticated;

create or replace function public.pagina_caja(p_codigo text, p_contar boolean default true)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_caja public.cajas;
  v_cliente public.clientes;
  v_piezas jsonb;
  v_gramos numeric;
  v_fecha date;
  v_premio public.premios;
begin
  if p_codigo is null or p_codigo !~ '^[a-km-np-z2-9]{10}$' then
    return null;
  end if;

  -- Solo ventas vigentes de un cliente (las de aliados no llevan chip).
  select ca.* into v_caja
  from public.cajas ca
  join public.ventas v on v.id = ca.venta_id
  where ca.codigo_chip = p_codigo and not v.anulada and v.cliente_id is not null;
  if not found then
    -- Caja de premio del Círculo: su propio chip, con el premio y el avance del cliente.
    select pr.* into v_premio from public.premios pr where pr.codigo_chip = p_codigo;
    if not found then
      return null;
    end if;
    select cl.* into v_cliente from public.clientes cl where cl.id = v_premio.cliente_id;
    v_gramos := privado.circulo_gramos(v_cliente.id);
    return jsonb_build_object(
      'tipo', 'premio',
      'referencia', v_premio.referencia,
      'fecha', coalesce(v_premio.fecha_entrega, v_premio.created_at::date),
      'nombre', privado.primer_nombre(v_cliente.nombre),
      'hito', v_premio.hito,
      'detalle', v_premio.detalle,
      'circulo', jsonb_build_object(
        'gramos', v_gramos,
        'hitos', to_jsonb(privado.circulo_hitos()),
        'proximo_hito', (select min(h) from unnest(privado.circulo_hitos()) h where h > v_gramos),
        'codigo_referido', v_cliente.codigo_referido
      )
    );
  end if;

  select cl.* into v_cliente
  from public.clientes cl
  join public.ventas v on v.cliente_id = cl.id
  where v.id = v_caja.venta_id;

  select v.fecha into v_fecha from public.ventas v where v.id = v_caja.venta_id;

  if p_contar then
    insert into public.escaneos (caja_id) values (v_caja.id);
  end if;

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
      'fecha', v_fecha,
      'nombre_destinatario', v_caja.nombre_destinatario,
      'mensaje', v_caja.mensaje_regalo,
      'nombre_comprador', privado.primer_nombre(v_cliente.nombre),
      'codigo_referido_comprador', v_cliente.codigo_referido,
      'piezas', v_piezas
    );
  end if;

  v_gramos := privado.circulo_gramos(v_cliente.id);

  return jsonb_build_object(
    'tipo', 'propia',
    'referencia', v_caja.referencia,
    'fecha', v_fecha,
    'nombre', privado.primer_nombre(v_cliente.nombre),
    'piezas', v_piezas,
    'circulo', jsonb_build_object(
      'gramos', v_gramos,
      'hitos', to_jsonb(privado.circulo_hitos()),
      'proximo_hito', (select min(h) from unnest(privado.circulo_hitos()) h where h > v_gramos),
      'codigo_referido', v_cliente.codigo_referido
    )
  );
end
$$;

-- Con las reglas nuevas, cada cliente recibe los premios que ya alcanzó (con su chip).
do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.clientes loop
    perform privado.sincronizar_premios(v_id);
  end loop;
end
$$;
