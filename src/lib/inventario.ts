// Inventario. Fase 4A: categorías y productos (referencias). Fase 4B: proveedores, lotes y cada pieza
// física con su propio peso. Ver supabase/migrations/20261028120000_catalogo.sql y 20261028130000_lotes.sql.
import { capitalizar } from './formato';
import { leerMonto, leerPeso } from './venta';

export interface Categoria {
  id: string;
  nombre: string;
  mano_obra_gramo_cop: number;
  precio_gramo_cop: number;
  activa: boolean;
}

/** Fila de la vista productos_catalogo. */
export interface ProductoCatalogo {
  id: string;
  codigo: string;
  nombre: string;
  categoria_id: string;
  categoria: string;
  precio_gramo_cop: number;
  mano_obra_gramo_cop: number;
  stock_minimo: number;
  activo: boolean;
  nota: string | null;
}

const texto = (form: FormData, campo: string) => String(form.get(campo) ?? '').trim();

/** Código de referencia: mayúsculas, sin espacios ("an 014" → "AN-014"). */
export function normalizarCodigo(valor: string): string {
  return valor.trim().toUpperCase().replace(/\s+/g, '-');
}

export function leerCategoria(
  form: FormData,
): { datos: Omit<Categoria, 'id'> } | { error: string } {
  const nombre = capitalizar(texto(form, 'nombre'));
  const manoObra = leerMonto(texto(form, 'mano_obra'));
  const precio = leerMonto(texto(form, 'precio_gramo'));
  if (!nombre) return { error: 'Escribe el nombre de la categoría.' };
  if (!Number.isSafeInteger(manoObra) || manoObra < 0) return { error: 'Escribe la mano de obra por gramo en pesos.' };
  if (!Number.isSafeInteger(precio) || precio <= 0) return { error: 'Escribe el precio de venta por gramo en pesos.' };
  return {
    datos: { nombre, mano_obra_gramo_cop: manoObra, precio_gramo_cop: precio, activa: form.get('activa') === 'on' },
  };
}

export interface ProductoForm {
  codigo: string;
  nombre: string;
  categoria_id: string;
  stock_minimo: number;
  activo: boolean;
  nota: string | null;
}

export function leerProducto(form: FormData): { datos: ProductoForm } | { error: string } {
  const codigo = normalizarCodigo(texto(form, 'codigo'));
  const nombre = texto(form, 'nombre');
  const categoria = texto(form, 'categoria_id');
  const minimo = Number(texto(form, 'stock_minimo') || '0');
  if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(codigo)) {
    return { error: 'El código debe tener de 2 a 20 letras, números o guiones, p. ej. AN-014.' };
  }
  if (!nombre) return { error: 'Escribe el nombre del producto.' };
  if (!categoria) return { error: 'Elige la categoría.' };
  if (!Number.isInteger(minimo) || minimo < 0) return { error: 'El stock mínimo debe ser un número entero.' };
  return {
    datos: {
      codigo,
      nombre: nombre.charAt(0).toLocaleUpperCase('es') + nombre.slice(1),
      categoria_id: categoria,
      stock_minimo: minimo,
      activo: form.get('activo') === 'on',
      nota: texto(form, 'nota') || null,
    },
  };
}

export interface Proveedor {
  id: string;
  nombre: string;
  contacto: string | null;
  nota: string | null;
  activo: boolean;
}

/** Fila de la vista existencias. */
export interface Existencia {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string;
  precio_gramo_cop: number;
  stock_minimo: number;
  activo: boolean;
  disponibles: number;
  gramos: number;
  costo_cop: number;
  valor_cop: number;
  bajo_minimo: boolean;
}

/** Fila de la vista unidades_detalle. */
export interface UnidadDetalle {
  id: string;
  lote_id: string;
  lote_fecha: string;
  proveedor: string | null;
  producto_id: string;
  codigo: string;
  producto: string;
  categoria: string;
  peso_gramos: number;
  estado: 'disponible' | 'vendida' | 'baja';
  oro_gramo_cop: number;
  mano_obra_gramo_cop: number;
  costo_cop: number;
  precio_cop: number;
}

/** Fila de la vista lotes_resumen. */
export interface LoteResumen {
  id: string;
  fecha: string;
  proveedor_id: string | null;
  proveedor: string | null;
  oro_gramo_cop: number;
  nota: string | null;
  piezas: number;
  disponibles: number;
  gramos: number;
  costo_cop: number;
}

export function leerProveedor(form: FormData): { datos: Omit<Proveedor, 'id'> } | { error: string } {
  const nombre = texto(form, 'nombre');
  if (!nombre) return { error: 'Escribe el nombre del proveedor.' };
  return {
    datos: {
      nombre,
      contacto: texto(form, 'contacto') || null,
      nota: texto(form, 'nota') || null,
      activo: form.get('activo') === 'on',
    },
  };
}

export interface PayloadLote {
  proveedor_id: string | null;
  fecha: string | null;
  oro_gramo_cop: number;
  nota: string | null;
  piezas: { producto_id: string; peso_gramos: number }[];
}

