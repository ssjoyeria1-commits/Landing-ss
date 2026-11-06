// Contabilidad del panel: periodos (semana, mes, año), lectura de ventas y gastos, y el estado de
// resultados de cada periodo (supabase/migrations/20261107120000_contabilidad.sql).
import type { Supabase } from './supabase';

/** Fila de la vista ventas_contables: ingresos, costos directos y utilidad de una venta. */
export interface VentaContable {
  id: string;
  fecha: string;
  anulada: boolean;
  cliente_id: string | null;
  aliado_id: string | null;
  tipo: 'cliente' | 'aliado';
  pagada_aliado_at: string | null;
  medio_pago_id: string | null;
  medio_pago: string | null;
  monto_cop: number;
  descuento_cop: number;
  domicilio_cobrado_cop: number;
  costo_piezas_cop: number;
  costo_completo: boolean;
  piezas: number;
  domicilio_pagado_cop: number;
  comision_pct: number;
  comision_cop: number;
  ingresos_cop: number;
  costos_cop: number;
  utilidad_cop: number;
}

export interface Gasto {
  id: string;
  fecha: string;
  categoria_id: string;
  descripcion: string;
  monto_cop: number;
  medio_pago_id: string | null;
  nota: string | null;
  created_at: string;
  categorias_gasto: { nombre: string } | null;
}

// ----- Periodos -----

export type Vista = 'semana' | 'mes' | 'anio';

