// Textos del Círculo SS. Las reglas de conteo (gramos, 10% del referido, tope) viven en la base de
// datos: supabase/migrations, privado.circulo_reglas() y privado.circulo_hitos().
// Desde el 17 nov 2026 el Círculo se mide en gramos comprados (antes, interacciones).

/**
 * Qué gana el cliente en cada nivel (definidos por los socios el 17 nov 2026), por gramos. En minúscula
 * porque van dentro de frases ("Ya has logrado conseguir una manilla…"); donde salen solos se pone la mayúscula.
 */
export const PREMIOS: Record<number, string> = {
  5: 'una manilla con 10 balines',
  10: '10 balines más',
  15: '10 balines más',
};

/** Gramos de cada nivel (los mismos de privado.circulo_hitos()). */
export const HITOS = [5, 10, 15] as const;

/** El premio de un nivel como título (con mayúscula inicial), para listas y tablas. */
export const premioTitulo = (hito: number) => {
  const p = PREMIOS[hito] ?? `premio de los ${hito} g`;
  return p.charAt(0).toLocaleUpperCase('es') + p.slice(1);
};

/** Número del nivel (1, 2 o 3) de un hito en gramos. */
export const numeroNivel = (hito: number) => HITOS.indexOf(hito as (typeof HITOS)[number]) + 1;

/** El contador se detiene aquí (gramos). */
export const TOPE = 15;

/** Gramos para mostrar: "7,35 g", "5 g". */
export const gramos = (g: number) => `${Number(g).toLocaleString('es-CO', { maximumFractionDigits: 2 })} g`;

/** Frase de ánimo debajo del próximo premio, según el avance (al completar ya no hace falta). */
export const animo = (g: number) =>
  g < 5 ? '¡Lo lograrás pronto!' : g < 10 ? 'Estás cerca de ser un miembro avanzado.' : g < 15 ? 'Estás cerca de llegar a la ÉLITE.' : '';
