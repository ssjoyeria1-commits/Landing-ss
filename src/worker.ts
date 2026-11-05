// Entrada del Worker (wrangler.jsonc → main): la de Astro más el contador de intentos, que como
// Durable Object tiene que exportarse desde aquí.
import { handle } from '@astrojs/cloudflare/handler';

export { ContadorIntentos } from './lib/contador';

export default { fetch: handle };
