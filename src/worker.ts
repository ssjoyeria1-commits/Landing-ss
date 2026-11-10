// Entrada del Worker (wrangler.jsonc → main): la de Astro más el contador de intentos, que como
// Durable Object tiene que exportarse desde aquí.
import { handle } from '@astrojs/cloudflare/handler';

export { ContadorIntentos } from './lib/contador';

export default {
  fetch(request: Request, env: unknown, ctx: unknown) {
    // www.ssjoyeria.com → ssjoyeria.com (misma ruta y consulta), para que haya una sola dirección.
    const url = new URL(request.url);
    if (url.hostname === 'www.ssjoyeria.com') {
      url.hostname = 'ssjoyeria.com';
      return Response.redirect(url.toString(), 301);
    }
    return (handle as (r: Request, e: unknown, c: unknown) => Promise<Response>)(request, env, ctx);
  },
};
