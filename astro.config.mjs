// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  // URL definitiva; los chips se graban con este dominio.
  site: 'https://ssjoyeria.com',
  // Casi todo depende de la base de datos; las páginas fijas se marcan con `prerender = true`.
  output: 'server',
  // Las páginas estáticas salen como `garantia.html` (no `garantia/index.html`), así Cloudflare
  // las sirve en /garantia sin redirigir antes a /garantia/.
  build: { format: 'file' },
  // En Windows el servidor local escucha solo en IPv6 si no se fija la dirección.
  server: { host: '127.0.0.1' },
  adapter: cloudflare({
    // Solo usamos SVG; no hace falta transformar imágenes.
    imageService: 'passthrough',
  }),
});
