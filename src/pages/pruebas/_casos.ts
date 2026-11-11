// SOLO DESARROLLO: datos de ejemplo de una caja para /pruebas/casos y /pruebas/certificado (el guion bajo
// hace que Astro no lo tome como página).
import type { CajaPremio, CajaPropia, CajaPublica, CajaRegalo } from '../../lib/caja';

const demo: CajaPropia = {
  tipo: 'propia',
  referencia: 'SS-4GKKS',
  fecha: '2026-10-24',
  nombre: 'valentina',
  piezas: [
    { descripcion: 'Cadena tejido lazo, 50 cm', peso_gramos: 3.5, ley: '18k' },
    { descripcion: 'Dije rombo con circón', peso_gramos: 1.2, ley: '18k' },
  ],
  circulo: { interacciones: 4, hitos: [3, 5, 10], proximo_hito: 5, codigo_referido: 'VALENTINA-8310' },
};

// Peor caso realista: primer nombre largo con guion (límite 60), descripciones cerca del límite de 120,
// ley de 20, 6 piezas y el código de referido más largo posible (12 letras + guion + 4 dígitos).
const peor: CajaPropia = {
  tipo: 'propia',
  referencia: 'SS-9XWQM',
  fecha: '2026-11-09',
  nombre: 'maximiliano-alejandro',
  piezas: [
    { descripcion: 'Anillo de compromiso solitario en oro blanco con diamante talla brillante de 0,30 ct y certificado gemológico', peso_gramos: 4.25, ley: 'Oro blanco 18k (750)' },
    { descripcion: 'Argollas de matrimonio media caña', peso_gramos: 12.75, ley: '18k' },
    { descripcion: 'Topos', peso_gramos: 0.8, ley: '18k' },
    { descripcion: 'Pulsera tejido cartier con dije de rombo calado y broche de seguridad', peso_gramos: 7.1, ley: 'Oro rosado 18k' },
    { descripcion: 'Cadena gargantilla 45 cm', peso_gramos: 2.33, ley: '14k' },
    { descripcion: 'Dije medalla Virgen del Carmen', peso_gramos: 1.5, ley: '18k' },
  ],
  circulo: { interacciones: 9, hitos: [3, 5, 10], proximo_hito: 10, codigo_referido: 'MAXIMILIANOA-4821' },
};

// Regalo: el destinatario se guarda con nombre completo; la página muestra solo el primero.
const regalo: CajaRegalo = {
  tipo: 'regalo',
  referencia: 'SS-7RTPA',
  fecha: '2026-11-06',
  nombre_destinatario: 'laura maría gómez',
  mensaje: 'Feliz cumpleaños, mi amor. Para que la lleves siempre contigo.',
  nombre_comprador: 'andrés',
  codigo_referido_comprador: 'ANDRES-5521',
  piezas: [{ descripcion: 'Aretes candonga lisos', peso_gramos: 2.1, ley: '18k' }],
};

// Caja de premio del Círculo: el de nivel 2 con nota, y el de la ÉLITE sin nota.
const premio: CajaPremio = {
  tipo: 'premio',
  referencia: 'SS-PR5MV',
  fecha: '2026-11-11',
  nombre: 'valentina',
  hito: 5,
  detalle: 'Tejido cartier con dije de rombo, 2,1 g',
  circulo: { interacciones: 6, hitos: [3, 5, 10], proximo_hito: 10, codigo_referido: 'VALENTINA-8310' },
};

export const casos: Record<string, CajaPublica | 'neutra' | 'temporal'> = {
  demo,
  peor,
  cero: { ...demo, nombre: 'jo', piezas: [demo.piezas[0]], circulo: { interacciones: 0, hitos: [3, 5, 10], proximo_hito: 3, codigo_referido: 'JO-0042' } },
  // Venta por cantidad: 25 balines iguales salen en una sola fila.
  balines: {
    ...demo,
    piezas: [demo.piezas[0], ...Array.from({ length: 25 }, () => ({ descripcion: 'Balin #3', peso_gramos: 0.03, ley: '18k' }))],
  },
  diez: { ...demo, circulo: { interacciones: 10, hitos: [3, 5, 10], proximo_hito: null, codigo_referido: 'VALENTINA-8310' } },
  regalo,
  // Peor caso del mensaje: casi 300 caracteres y un salto de párrafo.
  'regalo-sin-nombre': {
    ...regalo,
    nombre_destinatario: null,
    mensaje:
      'Laura: no encontré mejor forma de decirte gracias por estos diez años.\n\nCada vez que la veas, acuérdate de que aquí estoy, de las noches de risa, de los viajes que nos faltan y de todo lo que todavía vamos a vivir juntos. Te quiero más de lo que sé escribir en una tarjeta. Feliz aniversario.',
    nombre_comprador: 'maximiliano-alejandro',
    piezas: peor.piezas,
  },
  premio,
  'premio-elite': { ...premio, hito: 10, detalle: null, circulo: { interacciones: 10, hitos: [3, 5, 10], proximo_hito: null, codigo_referido: 'VALENTINA-8310' } },
  neutra: 'neutra',
  temporal: 'temporal',
};
