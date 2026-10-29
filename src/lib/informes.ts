// Informes cruzados de ventas e inventario (fase 4D). Los datos salen de las vistas piezas_vendidas
// y unidades_detalle; aquí solo se agrupan y se suman.

/** Fila de la vista piezas_vendidas. */
export interface PiezaVendida {
  id: string;
  venta_id: string;
  fecha: string;
  anulada: boolean;
  referencia: string;
  descripcion: string;
  peso_gramos: number;
  producto_id: string | null;
  codigo: string | null;
  categoria: string | null;
  lote_fecha: string | null;
  precio_cop: number | null;
  descuento_cop: number | null;
  precio_neto_cop: number | null;
  costo_cop: number | null;
  margen_cop: number | null;
  dias_en_inventario: number | null;
}

export interface Totales {
  ventas: number;
  piezas: number;
  gramos: number;
  bruto: number;
  descuentos: number;
  ingresos: number;
  /** Costo y margen solo de las piezas que tienen costo (las del inventario). */
  costo: number;
  margen: number;
  ingresosConCosto: number;
  sinCosto: number;
  diasPromedio: number | null;
}

/** Suma un grupo de piezas vendidas (con precio). */
export function totalizar(piezas: PiezaVendida[]): Totales {
  const t: Totales = {
    ventas: new Set(piezas.map((p) => p.venta_id)).size,
    piezas: piezas.length,
    gramos: 0,
    bruto: 0,
    descuentos: 0,
    ingresos: 0,
    costo: 0,
    margen: 0,
    ingresosConCosto: 0,
    sinCosto: 0,
    diasPromedio: null,
  };
  let dias = 0;
  let conDias = 0;
  for (const p of piezas) {
    t.gramos += Number(p.peso_gramos);
    t.bruto += Number(p.precio_cop ?? 0);
    t.descuentos += Number(p.descuento_cop ?? 0);
    t.ingresos += Number(p.precio_neto_cop ?? 0);
    if (p.costo_cop != null) {
      t.costo += Number(p.costo_cop);
      t.margen += Number(p.margen_cop ?? 0);
      t.ingresosConCosto += Number(p.precio_neto_cop ?? 0);
    } else {
      t.sinCosto += 1;
    }
    if (p.dias_en_inventario != null) {
      dias += p.dias_en_inventario;
      conDias += 1;
    }
  }
  t.diasPromedio = conDias ? Math.round(dias / conDias) : null;
  return t;
}

/** Agrupa por una clave y devuelve [clave, totales] ordenado por ingresos de mayor a menor. */
export function agrupar(piezas: PiezaVendida[], clave: (p: PiezaVendida) => string): [string, Totales][] {
  const grupos = new Map<string, PiezaVendida[]>();
  for (const p of piezas) {
    const k = clave(p);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(p);
  }
  return [...grupos.entries()].map(([k, g]) => [k, totalizar(g)] as [string, Totales]).sort((a, b) => b[1].ingresos - a[1].ingresos);
}

/** Margen sobre los ingresos de las piezas con costo, en porcentaje entero. */
export function porcentajeMargen(t: Totales): string {
  return t.ingresosConCosto > 0 ? `${Math.round((t.margen / t.ingresosConCosto) * 100)} %` : '—';
}

const MESES = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** '2026-10' → 'octubre de 2026'. */
export function nombreMes(clave: string): string {
  return MESES.format(new Date(`${clave}-01T00:00:00Z`));
}

/** Primer día del mes y hoy (AAAA-MM-DD), como rango por defecto. */
export function rangoDelMes(hoy: string): { desde: string; hasta: string } {
  return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
}

/** Días entre dos fechas AAAA-MM-DD. */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);
}
