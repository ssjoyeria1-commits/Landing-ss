// Textos de la página del chip. Los marcados como PENDIENTE los entregan los socios.

export const TEXTOS = {
  /** Resumen corto de la garantía. PENDIENTE: plazos y respuesta concreta. */
  garantiaResumen:
    'Tu pieza está respaldada por SS Joyería. Si notas algún defecto, escríbenos y te decimos cómo hacer válida tu garantía.',

  circuloIntro:
    'Cada compra desde $600.000 y cada persona que nos recomiendes y haga su primera compra suma una interacción. Al llegar a 3, 5 y 10 recibes un premio.',

  /** Cuidados básicos del oro. Revisar con los socios. */
  cuidado: [
    'Quítatela para nadar, hacer ejercicio o limpiar con químicos.',
    'Aplica perfume, cremas y laca antes de ponértela.',
    'Guárdala sola, en su caja o en una bolsa suave, para que no se raye.',
    'Límpiala con agua tibia, jabón suave y un paño que no suelte pelusa.',
  ],

  /** Círculo en la versión de regalo: quien recibe no ve el contador del comprador. */
  circuloRegalo: (comprador: string) =>
    `Es nuestro programa para quienes nos eligen: cada compra desde $600.000 y cada persona que nos recomiendan suma, y al llegar a 3, 5 y 10 reciben un premio. Si te animas a tu primera compra desde $600.000, también le suma a ${comprador}.`,

  etiquetar: 'Si la luces, etiquétanos en tus fotos. Nos encanta ver cómo la llevas.',
};
