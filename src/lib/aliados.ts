// Aliados: personas que venden con comisión. Cada uno tiene un enlace privado a su catálogo con
// precios de aliado (supabase/migrations/20261106120000_aliados.sql).
import { capitalizar } from './formato';
import { normalizarWhatsapp } from './whatsapp';

export interface Aliado {
  id: string;
  nombre: string;
  whatsapp: string | null;
  token: string;
  activo: boolean;
  nota: string | null;
  ultimo_acceso: string | null;
  created_at: string;
}

/** Dirección del catálogo de un aliado en el sitio actual. */
export const urlAliado = (origen: string, token: string) => `${origen}/aliados/${token}`;

/** Lee el formulario de un aliado. El WhatsApp es opcional; sin indicativo se toma de Colombia. */
export function leerAliado(
  form: FormData,
): { datos: Pick<Aliado, 'nombre' | 'whatsapp' | 'nota'> } | { error: string } {
  const nombre = capitalizar(String(form.get('nombre') ?? '').trim().replace(/\s+/g, ' '));
  const numero = String(form.get('whatsapp') ?? '').trim();
  const nota = String(form.get('nota') ?? '').trim();
  if (!nombre) return { error: 'Escribe el nombre del aliado.' };
  if (nombre.length > 80) return { error: 'El nombre puede tener hasta 80 caracteres.' };
  const whatsapp = numero ? normalizarWhatsapp(numero, 'CO') : null;
  if (numero && !whatsapp) return { error: 'El WhatsApp no es válido. Si no es de Colombia, escríbelo con su indicativo (+…).' };
  return { datos: { nombre, whatsapp, nota: nota || null } };
}
