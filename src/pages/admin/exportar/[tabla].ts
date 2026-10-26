import type { APIRoute } from 'astro';
import { aCsv } from '../../../lib/csv';
import { hoyBogota } from '../../../lib/formato';

const LOTE = 1000; // máximo de filas que Supabase devuelve por consulta

const TABLAS: Record<string, { origen: string; columnas: string[]; orden: string }> = {
  clientes: {
    origen: 'clientes_circulo',
    orden: 'created_at',
    columnas: [
      'id', 'nombre', 'apellido', 'whatsapp', 'codigo_referido', 'referido_por_codigo',
      'autorizo_datos', 'autorizo_datos_fecha', 'propias', 'por_referidos', 'interacciones',
      'proximo_hito', 'premios_pendientes', 'created_at',
    ],
  },
  ventas: {
    origen: 'ventas',
    orden: 'created_at',
    columnas: ['id', 'cliente_id', 'fecha', 'monto_cop', 'nota', 'anulada', 'anulada_at', 'created_at'],
  },
  cajas: {
    origen: 'cajas',
    orden: 'created_at',
    columnas: ['id', 'venta_id', 'referencia', 'codigo_chip', 'es_regalo', 'nombre_destinatario', 'created_at'],
  },
  piezas: {
    origen: 'piezas',
    orden: 'id',
    columnas: ['id', 'caja_id', 'descripcion', 'peso_gramos', 'ley', 'orden'],
  },
  premios: {
    origen: 'premios',
    orden: 'created_at',
    columnas: ['id', 'cliente_id', 'hito', 'fecha_entrega', 'nota', 'created_at'],
  },
  escaneos: {
    origen: 'escaneos',
    orden: 'id',
    columnas: ['id', 'caja_id', 'created_at'],
  },
};

export const GET: APIRoute = async ({ params, locals }) => {
  const nombre = (params.tabla ?? '').replace(/\.csv$/, '');
  const tabla = TABLAS[nombre];
  if (!tabla) return new Response('No existe', { status: 404 });

  const filas: Record<string, unknown>[] = [];
  for (let desde = 0; ; desde += LOTE) {
    const { data, error } = await locals.supabase
      .from(tabla.origen)
      .select(tabla.columnas.join(','))
      .order(tabla.orden)
      .range(desde, desde + LOTE - 1);
    if (error) return new Response(`Error: ${error.message}`, { status: 500 });
    filas.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < LOTE) break;
  }

  return new Response(aCsv(tabla.columnas, filas), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ss-${nombre}-${hoyBogota()}.csv"`,
    },
  });
};
