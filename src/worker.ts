// Entrada del Worker (wrangler.jsonc → main): la de Astro más el contador de intentos, que como
// Durable Object tiene que exportarse desde aquí.
import { handle } from '@astrojs/cloudflare/handler';

export { ContadorIntentos } from './lib/contador';

export default {
  fetch(request: Request, env: unknown, ctx: unknown) {
    // Una sola dirección: www.ssjoyeria.com → ssjoyeria.com y http → https (misma ruta y consulta).
    const url = new URL(request.url);
    const enDominio = url.hostname === 'ssjoyeria.com' || url.hostname === 'www.ssjoyeria.com';
    if (enDominio && (url.hostname !== 'ssjoyeria.com' || url.protocol === 'http:')) {
      url.hostname = 'ssjoyeria.com';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    return (handle as (r: Request, e: unknown, c: unknown) => Promise<Response>)(request, env, ctx);
  },
};
