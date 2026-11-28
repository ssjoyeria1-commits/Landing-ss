// Textos de la página del chip. Los marcados como PENDIENTE los entregan los socios.

export const TEXTOS = {
  circuloIntro:
    'Cada gramo que compras suma a tu contador, y por cada persona que nos recomiendes sumas el 10% de los gramos de su primera compra. Al llegar a 5, 10 y 15 gramos recibes un premio.',

  /**
   * Cuidados del oro (28 nov 2026, socios): sin hacer ver frágiles las joyas (el oro de 18k resiste cremas,
   * perfume y agua); el foco es el mal uso, los jalones y los enganches.
   */
  cuidado: [
    'Tu oro de 18k está hecho para llevarlo todos los días: el agua, las cremas y el perfume no le hacen daño.',
    'Evita los jalones: para quitártela, ábrela siempre por el broche, nunca la tires.',
    'Si se engancha en la ropa, el cabello o una toalla, suéltala con calma en lugar de halarla.',
    'Quítatela para dormir, hacer deporte de contacto o cargar peso, donde puede recibir tirones o golpes.',
    'Guárdala en su caja, sin enredarla con otras piezas. Para devolverle el brillo, agua tibia, jabón suave y un paño.',
  ],

  /** Círculo en la versión de regalo: quien recibe no ve el contador del comprador. */
  circuloRegalo: (comprador: string) =>
    `Es nuestro programa para quienes nos eligen: cada gramo que compran suma, y al llegar a 5, 10 y 15 gramos reciben un premio. Si te animas a tu primera compra, también le suma a ${comprador}.`,

  etiquetar: 'Si la luces, etiquétanos en tus fotos. Nos encanta ver cómo la llevas.',
};
