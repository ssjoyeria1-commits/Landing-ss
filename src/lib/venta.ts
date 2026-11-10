import { capitalizar } from './formato';
import { normalizarWhatsapp } from './whatsapp';

/** Todas las piezas de SS Joyería son de oro de 18 quilates: el formulario ya no pregunta la ley. */
export const LEY = '18k';

/** Largo máximo del mensaje del regalo (igual que en la base de datos). */
export const MAX_MENSAJE_REGALO = 300;

/** Mensaje del regalo tal como se guarda: sin espacios de sobra, saltos de línea simples, null si vacío. */
export function limpiarMensajeRegalo(valor: string): string | null {
  const limpio = valor.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return limpio || null;
}

/** Pieza del inventario (peso, precio y costo salen de ahí) o escrita a mano con su precio. */
export type PiezaForm =
  | { unidad_id: string }
  | { descripcion: string; peso_gramos: number; ley: string; precio_cop: number };

export interface CajaForm {
  es_regalo: boolean;
  nombre_destinatario: string | null;
  /** Mensaje del comprador que se ve en la bienvenida del regalo. */
  mensaje_regalo: string | null;
  piezas: PiezaForm[];
}

export interface PayloadVenta {
  cliente: {
    whatsapp: string;
    nombre: string;
    apellido: string | null;
    autorizo_datos: boolean;
    autorizo_datos_fecha: string | null;
  };
  codigo_referido_de: string | null;
  /** El monto lo calcula registrar_venta: suma de los precios de las piezas menos el descuento. */
  descuento_cop: number;
  fecha: string | null;
  nota: string | null;
  cajas: CajaForm[];
}

const texto = (form: FormData, campo: string) => String(form.get(campo) ?? '').trim();

/** Montos como "850.000" o "850000". */
export function leerMonto(valor: string): number {
  const digitos = valor.replace(/\D/g, '');
  return digitos ? Number(digitos) : NaN;
}

/** Pesos como "5,25" o "5.25". */
export function leerPeso(valor: string): number {
  return Number(valor.replace(',', '.'));
}

type CampoPieza = 'origen' | 'unidad' | 'descripcion' | 'peso' | 'precio';

/**
 * Arma el JSON de registrar_venta a partir del formulario. Los nombres de las cajas y piezas
 * siguen el patrón caja-{i}-regalo, caja-{i}-destinatario, caja-{i}-mensaje y caja-{i}-pieza-{j}-{campo}.
 * Cada pieza es del inventario (campo unidad) o escrita a mano (descripción, peso y precio).
 * Valida lo que la base de datos no puede explicar bien; el resto lo valida registrar_venta.
 */
