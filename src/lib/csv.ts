/** Convierte filas a CSV (separador coma, comillas cuando hace falta, BOM para que Excel lea las tildes). */
export function aCsv(columnas: string[], filas: Record<string, unknown>[]): string {
  const celda = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = Array.isArray(v) ? v.join(' ') : String(v);
    // Evita que Excel interprete el contenido como fórmula.
    if (/^[=+\-@]/.test(s) && !/^[+-]?\d/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [columnas.join(','), ...filas.map((f) => columnas.map((c) => celda(f[c])).join(','))];
  return '﻿' + lineas.join('\r\n') + '\r\n';
}
