// Plantillas de los mensajes prellenados de WhatsApp. Editar aquí el texto.

import { PREMIOS, TOPE } from './circulo';

export const MENSAJES = {
  /** Cliente que comparte su código con un amigo. */
  compartir: (codigoReferido: string) =>
    `Hola, me recomendaron SS Joyería. Mi código de referido: ${codigoReferido}`,

  /** Quien recibió un regalo escribe a la línea de atención. */
  destinatarioRegalo: (codigoReferidoComprador: string) =>
    `Hola, me regalaron una pieza de SS Joyería y quiero conocer el Círculo. Código de referido: ${codigoReferidoComprador}`,

  /** Reclamo o consulta de garantía. */
  garantia: (referenciaCaja: string) =>
    `Hola, tengo una consulta sobre la garantía de mi pieza. Referencia de la caja: ${referenciaCaja}`,

  /** Aviso al comprador desde el panel, con el estado de su contador. */
  avisoComprador: (c: { nombre: string; interacciones: number; proximoHito: number | null; codigoReferido: string }) => {
    const estado = `Tu Círculo SS va en ${c.interacciones} de ${TOPE} interacciones.`;
    const siguiente =
      c.proximoHito === null
        ? 'Ya completaste todos los niveles. ¡Gracias por ser parte del Círculo!'
        : `Te ${c.proximoHito - c.interacciones === 1 ? 'falta 1' : `faltan ${c.proximoHito - c.interacciones}`} para el nivel ${c.proximoHito}: ${PREMIOS[c.proximoHito] ?? ''}.`;
    return `Hola ${c.nombre}, te escribimos de SS Joyería. ${estado} ${siguiente} Recuerda que tu código de referido es ${c.codigoReferido}.`;
  },
};
