// Textos del Círculo SS. Las reglas de conteo (monto mínimo, referidos, tope) viven en la base
// de datos: supabase/migrations, función privado.circulo_reglas().

/** Qué gana el cliente en cada hito. PENDIENTE: definir los premios reales. */
export const PREMIOS: Record<number, string> = {
  3: 'Premio del nivel 3 (por definir)',
  5: 'Premio del nivel 5 (por definir)',
  10: 'Premio del nivel 10 (por definir)',
};

export const TOPE = 10;