export interface Periodo {
  vista: Vista;
  /** Identificador en la URL: lunes de la semana (2026-11-02), mes (2026-11) o año (2026). */
  clave: string;
  /** Primer y último día, inclusive (YYYY-MM-DD). */
  inicio: string;
  fin: string;
  etiqueta: string;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const aFecha = (iso: string) => new Date(`${iso}T00:00:00Z`);
const aIso = (d: Date) => d.toISOString().slice(0, 10);
const sumarDias = (iso: string, n: number) => {
  const d = aFecha(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return aIso(d);
};
const diaCorto = (iso: string) => {
  const d = aFecha(iso);
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()].slice(0, 3)}`;
};

/** Periodo que contiene una fecha (YYYY-MM-DD). La semana va de lunes a domingo. */
export function periodoDe(fecha: string, vista: Vista): Periodo {
  const d = aFecha(fecha);
  const anio = d.getUTCFullYear();
  if (vista === 'anio') return { vista, clave: String(anio), inicio: `${anio}-01-01`, fin: `${anio}-12-31`, etiqueta: String(anio) };
  if (vista === 'mes') {
    const m = d.getUTCMonth();
    const inicio = `${anio}-${String(m + 1).padStart(2, '0')}-01`;
    const fin = aIso(new Date(Date.UTC(anio, m + 1, 0)));
    const etiqueta = `${MESES[m][0].toUpperCase()}${MESES[m].slice(1)} ${anio}`;
    return { vista, clave: inicio.slice(0, 7), inicio, fin, etiqueta };
  }
  const lunes = sumarDias(fecha, -((d.getUTCDay() + 6) % 7));
  const domingo = sumarDias(lunes, 6);
  const anioFin = aFecha(domingo).getUTCFullYear();
  return { vista, clave: lunes, inicio: lunes, fin: domingo, etiqueta: `Semana del ${diaCorto(lunes)} al ${diaCorto(domingo)} ${anioFin}` };
}

/** Periodo a partir de la clave de la URL; si no es válida, el periodo de hoy. */
export function leerPeriodo(vista: Vista, clave: string | null, hoy: string): Periodo {
  if (clave) {
    if (vista === 'anio' && /^\d{4}$/.test(clave)) return periodoDe(`${clave}-01-01`, vista);
    if (vista === 'mes' && /^\d{4}-(0[1-9]|1[0-2])$/.test(clave)) return periodoDe(`${clave}-01`, vista);
    if (vista === 'semana' && /^\d{4}-\d{2}-\d{2}$/.test(clave) && !Number.isNaN(aFecha(clave).getTime())) return periodoDe(clave, vista);
  }
  return periodoDe(hoy, vista);
}

/** El periodo n pasos antes (n < 0) o después (n > 0). */
export function moverPeriodo(p: Periodo, n: number): Periodo {
  if (p.vista === 'semana') return periodoDe(sumarDias(p.inicio, 7 * n), 'semana');
  const d = aFecha(p.inicio);
  if (p.vista === 'mes') return periodoDe(aIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))), 'mes');
  return periodoDe(`${d.getUTCFullYear() + n}-01-01`, 'anio');
}

// ----- Lectura -----

const LOTE = 1000;

async function todas<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const filas: T[] = [];
  for (let desde = 0; ; desde += LOTE) {
    const { data, error } = await consulta(desde, desde + LOTE - 1);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as T[];
    filas.push(...lote);
    if (lote.length < LOTE) return filas;
  }
}

/** Ventas vigentes (no anuladas) y gastos entre dos fechas, inclusive. */
export async function leerMovimientos(supabase: Supabase, inicio: string, fin: string) {
  const [ventas, gastos] = await Promise.all([
    todas<VentaContable>((d, h) =>
      supabase.from('ventas_contables').select('*').eq('anulada', false).gte('fecha', inicio).lte('fecha', fin).order('fecha').order('id').range(d, h),
    ),
    todas<Gasto>((d, h) =>
      supabase.from('gastos').select('*, categorias_gasto(nombre)').gte('fecha', inicio).lte('fecha', fin).order('fecha').order('id').range(d, h),
    ),
  ]);
  return { ventas, gastos };
}

// ----- Estado de resultados -----

export interface Resumen {
  ventas: number;
  ventasClientes: number;
  ventasAliados: number;
  piezas: number;
  /** Piezas (total de las ventas, ya con descuento) de clientes y de aliados. */
  piezasClientesCop: number;
  piezasAliadosCop: number;
  descuentos: number;
  domicilioCobrado: number;
  ingresos: number;
  costoPiezas: number;
  mensajeros: number;
  comisiones: number;
  costosDirectos: number;
  utilidadBruta: number;
  gastos: number;
  gastosPorCategoria: Map<string, number>;
  utilidadNeta: number;
  /** Ventas a aliados del periodo que siguen sin pagar. */
  porCobrarAliados: number;
  /** Ventas con piezas escritas a mano sin costo: su utilidad está sobrestimada. */
  ventasSinCosto: number;
  porMedio: Map<string, { ventas: number; ingresos: number; comisiones: number }>;
}

export function resumir(ventas: VentaContable[], gastos: Gasto[]): Resumen {
  const n = (v: unknown) => Number(v ?? 0);
  const r: Resumen = {
    ventas: 0, ventasClientes: 0, ventasAliados: 0, piezas: 0, piezasClientesCop: 0, piezasAliadosCop: 0, descuentos: 0,
    domicilioCobrado: 0, ingresos: 0, costoPiezas: 0, mensajeros: 0, comisiones: 0, costosDirectos: 0,
    utilidadBruta: 0, gastos: 0, gastosPorCategoria: new Map(), utilidadNeta: 0, porCobrarAliados: 0, ventasSinCosto: 0,
    porMedio: new Map(),
  };
  for (const v of ventas) {
    if (v.anulada) continue;
    r.ventas += 1;
    if (v.tipo === 'aliado') {
      r.ventasAliados += 1;
      r.piezasAliadosCop += n(v.monto_cop);
      if (!v.pagada_aliado_at) r.porCobrarAliados += n(v.monto_cop);
    } else {
      r.ventasClientes += 1;
      r.piezasClientesCop += n(v.monto_cop);
    }
    r.piezas += n(v.piezas);
    r.descuentos += n(v.descuento_cop);
    r.domicilioCobrado += n(v.domicilio_cobrado_cop);
    r.ingresos += n(v.ingresos_cop);
    r.costoPiezas += n(v.costo_piezas_cop);
    r.mensajeros += n(v.domicilio_pagado_cop);
    r.comisiones += n(v.comision_cop);
    r.costosDirectos += n(v.costos_cop);
    r.utilidadBruta += n(v.utilidad_cop);
    if (!v.costo_completo) r.ventasSinCosto += 1;
    const medio = v.medio_pago ?? 'Sin definir';
    const m = r.porMedio.get(medio) ?? { ventas: 0, ingresos: 0, comisiones: 0 };
    m.ventas += 1;
    m.ingresos += n(v.ingresos_cop);
    m.comisiones += n(v.comision_cop);
    r.porMedio.set(medio, m);
  }
  for (const g of gastos) {
    r.gastos += n(g.monto_cop);
    const cat = g.categorias_gasto?.nombre ?? 'Sin categoría';
    r.gastosPorCategoria.set(cat, (r.gastosPorCategoria.get(cat) ?? 0) + n(g.monto_cop));
  }
  r.utilidadNeta = r.utilidadBruta - r.gastos;
  return r;
}

/** Porcentaje entero de a sobre b ("" si b es 0). */
export const porcentaje = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '');

/** Cambio frente al periodo anterior: "+12 %", "−5 %" o "" si el anterior es 0. */
export function cambio(actual: number, anterior: number): string {
  if (!anterior) return '';
  const p = Math.round(((actual - anterior) / Math.abs(anterior)) * 100);
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} %`;
}

