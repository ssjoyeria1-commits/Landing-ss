import type { Supabase } from './supabase';
import type { FormatoCsv } from './csv';
import { nombreCompleto, type ClienteCirculo } from './clientes';
import { formatoWhatsapp } from './whatsapp';
import type { PiezaVendida } from './informes';
import type { UnidadDetalle } from './inventario';

const LOTE = 1000; // máximo de filas que Supabase devuelve por consulta

/** Trae todas las filas de una consulta, en lotes. */
async function traerTodo<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += LOTE) {
    const { data, error } = await consulta(desde, desde + LOTE - 1);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as T[];
    filas.push(...lote);
    if (lote.length < LOTE) return filas;
  }
}

export interface Exportacion {
  titulo: string;
  descripcion: string;
  formato: FormatoCsv;
  generar: (supabase: Supabase) => Promise<{ encabezados: string[]; filas: unknown[][] }>;
}

interface PiezaDb {
  descripcion: string;
  peso_gramos: number;
  ley: string;
  orden: number;
}

interface VentaDb {
  id: string;
  cliente_id: string;
  fecha: string;
  monto_cop: number;
  nota: string | null;
  anulada: boolean;
  created_at: string;
  cajas: {
    referencia: string;
    es_regalo: boolean;
    nombre_destinatario: string | null;
    created_at: string;
    piezas: PiezaDb[];
  }[];
}

async function ventasConClientes(supabase: Supabase) {
  const [ventas, clientes] = await Promise.all([
    traerTodo<VentaDb>((d, h) =>
      supabase
        .from('ventas')
        .select(
          'id, cliente_id, fecha, monto_cop, nota, anulada, created_at, cajas(referencia, es_regalo, nombre_destinatario, created_at, piezas(descripcion, peso_gramos, ley, orden))',
        )
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false })
        .range(d, h),
    ),
    traerTodo<ClienteCirculo>((d, h) => supabase.from('clientes_circulo').select('*').order('id').range(d, h)),
  ]);
  const porId = new Map(clientes.map((c) => [c.id, c]));
  for (const v of ventas) {
    v.cajas.sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const caja of v.cajas) caja.piezas.sort((a, b) => a.orden - b.orden);
  }
  return { ventas, cliente: (id: string) => porId.get(id)! };
}

const redondear = (n: number) => Math.round(n * 100) / 100;

