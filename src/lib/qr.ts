// QR de respaldo de cada caja: la misma URL que se graba en el sticker NFC, para el celular que no lee
// el chip. Se dibuja en el servidor como SVG (sin JavaScript en el navegador).
import { renderSVG } from 'uqr';

/**
 * SVG del QR (corrección de errores M: se sigue leyendo con un 15 % dañado o tapado). Solo trae
 * viewBox, así toma el tamaño de su contenedor.
 */
export function qrSvg(texto: string): string {
  return renderSVG(texto, { ecc: 'M', border: 2 }).replace(
    '<svg ',
    '<svg role="img" aria-label="Código QR de la caja" shape-rendering="crispEdges" ',
  );
}
