// Cabeceras de seguridad de todas las respuestas del Worker. Las páginas estáticas (inicio,
// garantía, datos) no pasan por el Worker: llevan las mismas en public/_headers (mantener iguales).

/** Fotos del catálogo: bucket público de Supabase Storage. */
const ORIGEN_FOTOS = 'https://dtwlwoyvpcpbaswbkanx.supabase.co';

/**
 * Política de contenido: solo recursos del propio sitio (más las fotos de Supabase). Los scripts y
 * estilos en línea están permitidos porque Astro y el layout público los usan (entrada de las
 * tarjetas, cara de la fuente). Nadie puede meter el sitio en un iframe ni enviar formularios a otro.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${ORIGEN_FOTOS}`,
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const CABECERAS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/**
 * Agrega las cabeceras sin pisar las que la página ya fijó (la del chip pone su propio
 * Referrer-Policy). En desarrollo no se aplica la CSP: el servidor local inyecta scripts propios.
 */
export function conCabeceras(respuesta: Response, produccion: boolean): Response {
  let r = respuesta;
  for (const [nombre, valor] of Object.entries(CABECERAS)) {
    if (!produccion && nombre === 'Content-Security-Policy') continue;
    if (r.headers.has(nombre)) continue;
    try {
      r.headers.set(nombre, valor);
    } catch {
      // Cabeceras inmutables (respuestas de redirección de algunos entornos): se copia la respuesta.
      r = new Response(r.body, r);
      r.headers.set(nombre, valor);
    }
  }
  return r;
}