export const EXPORTACIONES: Record<string, Exportacion> = {
  // ----- Informes para leer en Excel -----
  'informe-ventas': {
    titulo: 'Informe de ventas',
    descripcion: 'Una fila por venta, de la más reciente a la más antigua.',
    formato: 'excel',
    async generar(supabase) {
      const { ventas, cliente } = await ventasConClientes(supabase);
      return {
        encabezados: [
          'Fecha', 'Cliente', 'WhatsApp', 'Código del cliente', 'Referido por', 'Monto (COP)',
          'Cajas', 'Referencias', 'Regalos', 'Piezas', 'Peso total (g)', 'Estado', 'Nota',
        ],
        filas: ventas.map((v) => {
          const c = cliente(v.cliente_id);
          const piezas = v.cajas.flatMap((caja) => caja.piezas);
          const regalos = v.cajas
            .filter((caja) => caja.es_regalo)
            .map((caja) => (caja.nombre_destinatario ? `Para ${caja.nombre_destinatario}` : 'Sí'));
          return [
            v.fecha,
            nombreCompleto(c),
            formatoWhatsapp(c.whatsapp),
            c.codigo_referido,
            c.referido_por_codigo ?? '',
            v.monto_cop,
            v.cajas.length,
            v.cajas.map((caja) => caja.referencia),
            regalos.length ? regalos : 'No',
            piezas.map((p) => `${p.descripcion} (${String(p.peso_gramos).replace('.', ',')} g, ${p.ley})`).join(' | '),
            redondear(piezas.reduce((total, p) => total + Number(p.peso_gramos), 0)),
            v.anulada ? 'Anulada' : 'Activa',
            v.nota ?? '',
          ];
        }),
      };
    },
  },

  'informe-piezas': {
    titulo: 'Detalle de piezas vendidas',
    descripcion: 'Una fila por pieza, con su caja y su venta.',
    formato: 'excel',
    async generar(supabase) {
      const { ventas, cliente } = await ventasConClientes(supabase);
      return {
        encabezados: [
          'Fecha', 'Cliente', 'Referencia de la caja', 'Regalo para', 'Pieza', 'Peso (g)', 'Ley', 'Estado de la venta',
        ],
        filas: ventas.flatMap((v) =>
          v.cajas.flatMap((caja) =>
            caja.piezas.map((p) => [
              v.fecha,
              nombreCompleto(cliente(v.cliente_id)),
              caja.referencia,
              caja.es_regalo ? caja.nombre_destinatario || 'Sí (sin nombre)' : '',
              p.descripcion,
              Number(p.peso_gramos),
              p.ley,
              v.anulada ? 'Anulada' : 'Activa',
            ]),
          ),
        ),
      };
    },
  },

  'informe-ventas-por-pieza': {
    titulo: 'Ventas por pieza, con costo y margen',
    descripcion: 'Una fila por pieza vendida con precio: producto, categoría, descuento repartido, costo, margen y días en inventario.',
    formato: 'excel',
    async generar(supabase) {
      const filas = await traerTodo<PiezaVendida>((d, h) =>
        supabase
          .from('piezas_vendidas')
          .select('*')
          .not('precio_cop', 'is', null)
          .order('fecha', { ascending: false })
          .order('id')
          .range(d, h),
      );
      return {
        encabezados: [
          'Fecha', 'Referencia de la caja', 'Código', 'Pieza', 'Categoría', 'Peso (g)', 'Precio (COP)',
          'Descuento (COP)', 'Precio neto (COP)', 'Costo (COP)', 'Margen (COP)', 'Margen (%)', 'Fecha del lote',
          'Días en inventario', 'Estado de la venta',
        ],
        filas: filas.map((p) => [
          p.fecha,
          p.referencia,
          p.codigo ?? '',
          p.descripcion,
          p.categoria ?? '',
          Number(p.peso_gramos),
          Number(p.precio_cop),
          Number(p.descuento_cop ?? 0),
          Number(p.precio_neto_cop),
          p.costo_cop == null ? '' : Number(p.costo_cop),
          p.margen_cop == null ? '' : Number(p.margen_cop),
          p.margen_cop == null || !p.precio_neto_cop ? '' : redondear((Number(p.margen_cop) / Number(p.precio_neto_cop)) * 100),
          p.lote_fecha ?? '',
          p.dias_en_inventario ?? '',
          p.anulada ? 'Anulada' : 'Activa',
        ]),
      };
    },
  },

  'informe-inventario': {
    titulo: 'Inventario disponible',
    descripcion: 'Una fila por pieza disponible: producto, categoría, peso, lote, costo y precio de venta de hoy.',
    formato: 'excel',
    async generar(supabase) {
      const filas = await traerTodo<UnidadDetalle>((d, h) =>
        supabase
          .from('unidades_detalle')
          .select('*')
          .eq('estado', 'disponible')
          .order('codigo')
          .order('peso_gramos')
          .order('id')
          .range(d, h),
      );
      return {
        encabezados: [
          'Código', 'Producto', 'Categoría', 'Peso (g)', 'Fecha del lote', 'Proveedor', 'Oro por gramo (COP)',
          'Mano de obra por gramo (COP)', 'Costo (COP)', 'Precio de venta hoy (COP)',
        ],
        filas: filas.map((u) => [
          u.codigo,
          u.producto,
          u.categoria,
          Number(u.peso_gramos),
          u.lote_fecha,
          u.proveedor ?? '',
          Number(u.oro_gramo_cop),
          Number(u.mano_obra_gramo_cop),
          Number(u.costo_cop),
          Number(u.precio_cop),
        ]),
      };
    },
  },

  'informe-clientes': {
    titulo: 'Clientes y Círculo SS',
    descripcion: 'Una fila por cliente, en orden alfabético, con su contador y premios.',
    formato: 'excel',
    async generar(supabase) {
      const [clientes, premios] = await Promise.all([
        traerTodo<ClienteCirculo>((d, h) =>
          supabase.from('clientes_circulo').select('*').order('nombre').order('apellido').range(d, h),
        ),
        traerTodo<{ cliente_id: string; hito: number }>((d, h) =>
          supabase.from('premios').select('cliente_id, hito').order('hito').range(d, h),
        ),
      ]);
      const entregados = new Map<string, number[]>();
      for (const p of premios) entregados.set(p.cliente_id, [...(entregados.get(p.cliente_id) ?? []), p.hito]);

      return {
        encabezados: [
          'Cliente', 'WhatsApp', 'Código de referido', 'Referido por', 'Compras que cuentan',
          'Por referidos', 'Interacciones', 'Próximo nivel', 'Premios entregados', 'Premios pendientes',
          'Autorizó datos', 'Fecha de autorización', 'Cliente desde',
        ],
        filas: clientes.map((c) => [
          nombreCompleto(c),
          formatoWhatsapp(c.whatsapp),
          c.codigo_referido,
          c.referido_por_codigo ?? '',
          c.propias,
          c.por_referidos,
          c.interacciones,
          c.proximo_hito ?? 'Completo',
          entregados.get(c.id) ?? [],
          c.premios_pendientes,
          c.autorizo_datos,
          c.autorizo_datos_fecha ?? '',
          c.created_at.slice(0, 10),
        ]),
      };
    },
  },
};