export function leerFormularioVenta(form: FormData): { payload: PayloadVenta } | { error: string } {
  const whatsapp = normalizarWhatsapp(texto(form, 'whatsapp'), texto(form, 'pais'));
  if (!whatsapp) return { error: 'El número de WhatsApp no es válido para el país elegido.' };

  const descuentoTexto = texto(form, 'descuento');
  const descuento = descuentoTexto ? leerMonto(descuentoTexto) : 0;
  if (!Number.isSafeInteger(descuento) || descuento < 0) return { error: 'El descuento no es válido.' };

  const cajas = new Map<number, CajaForm>();
  const caja = (i: number) => {
    if (!cajas.has(i)) cajas.set(i, { es_regalo: false, nombre_destinatario: null, mensaje_regalo: null, piezas: [] });
    return cajas.get(i)!;
  };
  const piezas = new Map<string, Partial<Record<CampoPieza, string>>>();

  for (const [clave, valorBruto] of form.entries()) {
    const valor = String(valorBruto).trim();
    let m = clave.match(/^caja-(\d+)-(regalo|destinatario|mensaje)$/);
    if (m) {
      const c = caja(Number(m[1]));
      if (m[2] === 'regalo') c.es_regalo = valor === 'on';
      else if (m[2] === 'mensaje') c.mensaje_regalo = limpiarMensajeRegalo(valor);
      else c.nombre_destinatario = valor ? capitalizar(valor) : null;
      continue;
    }
    m = clave.match(/^caja-(\d+)-pieza-(\d+)-(origen|unidad|descripcion|peso|precio)$/);
    if (m) {
      caja(Number(m[1]));
      const id = `${m[1]}-${m[2]}`;
      piezas.set(id, { ...piezas.get(id), [m[3]]: valor });
    }
  }

  for (const [id, p] of piezas) {
    const [i] = id.split('-').map(Number);
    if (p.origen === 'inventario') {
      if (!p.unidad) continue; // fila sin elegir
      caja(i).piezas.push({ unidad_id: p.unidad });
      continue;
    }
    if (!p.descripcion && !p.peso && !p.precio) continue; // fila vacía
    const peso = leerPeso(p.peso ?? '');
    const precio = leerMonto(p.precio ?? '');
    if (!p.descripcion) return { error: `Caja ${i + 1}: falta la descripción de una pieza.` };
    if (!(peso > 0)) return { error: `Caja ${i + 1}: el peso de "${p.descripcion}" no es válido.` };
    if (!Number.isSafeInteger(precio) || precio <= 0) return { error: `Caja ${i + 1}: falta el precio de "${p.descripcion}".` };
    caja(i).piezas.push({ descripcion: p.descripcion, peso_gramos: peso, ley: LEY, precio_cop: precio });
  }

  const listaCajas = [...cajas.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
  for (const [i, c] of listaCajas.entries()) {
    if (!c.es_regalo) {
      c.nombre_destinatario = null;
      c.mensaje_regalo = null;
    } else if (c.mensaje_regalo && c.mensaje_regalo.length > MAX_MENSAJE_REGALO) {
      return { error: `Caja ${i + 1}: el mensaje del regalo puede tener hasta ${MAX_MENSAJE_REGALO} caracteres.` };
    }
  }

  return {
    payload: {
      cliente: {
        whatsapp,
        nombre: capitalizar(texto(form, 'nombre')),
        apellido: capitalizar(texto(form, 'apellido')) || null,
        autorizo_datos: form.get('autorizo_datos') === 'on',
        autorizo_datos_fecha: texto(form, 'autorizo_datos_fecha') || null,
      },
      codigo_referido_de: texto(form, 'codigo_referido_de') || null,
      descuento_cop: descuento,
      fecha: texto(form, 'fecha') || null,
      nota: texto(form, 'nota') || null,
      cajas: listaCajas,
    },
  };
}

export interface PayloadVentaAliado {
  aliado_id: string;
  /** Cuántas piezas de cada producto y peso; registrar_venta_aliado elige las del lote más antiguo. */
  lineas: { producto_id: string; peso_gramos: number; cantidad: number }[];
  descuento_cop: number;
  fecha: string | null;
  nota: string | null;
}

/**
 * Arma el JSON de registrar_venta_aliado a partir del formulario de venta en modo aliado: campos
 * aliado_id y, por cada fila, linea-producto, linea-peso y linea-cantidad (repetidos, en orden).
 */
export function leerVentaAliado(form: FormData): { payload: PayloadVentaAliado } | { error: string } {
  const aliado_id = texto(form, 'aliado_id');
  if (!aliado_id) return { error: 'Elige el aliado.' };

  const descuentoTexto = texto(form, 'descuento');
  const descuento = descuentoTexto ? leerMonto(descuentoTexto) : 0;
  if (!Number.isSafeInteger(descuento) || descuento < 0) return { error: 'El descuento no es válido.' };

  const productos = form.getAll('linea-producto').map((v) => String(v).trim());
  const pesos = form.getAll('linea-peso').map((v) => String(v).trim());
  const cantidades = form.getAll('linea-cantidad').map((v) => String(v).trim());
  const lineas: PayloadVentaAliado['lineas'] = [];
  for (let i = 0; i < productos.length; i++) {
    if (!productos[i] && !pesos[i]) continue; // fila sin elegir
    if (!productos[i]) return { error: `Pieza ${i + 1}: elige el producto.` };
    if (!pesos[i]) return { error: `Pieza ${i + 1}: elige el peso.` };
    const cantidad = Number(cantidades[i] || '1');
    if (!Number.isInteger(cantidad) || cantidad <= 0) return { error: `Pieza ${i + 1}: la cantidad debe ser un número entero.` };
    lineas.push({ producto_id: productos[i], peso_gramos: Number(pesos[i]), cantidad });
  }
  if (lineas.length === 0) return { error: 'Agrega al menos una pieza.' };

  return {
    payload: {
      aliado_id,
      lineas,
      descuento_cop: descuento,
      fecha: texto(form, 'fecha') || null,
      nota: texto(form, 'nota') || null,
    },
  };
}

/** Cobro de la venta: medio de pago y domicilio (lo cobrado al cliente y lo pagado al mensajero). */
export interface CobroVenta {
  medio_pago_id: string | null;
  domicilio_cobrado_cop: number;
  domicilio_pagado_cop: number;
}

export function leerCobro(form: FormData): { cobro: CobroVenta } | { error: string } {
  const valor = (campo: string) => {
    const t = texto(form, campo);
    return t ? leerMonto(t) : 0;
  };
  const cobrado = valor('domicilio_cobrado');
  const pagado = valor('domicilio_pagado');
  if (!Number.isSafeInteger(cobrado) || cobrado < 0) return { error: 'El domicilio cobrado no es un monto válido.' };
  if (!Number.isSafeInteger(pagado) || pagado < 0) return { error: 'Lo pagado al mensajero no es un monto válido.' };
  return { cobro: { medio_pago_id: texto(form, 'medio_pago_id') || null, domicilio_cobrado_cop: cobrado, domicilio_pagado_cop: pagado } };
}
