// Textos del Círculo SS. Las reglas de conteo (monto mínimo, referidos, tope) viven en la base
// de datos: supabase/migrations, función privado.circulo_reglas().

/**
 * Qué gana el cliente en cada hito (definidos por los socios el 11 nov 2026). En minúscula porque van
 * dentro de frases ("Ya has logrado conseguir el pack…"); donde salen solos se pone la mayúscula.
 */
export const PREMIOS: Record<number, string> = {
  3: 'el pack de bienvenida al club de los mejores',
  5: 'la manilla de los miembros avanzados',
  10: 'la manilla de los miembros élite',
};

/** El premio de un nivel como título (con mayúscula inicial), para listas y tablas. */
export const premioTitulo = (nivel: number) => {
  const p = PREMIOS[nivel] ?? `premio del nivel ${nivel}`;
  return p.charAt(0).toLocaleUpperCase('es') + p.slice(1);
};

export const TOPE = 10;

/** Frase de ánimo debajo del próximo premio, según el avance (con 10 ya no hace falta). */
export const animo = (interacciones: number) =>
  interacciones <= 2
    ? '¡Lo lograrás pronto!'
    : interacciones <= 4
      ? 'Estás cerca de ser un miembro avanzado.'
      : interacciones <= 9
        ? 'Estás cerca de llegar a la ÉLITE.'
        : '';
