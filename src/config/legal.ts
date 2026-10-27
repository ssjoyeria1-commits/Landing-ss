// Textos de /garantia y /datos. PENDIENTE: los entregan los socios (términos de la garantía y
// política de tratamiento de datos, Ley 1581 de 2012). Mientras una lista esté vacía, la página
// muestra un aviso y el botón de WhatsApp en lugar del texto.

export interface SeccionLegal {
  titulo: string;
  parrafos: string[];
}

/** Términos completos de la garantía. PENDIENTE. */
export const TERMINOS_GARANTIA: SeccionLegal[] = [];

/** Política de tratamiento de datos personales (habeas data). PENDIENTE. */
export const POLITICA_DATOS: SeccionLegal[] = [];

/** Fecha de la última actualización de cada texto (AAAA-MM-DD). PENDIENTE. */
export const ACTUALIZADO = { garantia: '', datos: '' };
