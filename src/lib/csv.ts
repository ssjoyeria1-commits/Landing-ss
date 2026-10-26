/**
 * Arma un CSV. Con BOM para que Excel lea las tildes.
 *
 * Formatos:
 * - 'excel': separador punto y coma y decimales con coma, como espera Excel configurado en
 *   español (Colombia). Con coma, Excel pone cada fila completa en una sola columna.
 * - 'estandar': separador coma y decimales con punto, para respaldos que se vuelven a cargar.
 */
export type FormatoCsv = 'excel' | 'estandar';

export function aCsv(encabezados: string[], filas: unknown[][], formato: FormatoCsv): string {
  const separador = formato === 'excel' ? ';' : ',';

  const celda = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s: string;
    if (typeof v === 'boolean') s = formato === 'excel' ? (v ? 'Sí' : 'No') : String(v);
    else if (typeof v === 'number') s = formato === 'excel' ? String(v).replace('.', ',') : String(v);
    else if (Array.isArray(v)) s = v.join(', ');
    else s = String(v);
    // Evita que Excel interprete el contenido como fórmula.
    if (/^[=+\-@]/.test(s) && !/^[+-]?\d/.test(s)) s = `'${s}`;
    return s.includes(separador) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lineas = [encabezados, ...filas].map((fila) => fila.map(celda).join(separador));
  return '﻿' + lineas.join('\r\n') + '\r\n';
}