// ----- Respaldo técnico: copia exacta de las tablas, con identificadores -----

const RESPALDO: Record<string, { columnas: string[]; orden: string }> = {
  clientes: {
    columnas: [
      'id', 'nombre', 'apellido', 'whatsapp', 'codigo_referido', 'referido_por',
      'autorizo_datos', 'autorizo_datos_fecha', 'created_at',
    ],
    orden: 'created_at',
  },
  ventas: {
    columnas: ['id', 'cliente_id', 'fecha', 'monto_cop', 'descuento_cop', 'nota', 'anulada', 'anulada_at', 'created_at'],
    orden: 'created_at',
  },
  cajas: { columnas: ['id', 'venta_id', 'referencia', 'codigo_chip', 'es_regalo', 'nombre_destinatario', 'created_at'], orden: 'created_at' },
  piezas: {
    columnas: ['id', 'caja_id', 'descripcion', 'peso_gramos', 'ley', 'orden', 'unidad_id', 'precio_cop', 'costo_cop'],
    orden: 'id',
  },
  premios: { columnas: ['id', 'cliente_id', 'hito', 'fecha_entrega', 'nota', 'created_at'], orden: 'created_at' },
  escaneos: { columnas: ['id', 'caja_id', 'created_at'], orden: 'id' },
  categorias: { columnas: ['id', 'nombre', 'mano_obra_gramo_cop', 'precio_gramo_cop', 'activa', 'created_at'], orden: 'created_at' },
  productos: { columnas: ['id', 'codigo', 'nombre', 'categoria_id', 'stock_minimo', 'activo', 'nota', 'created_at'], orden: 'created_at' },
  proveedores: { columnas: ['id', 'nombre', 'contacto', 'nota', 'activo', 'created_at'], orden: 'created_at' },
  lotes: { columnas: ['id', 'proveedor_id', 'fecha', 'oro_gramo_cop', 'nota', 'creado_por', 'created_at'], orden: 'created_at' },
  unidades: { columnas: ['id', 'lote_id', 'producto_id', 'peso_gramos', 'mano_obra_gramo_cop', 'estado', 'created_at'], orden: 'created_at' },
};

for (const [tabla, { columnas, orden }] of Object.entries(RESPALDO)) {
  EXPORTACIONES[`respaldo-${tabla}`] = {
    titulo: `Tabla ${tabla}`,
    descripcion: '',
    formato: 'estandar',
    async generar(supabase) {
      const filas = await traerTodo<Record<string, unknown>>((d, h) =>
        supabase.from(tabla).select(columnas.join(',')).order(orden).range(d, h),
      );
      return { encabezados: columnas, filas: filas.map((f) => columnas.map((c) => f[c])) };
    },
  };
}
