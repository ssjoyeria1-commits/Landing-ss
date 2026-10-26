import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { AstroCookies } from 'astro';
import { env } from 'cloudflare:workers';

/** Cliente de Supabase por petición, con la sesión del panel guardada en cookies httpOnly. */
export function crearSupabase(request: Request, cookies: AstroCookies) {
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '').map(({ name, value }) => ({
          name,
          value: value ?? '',
        }));
      },
      setAll(lista) {
        for (const { name, value, options } of lista) cookies.set(name, value, options);
      },
    },
  });
}

export type Supabase = ReturnType<typeof crearSupabase>;