/** Máximo de piezas iguales por fila o línea pegada. */
const MAX_CANTIDAD = 500;

/**
 * Parte una línea pegada desde Excel en código, peso y cantidad (opcional, por defecto 1).
 * Con tabuladores o punto y coma, cada columna es un dato; si no, se separa por espacios.
 */
export function partirLinea(linea: string): string[] {
  const t = linea.trim();
  return (/[\t;]/.test(t) ? t.split(/[\t;]+/) : t.split(/\s+/)).map((x) => x.trim()).filter(Boolean);
}

function leerCantidad(valor: string | undefined): number {
  const n = valor ? Number(valor) : 1;
  return Number.isInteger(n) && n >= 1 && n <= MAX_CANTIDAD ? n : NaN;
}

/**
 * Arma el JSON de registrar_lote. Las piezas llegan de dos lados: las filas del formulario
 * (pieza-{i}-producto, pieza-{i}-peso y pieza-{i}-cantidad) y el cuadro "pegar desde Excel", con
 * una fila por línea: código, peso y cantidad opcional ("AN-014  3,12  10"). La cantidad repite la
 * pieza con el mismo peso, para cuando llegan varias iguales.
 * `productos` traduce códigos a ids (solo productos activos).
 */
export function leerLote(
  form: FormData,
  productos: Map<string, string>,
): { payload: PayloadLote } | { error: string } {
  const oro = leerMonto(texto(form, 'oro_gramo'));
  if (!Number.isSafeInteger(oro) || oro <= 0) return { error: 'Escribe el costo del oro por gramo de este lote.' };

  const piezas: PayloadLote['piezas'] = [];
  const agregar = (producto_id: string, peso_gramos: number, cantidad: number) => {
    for (let k = 0; k < cantidad; k++) piezas.push({ producto_id, peso_gramos });
  };

  const filas = new Map<string, { producto?: string; peso?: string; cantidad?: string }>();
  for (const [clave, valor] of form.entries()) {
    const m = clave.match(/^pieza-(\d+)-(producto|peso|cantidad)$/);
    if (m) filas.set(m[1], { ...filas.get(m[1]), [m[2]]: String(valor).trim() });
  }
  let n = 0;
  for (const { producto, peso, cantidad } of filas.values()) {
    n += 1;
    if (!producto && !peso) continue; // fila vacía
    const gramos = leerPeso(peso ?? '');
    const veces = leerCantidad(cantidad);
    if (!producto) return { error: `Fila ${n}: elige el producto.` };
    if (!(gramos > 0)) return { error: `Fila ${n}: el peso no es válido (usa por ejemplo 3,12).` };
    if (Number.isNaN(veces)) return { error: `Fila ${n}: la cantidad debe ser un número entero de 1 a ${MAX_CANTIDAD}.` };
    agregar(producto, gramos, veces);
  }

  const pegado = texto(form, 'pegado');
  const lineas = pegado ? pegado.split(/\r?\n/) : [];
  for (const [i, linea] of lineas.entries()) {
    if (!linea.trim()) continue;
    const partes = partirLinea(linea);
    if (partes.length < 2) return { error: `Línea ${i + 1} pegada: falta el código o el peso ("${linea.trim()}").` };
    const codigo = normalizarCodigo(partes[0]);
    const id = productos.get(codigo);
    const gramos = leerPeso(partes[1]);
    const veces = leerCantidad(partes[2]);
    if (!id) return { error: `Línea ${i + 1} pegada: no hay un producto activo con el código ${codigo}.` };
    if (!(gramos > 0)) return { error: `Línea ${i + 1} pegada: el peso de ${codigo} no es válido.` };
    if (Number.isNaN(veces)) return { error: `Línea ${i + 1} pegada: la cantidad de ${codigo} no es válida.` };
    agregar(id, gramos, veces);
  }

  if (piezas.length === 0) return { error: 'Agrega al menos una pieza con su peso.' };
  return {
    payload: {
      proveedor_id: texto(form, 'proveedor_id') || null,
      fecha: texto(form, 'fecha') || null,
      oro_gramo_cop: oro,
      nota: texto(form, 'nota') || null,
      piezas,
    },
  };
}

/** Gramos para mostrar: "3,12 g". */
export function gramos(valor: number): string {
  return `${Number(valor).toLocaleString('es-CO', { maximumFractionDigits: 2 })} g`;
}

/** Traduce los errores de Postgres que el socio puede corregir. */
export function mensajeError(mensaje: string): string {
  if (/categorias_nombre_unico/.test(mensaje)) return 'Ya existe una categoría con ese nombre.';
  if (/productos_codigo_key/.test(mensaje)) return 'Ya existe un producto con ese código.';
  if (/proveedores_nombre_unico/.test(mensaje)) return 'Ya existe un proveedor con ese nombre.';
  if (/No se puede (borrar|cambiar) una pieza vendida/.test(mensaje)) {
    return 'Ese lote tiene piezas vendidas: no se puede borrar ni cambiar esas piezas.';
  }
  if (/foreign key/.test(mensaje)) return 'No se puede borrar: hay productos que la usan. Desactívala en su lugar.';
  return mensaje;
}
