// Las variables vienen de wrangler.jsonc (tipos en worker-configuration.d.ts, `npm run types`).
// No se usan los tipos completos del runtime de Workers porque chocan con los del navegador.
/** Contador de intentos de Cloudflare (binding `ratelimits` de wrangler.jsonc). */
interface RateLimit {
  limit(opciones: { key: string }): Promise<{ success: boolean }>;
}

declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env;
}

declare namespace App {
  interface Locals {
    supabase: import('./lib/supabase').Supabase;
    /** Presente solo si la sesión es de un admin. */
    usuario?: { id: string; email: string };
  }
}
