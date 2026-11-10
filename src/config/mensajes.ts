// Plantillas de los mensajes prellenados de WhatsApp. Editar aquí el texto.

import { PREMIOS, TOPE } from './circulo';

export const MENSAJES = {
  /** Cliente que comparte su código con un amigo. */
  compartir: (codigoReferido: string) =>
    `Hola, me recomendaron SS Joyería. Mi código de referido: ${codigoReferido}`,

  /** Quien recibió un regalo escribe a la línea de atención. */
  destinatarioRegalo: (codigoReferidoComprador: string) =>
    `Hola, me regalaron una pieza de SS Joyería y quiero conocer el Círculo. Código de referido: ${codigoReferidoComprador}`,

  /** Alguien del catálogo web pregunta por una pieza (con el peso que eligió, si eligió uno). */
  interesCatalogo: (nombre: string, codigo: string, peso?: string) =>
    `Hola, vi en el catálogo de SS Joyería la pieza ${nombre} (${codigo})${peso ? ` de ${peso}` : ''} y me interesa.`,

  /** El socio le manda a un aliado su enlace privado al catálogo con precios de aliado. */
  enlaceAliado: (nombre: string, url: string) =>
    `Hola ${nombre}, este es tu catálogo de SS Joyería con tus precios de aliado y lo disponible hoy: ${url}\nEs solo para ti: no lo compartas con tus clientes (para ellos, comparte las fotos desde ahí).`,

  /** Reclamo de garantía desde el certificado de la caja. */
  garantia: (referenciaCaja: string) =>
    `Hola, quiero reclamar la garantía de mi pieza. Referencia de la caja: ${referenciaCaja}`,

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
