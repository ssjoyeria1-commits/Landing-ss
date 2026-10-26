import type { APIRoute } from 'astro';
import { aCsv } from '../../../lib/csv';
import { EXPORTACIONES } from '../../../lib/exportar';
import { hoyBogota } from '../../../lib/formato';

export const GET: APIRoute = async ({ params, locals }) => {
  const nombre = (params.tabla ?? '').replace(/\.csv$/, '');
  const exportacion = EXPORTACIONES[nombre];
  if (!exportacion) return new Response('No existe', { status: 404 });

  try {
    const { encabezados, filas } = await exportacion.generar(locals.supabase);
    return new Response(aCsv(encabezados, filas, exportacion.formato), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="ss-${nombre}-${hoyBogota()}.csv"`,
      },
    });
  } catch (e) {
    return new Response(`No se pudo generar el archivo: ${(e as Error).message}`, { status: 500 });
  }
};
