-- Certificado de la pieza (/c/[codigo]/certificado): usa los mismos datos públicos de la caja, pero
-- abrirlo no cuenta como otro escaneo. pagina_caja recibe p_contar (por defecto true: la página del
-- chip sigue contando) y devuelve también la fecha de la compra para el certificado. Sigue sin
-- precios, costos, WhatsApp ni ids internos.

drop function public.pagina_caja(text);

create function public.pagina_caja(p_codigo text, p_contar boolean default true)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_caja public.cajas;
  v_cliente public.clientes;
  v_piezas jsonb;
  v_interacciones int;
  v_fecha date;
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
    return null;
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
    'fecha', v_fecha,
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

revoke execute on function public.pagina_caja(text, boolean) from public;
grant execute on function public.pagina_caja(text, boolean) to anon, authenticated;
