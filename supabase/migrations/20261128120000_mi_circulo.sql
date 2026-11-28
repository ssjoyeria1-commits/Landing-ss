-- /micirculo (28 nov 2026): el cliente consulta su avance del Círculo con su WhatsApp y su código del Círculo
-- (decisión de los socios: solo con el teléfono, cualquiera que supiera el número vería cuánto compra alguien).
--
-- Como la clave publicable es pública, la función se puede llamar directo a la API sin pasar por el límite
-- del Worker; por eso el límite también va aquí: 5 intentos fallidos por número en una hora y se bloquea
-- ese número hasta que pase la hora (el código tiene 10.000 combinaciones por nombre).

create table privado.intentos_circulo (
  whatsapp text not null,
  created_at timestamptz not null default now()
);

create index intentos_circulo_whatsapp_idx on privado.intentos_circulo (whatsapp, created_at);

revoke all on privado.intentos_circulo from public, anon, authenticated;

create or replace function public.mi_circulo(p_whatsapp text, p_codigo text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_whatsapp text := btrim(coalesce(p_whatsapp, ''));
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
  v_cliente public.clientes;
  v_gramos numeric;
begin
  if v_whatsapp !~ '^\+[1-9][0-9]{7,14}$' then
    return null;
  end if;

  if (select count(*) from privado.intentos_circulo i
      where i.whatsapp = v_whatsapp and i.created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('bloqueado', true);
  end if;

  select cl.* into v_cliente
  from public.clientes cl
  where cl.whatsapp = v_whatsapp and cl.codigo_referido = v_codigo;

  if not found then
    insert into privado.intentos_circulo (whatsapp) values (v_whatsapp);
    delete from privado.intentos_circulo where created_at < now() - interval '1 day';
    return null;
  end if;

  v_gramos := privado.circulo_gramos(v_cliente.id);
  -- Los mismos datos del Círculo que la página del chip, con el primer nombre y nada más.
  return jsonb_build_object(
    'nombre', privado.primer_nombre(v_cliente.nombre),
    'circulo', jsonb_build_object(
      'gramos', v_gramos,
      'hitos', to_jsonb(privado.circulo_hitos()),
      'proximo_hito', (select min(h) from unnest(privado.circulo_hitos()) h where h > v_gramos),
      'codigo_referido', v_cliente.codigo_referido
    )
  );
end
$$;

revoke execute on function public.mi_circulo(text, text) from public;
grant execute on function public.mi_circulo(text, text) to anon, authenticated;
