import { createClient } from '@supabase/supabase-js';
import { env } from 'cloudflare:workers';

export interface PiezaPublica {
  descripcion: string;
  peso_gramos: number;
  ley: string;
}

export interface CajaPropia {
  tipo: 'propia';
  referencia: string;
  nombre: string;
  piezas: PiezaPublica[];
  circulo: {
    interacciones: number;
    hitos: number[];
    proximo_hito: number | null;
    codigo_referido: string;
  };
}

export interface CajaRegalo {
  tipo: 'regalo';
  referencia: string;
  nombre_destinatario: string | null;
  nombre_comprador: string;
  codigo_referido_comprador: string;
  piezas: PiezaPublica[];
}

export type CajaPublica = CajaPropia | CajaRegalo;

const FORMATO_CODIGO = /^[a-km-np-z2-9]{10}$/;

/** Datos públicos de una caja (ver public.pagina_caja). null si el código no existe o la venta se anuló. */
export async function obtenerCaja(codigo: string): Promise<CajaPublica | null> {
  if (!FORMATO_CODIGO.test(codigo)) return null;
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc('pagina_caja', { p_codigo: codigo });
  if (error) throw new Error(error.message);
  return data as CajaPublica | null;
}

export function peso(gramos: number): string {
  return `${Number(gramos).toLocaleString('es-CO', { maximumFractionDigits: 2 })} g`;
}
