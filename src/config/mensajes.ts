// Plantillas de los mensajes prellenados de WhatsApp. Editar aquí el texto.

import { gramos, numeroNivel, PREMIOS, TOPE } from './circulo';

export const MENSAJES = {
  /** Cliente que comparte su código con un amigo. */
  compartir: (codigoReferido: string) =>
    `Hola, me recomendaron SS Joyería. Mi código de referido: ${codigoReferido}`,

  /** Quien recibió un regalo escribe a la línea de atención. */
  destinatarioRegalo: (codigoReferidoComprador: string) =>
    `Hola, me regalaron una pieza de SS Joyería y quiero conocer el Círculo. Código de referido: ${codigoReferidoComprador}`,

  /** Alguien del catálogo web muestra interés en una pieza (con el peso que eligió, si eligió uno). */
  interesCatalogo: (nombre: string, codigo: string, peso?: string) =>
    `Hola, vi en el catálogo de SS Joyería la pieza ${nombre} (${codigo})${peso ? ` de ${peso}` : ''} y me interesa.`,

  /** Alguien muestra interés en una pieza agotada del catálogo web (solo interés, sin preguntar). */
  agotadoCatalogo: (nombre: string, codigo: string) =>
    `Hola, vi en el catálogo de SS Joyería la pieza ${nombre} (${codigo}) y me encantó. Me interesa para cuando vuelva.`,

  /** El socio le manda a un aliado su enlace privado al catálogo con precios de aliado. */
  enlaceAliado: (nombre: string, url: string) =>
    `Hola ${nombre}, este es tu catálogo de SS Joyería con tus precios de aliado y lo disponible hoy: ${url}\nEs solo para ti: no lo compartas con tus clientes (para ellos, comparte las fotos desde ahí).`,

  /** Reclamo de garantía desde el certificado de la caja. */
  garantia: (referenciaCaja: string) =>
    `Hola, quiero reclamar la garantía de mi pieza. Referencia de la caja: ${referenciaCaja}`,

  /** Aviso al comprador desde el panel, con el estado de su contador. */
  avisoComprador: (c: { nombre: string; gramos: number; proximoHito: number | null; codigoReferido: string }) => {
    const estado = `Tu Círculo SS va en ${gramos(c.gramos)} de ${TOPE} g.`;
    const siguiente =
      c.proximoHito === null
        ? 'Ya completaste todos los niveles. ¡Gracias por ser parte del Círculo!'
        : `Te faltan ${gramos(c.proximoHito - c.gramos)} para el nivel ${numeroNivel(c.proximoHito)}: ${PREMIOS[c.proximoHito] ?? ''}.`;
    return `Hola ${c.nombre}, te escribimos de SS Joyería. ${estado} ${siguiente} Recuerda que tu código de referido es ${c.codigoReferido}.`;
  },
};
