const PESOS = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const FECHA = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "maría josé" → "María José". Respeta el resto de cada palabra (p. ej. "McDonald"). */
export function capitalizar(texto: string): string {
  return texto.replace(/(^|[\s-])(\p{L})/gu, (_, antes: string, letra: string) => antes + letra.toLocaleUpperCase('es'));
}

export function pesos(monto: number): string {
  return PESOS.format(monto);
}

/** Fecha 'AAAA-MM-DD' (columna date de Postgres) a texto. */
export function fecha(valor: string | null): string {
  return valor ? FECHA.format(new Date(`${valor.slice(0, 10)}T00:00:00Z`)) : '';
}

/** Fecha de hoy en Colombia, 'AAAA-MM-DD'. */
export function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}
