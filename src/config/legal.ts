// Textos de /garantia y /datos. PENDIENTE: los términos de la garantía los entregan los socios.
// Mientras una lista esté vacía, la página muestra un aviso y el botón de WhatsApp en lugar del texto.

import { SITIO } from './sitio';

export interface SeccionLegal {
  titulo: string;
  parrafos: string[];
}

/** Términos completos de la garantía. PENDIENTE. */
export const TERMINOS_GARANTIA: SeccionLegal[] = [];

/**
 * Responsable del tratamiento: la ley exige que la política diga quién es, su identificación, domicilio y
 * correo. PENDIENTE de los socios. Mientras falte un dato, /datos sigue mostrando el aviso (la política no
 * se publica incompleta).
 */
export const RESPONSABLE = {
  /** Nombre de la persona natural o razón social de la empresa dueña de SS Joyería. */
  nombre: 'Sebastian Gonzalez',
  /** "NIT 900.000.000-0" o "C.C. 1.000.000.000". */
  identificacion: 'C.C. 1.077.430.442',
  /** Ciudad y dirección de notificación. */
  domicilio: 'Carrera 50A # 24-51, Itagüí (Antioquia)',
  /** Correo para consultas y reclamos de datos personales. */
  correo: 'ssjoyeria001@gmail.com',
};

/** Fecha de la última actualización de cada texto (AAAA-MM-DD). La de datos se pone al publicarla. */
export const ACTUALIZADO = { garantia: '', datos: '2026-11-28' };

/** "+573135218785" → "+57 313 521 8785". */
const telefono = (t: string) => t.replace(/^\+57(\d{3})(\d{3})(\d{4})$/, '+57 $1 $2 $3');

/**
 * Política de tratamiento de datos personales (Ley 1581 de 2012 y Decreto 1377 de 2013, compilado en el
 * Decreto 1074 de 2015). Describe lo que el sistema guarda de verdad: si cambia lo que se guarda o para qué,
 * hay que actualizar este texto y su fecha. Borrador del 27 nov 2026: conviene que lo revise un abogado.
 */
