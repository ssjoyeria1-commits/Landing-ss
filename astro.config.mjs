// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  // URL definitiva; los chips se graban con este dominio.
  site: 'https://ssjoyeria.com',
  // Casi todo depende de la base de datos; las páginas fijas se marcan con `prerender = true`.
  output: 'server',
  // En Windows el servidor local escucha solo en IPv6 si no se fija la dirección.
  server: { host: '127.0.0.1' },
  adapter: cloudflare({
    // Solo usamos SVG; no hace falta transformar imágenes.
    imageService: 'passthrough',
  }),
});
