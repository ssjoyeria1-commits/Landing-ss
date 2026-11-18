// Carrito del catálogo público. Vive solo en el navegador del visitante (localStorage): no llega a la
// base ni a SS hasta que el visitante lo manda por WhatsApp. Sin datos personales.
// Lo usa el script de src/components/catalogo/Carrito.astro y el botón "Agregar al carrito" de la ficha.

export interface LineaCarrito {
  codigo: string;
  nombre: string;
  peso_gramos: number;
  /** Precio de una pieza al momento de agregarla (el catálogo lo actualiza al volver a abrirse). */
  precio_cop: number;
  cantidad: number;
}

/** Lo que el catálogo tiene hoy: código, peso y precio. */
export interface Disponible {
  codigo: string;
  peso_gramos: number;
  precio_cop: number;
}

const CLAVE = 'ss-carrito';
export const MAXIMO_POR_LINEA = 999;
/** Aviso a los demás scripts de la página (y a la burbuja) de que el carrito cambió. */
export const EVENTO = 'ss-carrito';

const PESOS = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
export const pesos = (monto: number) => PESOS.format(monto);
export const peso = (gramos: number) => `${Number(gramos).toLocaleString('es-CO', { maximumFractionDigits: 2 })} g`;

const misma = (a: { codigo: string; peso_gramos: number }, b: { codigo: string; peso_gramos: number }) =>
  a.codigo === b.codigo && Number(a.peso_gramos) === Number(b.peso_gramos);

function valida(l: unknown): l is LineaCarrito {
  const x = l as LineaCarrito;
  return (
    !!x &&
    typeof x.codigo === 'string' &&
    typeof x.nombre === 'string' &&
    Number.isFinite(x.peso_gramos) &&
    Number.isFinite(x.precio_cop) &&
    Number.isInteger(x.cantidad) &&
    x.cantidad > 0
  );
}

/** El carrito guardado; vacío si no hay, si está dañado o si el navegador no deja leer. */
export function leer(): LineaCarrito[] {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE) ?? '[]');
    return Array.isArray(crudo) ? crudo.filter(valida) : [];
  } catch {
    return [];
  }
}

// Si el navegador no deja guardar (navegación privada, almacenamiento lleno), el carrito vive en
// memoria mientras la página esté abierta.
let sinAlmacen = false;
let memoria: LineaCarrito[] = [];

export function guardar(lineas: LineaCarrito[]): void {
  memoria = lineas;
  try {
    if (lineas.length === 0) localStorage.removeItem(CLAVE);
    else localStorage.setItem(CLAVE, JSON.stringify(lineas));
    sinAlmacen = false;
  } catch {
    sinAlmacen = true;
  }
  window.dispatchEvent(new CustomEvent(EVENTO));
}

export const actual = (): LineaCarrito[] => (sinAlmacen ? memoria.map((l) => ({ ...l })) : leer());

export function agregar(linea: Omit<LineaCarrito, 'cantidad'>, cantidad = 1): void {
  const lineas = actual();
  const ya = lineas.find((l) => misma(l, linea));
  if (ya) {
    ya.cantidad = Math.min(MAXIMO_POR_LINEA, ya.cantidad + cantidad);
    ya.precio_cop = linea.precio_cop;
    ya.nombre = linea.nombre;
  } else {
    lineas.push({ ...linea, cantidad: Math.min(MAXIMO_POR_LINEA, cantidad) });
  }
  guardar(lineas);
}

export function cambiarCantidad(i: number, cantidad: number): void {
  const lineas = actual();
  if (!lineas[i]) return;
  if (cantidad <= 0) lineas.splice(i, 1);
  else lineas[i].cantidad = Math.min(MAXIMO_POR_LINEA, Math.floor(cantidad));
  guardar(lineas);
}

export const unidades = (lineas: LineaCarrito[]) => lineas.reduce((n, l) => n + l.cantidad, 0);
export const total = (lineas: LineaCarrito[]) => lineas.reduce((n, l) => n + l.cantidad * l.precio_cop, 0);

/**
 * Pone el carrito al día con lo que hay hoy: quita lo que ya no está (vendido u oculto) y actualiza
 * precios. Solo revisa los códigos de `alcance` (la ficha conoce un solo producto); sin alcance, todos.
 * Devuelve cuántas líneas se quitaron.
 */
export function conciliar(disponibles: Disponible[], alcance?: string[]): number {
  const lineas = actual();
  const revisar = alcance ? new Set(alcance) : null;
  let quitadas = 0;
  let cambio = false;
  const quedan = lineas.filter((l) => {
    if (revisar && !revisar.has(l.codigo)) return true;
    const hoy = disponibles.find((d) => misma(d, l));
    if (!hoy) {
      quitadas++;
      return false;
    }
    if (hoy.precio_cop !== l.precio_cop) {
      l.precio_cop = hoy.precio_cop;
      cambio = true;
    }
    return true;
  });
  if (quitadas > 0 || cambio) guardar(quedan);
  return quitadas;
}

/** Mensaje de WhatsApp con el pedido: cada pieza con su peso, cantidad y precio, y el total. */
export function mensajePedido(lineas: LineaCarrito[]): string {
  const filas = lineas.map(
    (l) =>
      `• ${l.nombre} (${l.codigo}) · ${peso(l.peso_gramos)}${l.cantidad > 1 ? ` × ${l.cantidad}` : ''} · ${pesos(l.cantidad * l.precio_cop)}`,
  );
  return [
    'Hola, quiero hacer este pedido del catálogo de SS Joyería:',
    '',
    ...filas,
    '',
    `Total: ${pesos(total(lineas))}`,
    '¿Me confirman disponibilidad?',
  ].join('\n');
}