// ----- Informe completo de un periodo -----

/** Cuántos periodos muestra el historial de cada vista. */
const HISTORIAL: Record<Vista, number> = { semana: 12, mes: 12, anio: 5 };

/** Fechas que hay que leer para armar el informe de un periodo (con su historial y el periodo anterior). */
export function rangoInforme(periodo: Periodo) {
  return { inicio: moverPeriodo(periodo, -(HISTORIAL[periodo.vista] - 1)).inicio, fin: periodo.fin };
}

/** Estado de resultados del periodo, del anterior, el historial (más reciente primero) y las ventas del periodo. */
export function armarInforme(ventas: VentaContable[], gastos: Gasto[], periodo: Periodo, hoy: string) {
  const en = (p: Periodo) => ({
    ventas: ventas.filter((v) => v.fecha >= p.inicio && v.fecha <= p.fin),
    gastos: gastos.filter((g) => g.fecha >= p.inicio && g.fecha <= p.fin),
  });
  const deP = (p: Periodo) => {
    const m = en(p);
    return resumir(m.ventas, m.gastos);
  };
  const anterior = moverPeriodo(periodo, -1);
  const siguiente = moverPeriodo(periodo, 1);
  // Si el periodo va en curso, se compara con el mismo tramo del anterior (del 1 al 7 contra del 1 al 7),
  // no con el periodo anterior completo.
  const enCurso = periodo.inicio <= hoy && hoy <= periodo.fin;
  const dias = Math.round((aFecha(hoy).getTime() - aFecha(periodo.inicio).getTime()) / 86_400_000);
  const finTramo = [sumarDias(anterior.inicio, dias), anterior.fin].sort()[0];
  const comparacion: Periodo = enCurso
    ? { ...anterior, fin: finTramo, etiqueta: `${diaCorto(anterior.inicio)} – ${diaCorto(finTramo)}${periodo.vista === 'mes' ? '' : ` ${aFecha(finTramo).getUTCFullYear()}`}` }
    : anterior;
  const historial = Array.from({ length: HISTORIAL[periodo.vista] }, (_, i) => moverPeriodo(periodo, -i)).map((p) => ({
    periodo: p,
    resumen: deP(p),
  }));
  return {
    periodo,
    anterior,
    siguiente: siguiente.inicio <= hoy ? siguiente : null,
    actual: historial[0].resumen,
    previo: deP(comparacion),
    comparacion,
    enCurso,
    historial,
    ventas: en(periodo).ventas,
  };
}
