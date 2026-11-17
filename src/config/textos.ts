// Textos de la página del chip. Los marcados como PENDIENTE los entregan los socios.

export const TEXTOS = {
  circuloIntro:
    'Cada gramo que compras suma a tu contador, y por cada persona que nos recomiendes sumas el 10% de los gramos de su primera compra. Al llegar a 5, 10 y 15 gramos recibes un premio.',

  /** Cuidados básicos del oro. Revisar con los socios. */
  cuidado: [
    'Quítatela para nadar, hacer ejercicio o limpiar con químicos.',
    'Aplica perfume, cremas y laca antes de ponértela.',
    'Guárdala sola, en su caja o en una bolsa suave, para que no se raye.',
    'Límpiala con agua tibia, jabón suave y un paño que no suelte pelusa.',
  ],

  /** Círculo en la versión de regalo: quien recibe no ve el contador del comprador. */
  circuloRegalo: (comprador: string) =>
    `Es nuestro programa para quienes nos eligen: cada gramo que compran suma, y al llegar a 5, 10 y 15 gramos reciben un premio. Si te animas a tu primera compra, también le suma a ${comprador}.`,

  etiquetar: 'Si la luces, etiquétanos en tus fotos. Nos encanta ver cómo la llevas.',
};
