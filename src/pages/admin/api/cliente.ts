import type { APIRoute } from 'astro';
import { normalizarWhatsapp } from '../../../lib/whatsapp';

/** Busca un cliente por WhatsApp para el formulario de venta. */
export const GET: APIRoute = async ({ locals, url }) => {
  const whatsapp = normalizarWhatsapp(url.searchParams.get('numero') ?? '', url.searchParams.get('pais') ?? 'CO');
  if (!whatsapp) return Response.json({ valido: false });

  const { data, error } = await locals.supabase
    .from('clientes_circulo')
    .select('id, nombre, apellido, codigo_referido, interacciones, autorizo_datos')
    .eq('whatsapp', whatsapp)
    .maybeSingle();
  if (error) return Response.json({ valido: true, error: error.message }, { status: 500 });

  return Response.json({ valido: true, whatsapp, cliente: data });
};
