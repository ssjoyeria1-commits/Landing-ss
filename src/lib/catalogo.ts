// Fotos del catálogo en Supabase Storage (bucket público "catalogo").
// Cada foto tiene dos archivos: {producto_id}/{id}.webp (grande, 1440 px en el lado corto) y
// {producto_id}/{id}-mini.webp (cuadrícula, 600 px en el lado corto). El panel las achica en el navegador antes de subirlas; nunca cambian (una foto nueva
// es un id nuevo), por eso se guardan con caché de un año.
import { createClient } from '@supabase/supabase-js';
import { env } from 'cloudflare:workers';
import type { Supabase } from './supabase';

export const BUCKET = 'catalogo';
export const MAX_FOTOS = 5;
/** Límite por archivo (igual al del bucket, migración 20261103130000). */
export const MAX_BYTES = 1024 * 1024;
/** Lado corto de cada tamaño: es el ancho que se anuncia en srcset (las fotos llenan un marco vertical). */
export const ANCHO = { grande: 1440, mini: 600 } as const;
const TIPOS = ['image/webp', 'image/jpeg'];

export interface FotoProducto {
  id: string;
  producto_id: string;
  orden: number;
}

const archivo = (ruta: string, tamano: 'grande' | 'mini') => `${ruta}${tamano === 'mini' ? '-mini' : ''}.webp`;

/** Origen de las fotos (Supabase Storage), para abrir la conexión antes de pedirlas. */
export const origenFotos = (): string => env.SUPABASE_URL;

/** Dirección pública de una foto; `ruta` es "{producto_id}/{id}". */
export function urlFoto(ruta: string, tamano: 'grande' | 'mini' = 'grande'): string {
  return `${env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${archivo(ruta, tamano)}`;
}

function valida(f: FormDataEntryValue | null): f is File {
  return f instanceof File && f.size > 0 && f.size <= MAX_BYTES && TIPOS.includes(f.type);
}

/** Guarda la foto (fila y dos archivos). Si algo falla, no deja nada a medias. */
export async function subirFoto(supabase: Supabase, productoId: string, form: FormData): Promise<string | null> {
  const grande = form.get('grande');
  const mini = form.get('mini');
  if (!valida(grande) || !valida(mini)) return 'La foto no llegó bien. Vuelve a elegirla.';

  const { data: ultima } = await supabase
    .from('fotos_producto')
    .select('orden')
    .eq('producto_id', productoId)
    .order('orden', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: fila, error } = await supabase
    .from('fotos_producto')
    .insert({ producto_id: productoId, orden: (ultima?.orden ?? -1) + 1 })
    .select('id')
    .single();
  if (error) return error.message.includes('hasta 5 fotos') ? `Un producto puede tener hasta ${MAX_FOTOS} fotos.` : error.message;

  const ruta = `${productoId}/${fila.id}`;
  const subir = (f: File, tamano: 'grande' | 'mini') =>
    supabase.storage.from(BUCKET).upload(archivo(ruta, tamano), f, { contentType: f.type, cacheControl: '31536000', upsert: false });
  const resultados = await Promise.all([subir(grande, 'grande'), subir(mini, 'mini')]);
  const fallo = resultados.find((r) => r.error)?.error;
  if (fallo) {
    await supabase.storage.from(BUCKET).remove([archivo(ruta, 'grande'), archivo(ruta, 'mini')]);
    await supabase.from('fotos_producto').delete().eq('id', fila.id);
    return `No se pudo subir la foto: ${fallo.message}`;
  }
  return null;
}

export async function borrarFoto(supabase: Supabase, productoId: string, fotoId: string): Promise<string | null> {
  const ruta = `${productoId}/${fotoId}`;
  const { error } = await supabase.from('fotos_producto').delete().eq('id', fotoId).eq('producto_id', productoId);
  if (error) return error.message;
  // Si quedara un archivo suelto no se ve en ninguna parte: no hay fila que lo enlace.
  await supabase.storage.from(BUCKET).remove([archivo(ruta, 'grande'), archivo(ruta, 'mini')]);
  return null;
}

/** Cambia una foto de lugar (una posición antes o después) y deja el orden 0, 1, 2…. */
export async function moverFoto(supabase: Supabase, productoId: string, fotoId: string, paso: -1 | 1): Promise<string | null> {
  const { data, error } = await supabase.from('fotos_producto').select('id').eq('producto_id', productoId).order('orden').order('created_at');
  if (error) return error.message;
  const ids = (data ?? []).map((f) => f.id as string);
  const i = ids.indexOf(fotoId);
  const j = i + paso;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  const cambios = await Promise.all(ids.map((id, orden) => supabase.from('fotos_producto').update({ orden }).eq('id', id)));
  return cambios.find((c) => c.error)?.error?.message ?? null;
}

// ---------------------------------------------------------------------------
// Catálogo público (/catalogo): lo que devuelve public.catalogo_publico()
// ---------------------------------------------------------------------------

/** Un peso disponible de un producto con su precio. Nunca dice cuántas piezas hay de ese peso. */
export interface OpcionPublica {
  peso_gramos: number;
  precio_cop: number;
}

export interface ProductoPublico {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  categoria: string;
  fotos: { grande: string; mini: string }[];
  opciones: OpcionPublica[];
}

/** Productos publicados, con foto y con piezas disponibles, ya con las direcciones de sus fotos. */
export async function obtenerCatalogo(): Promise<ProductoPublico[]> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc('catalogo_publico');
  if (error) throw new Error(error.message);
  return ((data ?? []) as (Omit<ProductoPublico, 'fotos'> & { fotos: string[] })[]).map((p) => ({
    ...p,
    fotos: p.fotos.map((ruta) => ({ grande: urlFoto(ruta), mini: urlFoto(ruta, 'mini') })),
    opciones: p.opciones.map((o) => ({ peso_gramos: Number(o.peso_gramos), precio_cop: Number(o.precio_cop) })),
  }));
}

/** Ancla de una categoría en la página del catálogo ("Anillos de compromiso" → "anillos-de-compromiso"). */
export function anclaCategoria(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