const POLITICA: SeccionLegal[] = [
  {
    titulo: '1. Quién trata tus datos',
    parrafos: [
      `${RESPONSABLE.nombre}, identificado con ${RESPONSABLE.identificacion}, con domicilio en ${RESPONSABLE.domicilio}, dueño de la marca SS Joyería, es el responsable del tratamiento de tus datos personales.`,
      `Puedes contactarnos por WhatsApp al ${telefono(SITIO.whatsappNegocio)} o al correo ${RESPONSABLE.correo}. Los socios de SS Joyería atienden directamente las consultas y reclamos sobre datos personales.`,
      'Esta política cumple la Ley 1581 de 2012, el Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015) y las demás normas que las modifiquen o complementen.',
    ],
  },
  {
    titulo: '2. Qué datos recogemos',
    parrafos: [
      'Solo pedimos lo necesario para atenderte. No pedimos tu número de documento, tu dirección ni datos sensibles (salud, origen, creencias, datos biométricos u otros).',
      '– De nuestros clientes: nombre y apellido, número de WhatsApp con su país, el código del Círculo SS, quién te recomendó (si alguien lo hizo), tus compras (fecha, piezas, peso, valor, medio de pago y costo del domicilio), los premios del Círculo y la fecha en que nos diste tu autorización.',
      '– De las cajas de regalo: el primer nombre de quien recibe el regalo y el mensaje que escribe quien lo regala. Ese mensaje lo escribe el comprador; te pedimos no incluir en él datos de otras personas.',
      '– De la página de tu caja: cada vez que alguien la abre guardamos la fecha y la hora, sin datos de tu celular ni de tu ubicación.',
      '– Por seguridad, la dirección IP de quien visita la página de una caja o el panel se usa durante un minuto para limitar intentos repetidos y se borra sola. No la asociamos a ninguna persona.',
      '– De nuestros aliados (personas que venden nuestras piezas): nombre, WhatsApp, las ventas, los pagos y la fecha del último ingreso a su catálogo.',
      '– Del catálogo: el pedido que armas en el catálogo queda solo en tu navegador; a nosotros solo nos llega lo que tú nos envías por WhatsApp. No usamos cookies de publicidad ni de analítica.',
    ],
  },
  {
    titulo: '3. Para qué usamos tus datos',
    parrafos: [
      '– Registrar tu compra y crear la página de tu caja, con tus piezas, su certificado de oro 18k y la garantía.',
      '– Atender garantías, cambios y preguntas sobre tus piezas.',
      '– Llevar tu avance en el Círculo SS: sumar los gramos de tus compras y de la primera compra de las personas que recomiendes, y entregarte los premios.',
      '– Escribirte por WhatsApp sobre tu compra, tu garantía, tus premios y el Círculo SS.',
      '– Enviarte novedades de SS Joyería, si nos autorizas. Puedes pedir en cualquier momento que no te enviemos más.',
      '– Llevar la contabilidad del negocio y cumplir obligaciones legales, contables y tributarias.',
      '– Proteger el sitio contra abusos y saber cuántas veces se abre cada caja.',
      'No vendemos, alquilamos ni compartimos tus datos con otras empresas para que te ofrezcan sus productos.',
    ],
  },
  {
    titulo: '4. Qué se ve en la página de tu caja',
    parrafos: [
      'La página que se abre con el chip de tu caja muestra solo tu primer nombre, tus piezas, su certificado y tu avance en el Círculo SS. Nunca muestra tu número de WhatsApp, tu apellido ni los datos de las personas que recomendaste.',
      'En una caja de regalo se ven el primer nombre de quien recibe, el de quien regala y el mensaje del regalo.',
      'Cualquier persona que acerque su celular al chip o tenga el enlace puede ver esa página. Si pierdes la caja o crees que alguien más tiene el enlace, escríbenos y cambiamos el código del chip.',
    ],
  },
  {
    titulo: '5. Tu autorización',
    parrafos: [
      'Te pedimos autorización antes de guardar tus datos, por la línea de WhatsApp de atención, y anotamos la fecha en que nos la diste. Puedes revocarla cuando quieras (ver la sección 8).',
      'Cuando compras un regalo y nos das el nombre de quien lo recibe, nos confirmas que esa persona está de acuerdo. Si el regalo es para un niño, niña o adolescente, solo usamos su primer nombre para la página de la caja, con respeto por sus derechos y su interés superior.',
      'Si te recomienda otra persona, ella solo ve los gramos que suma por tu compra, nunca tus datos.',
    ],
  },
  {
    titulo: '6. Quién más maneja tus datos',
    parrafos: [
      'Para que el sitio funcione usamos proveedores que guardan o transportan los datos por encargo nuestro, solo para prestarnos su servicio y con medidas de seguridad:',
      '– Supabase, donde está la base de datos, con servidores en São Paulo (Brasil).',
      '– Cloudflare, que publica el sitio y lo protege; tiene servidores en varios países.',
      '– WhatsApp (de Meta), por donde hablamos contigo. Lo que escribas allí también se rige por la política de WhatsApp.',
      'Como algunos de estos servidores están fuera de Colombia, al darnos tu autorización también nos autorizas a enviar tus datos a esos proveedores fuera del país, solo para las finalidades de esta política.',
      'Fuera de estos casos, solo entregamos tus datos a una autoridad que los pida por ley.',
    ],
  },
  {
    titulo: '7. Cómo los protegemos',
    parrafos: [
      'Todo el sitio va por conexión cifrada (https). Solo los socios de SS Joyería entran al panel, con su usuario y contraseña. La base de datos no deja que un visitante lea información de otros clientes. Cada chip tiene un código al azar difícil de adivinar y el sitio limita los intentos repetidos.',
      'Ningún sistema es infalible. Si ocurriera un incidente que afecte tus datos, lo informaremos a la Superintendencia de Industria y Comercio y a ti, como manda la ley.',
    ],
  },
  {
    titulo: '8. Tus derechos',
    parrafos: [
      'Como titular de tus datos tienes derecho a:',
      '– Conocer, actualizar y corregir tus datos.',
      '– Pedir prueba de la autorización que nos diste.',
      '– Saber cómo hemos usado tus datos.',
      '– Revocar tu autorización o pedir que borremos tus datos, cuando no tengamos un deber legal o contractual de conservarlos.',
      '– Consultar tus datos gratis, al menos una vez al mes y cada vez que cambie esta política.',
      '– Presentar quejas ante la Superintendencia de Industria y Comercio, después de haber hecho tu consulta o reclamo con nosotros.',
    ],
  },
  {
    titulo: '9. Cómo hacer una consulta o un reclamo',
    parrafos: [
      `Escríbenos por WhatsApp al ${telefono(SITIO.whatsappNegocio)} o al correo ${RESPONSABLE.correo}. Dinos tu nombre, el número de WhatsApp con el que compraste y qué necesitas. Si lo pide otra persona por ti, debe mostrar que te representa.`,
      'Consultas (saber qué datos tenemos y cómo los usamos): te respondemos en máximo 10 días hábiles. Si no alcanzamos, te avisamos por qué y te respondemos en máximo 5 días hábiles más.',
      'Reclamos (corregir, actualizar o borrar tus datos, o revocar la autorización): te respondemos en máximo 15 días hábiles. Si no alcanzamos, te avisamos por qué y te respondemos en máximo 8 días hábiles más. Si al reclamo le falta información, te la pedimos en los 5 días siguientes; si pasan 2 meses sin que nos la envíes, entenderemos que desististe.',
      'Mientras resolvemos un reclamo, marcamos tus datos como "en reclamo".',
    ],
  },
  {
    titulo: '10. Por cuánto tiempo guardamos tus datos',
    parrafos: [
      'Guardamos tus datos mientras seas cliente o aliado y mientras dure la garantía de tus piezas. Los registros de las ventas los conservamos el tiempo que exige la ley contable y comercial (hasta 10 años).',
      'Si pides que borremos tus datos, los borramos de todo lo que no tengamos que conservar por ley. Lo que debamos conservar queda solo para cumplir esa obligación.',
      'Las fechas en que se abre cada caja se borran junto con la caja.',
    ],
  },
  {
    titulo: '11. Cambios a esta política',
    parrafos: [
      'Si cambiamos esta política, publicamos la nueva versión en esta página con su fecha. Si el cambio es importante, por ejemplo una nueva finalidad, te avisamos por WhatsApp antes de aplicarlo y, si hace falta, te pedimos una nueva autorización.',
      'Esta política rige desde la fecha que aparece arriba. Las bases de datos estarán vigentes mientras SS Joyería ofrezca sus productos.',
    ],
  },
];

const completo = Object.values(RESPONSABLE).every((v) => v.trim() !== '') && ACTUALIZADO.datos !== '';

/** Política de tratamiento de datos personales (habeas data). Vacía mientras falten los datos del responsable. */
export const POLITICA_DATOS: SeccionLegal[] = completo ? POLITICA : [];
