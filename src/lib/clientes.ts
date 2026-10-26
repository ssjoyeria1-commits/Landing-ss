import { MENSAJES } from '../config/mensajes';
import { enlaceWhatsApp } from './whatsapp';

/** Fila de la vista public.clientes_circulo. */
export interface ClienteCirculo {
  id: string;
  nombre: string;
  apellido: string | null;
  whatsapp: string;
  codigo_referido: string;
  referido_por: string | null;
  referido_por_codigo: string | null;
  autorizo_datos: boolean;
  autorizo_datos_fecha: string | null;
  created_at: string;
  propias: number;
  por_referidos: number;
  interacciones: number;
  proximo_hito: number | null;
  premios_pendientes: number[];
}

export function nombreCompleto(c: Pick<ClienteCirculo, 'nombre' | 'apellido'>): string {
  return [c.nombre, c.apellido].filter(Boolean).join(' ');
}

export function enlaceAviso(c: ClienteCirculo): string {
  return enlaceWhatsApp(
    c.whatsapp,
    MENSAJES.avisoComprador({
      nombre: c.nombre.split(' ')[0],
      interacciones: c.interacciones,
      proximoHito: c.proximo_hito,
      codigoReferido: c.codigo_referido,
    }),
  );
}

/** Quita caracteres que tienen significado en los filtros de PostgREST. */
export function limpiarBusqueda(q: string): string {
  return q.replace(/[,()*%\\:"']/g, ' ').trim().slice(0, 60);
}
