# Landing NFC · SS Joyería

Página que se abre al acercar el celular al sticker NFC de cada caja de joyería: muestra la garantía, el
contador del Círculo SS (programa de referidos) y botones de WhatsApp. Incluye un panel `/admin` para los
dos socios. Todo en **español de Colombia**, mobile-first, carga rápida en 4G.

- Especificación: `Especificación landing NFC – SS Joyería.md`
- Decisiones tomadas con los socios (prevalecen sobre la especificación): `DECISIONES.md`
- Lanzamiento previsto: mediados de noviembre / inicios de diciembre de 2026.

## Stack y servicios

- **Astro 7** con render en servidor + adaptador `@astrojs/cloudflare` → **Cloudflare Workers** (no Pages).
- **Supabase** (Postgres + Auth), proyecto `dtwlwoyvpcpbaswbkanx`, región São Paulo. Cuenta de Cloudflare
  y de GitHub del negocio: `ssjoyeria1@gmail.com` / `ssjoyeria1-commits`.
- Publicado (temporal): https://ss-joyeria-landing.ss-joyeria-landing.workers.dev
- Repositorio: https://github.com/ssjoyeria1-commits/Landing-ss (rama `main`).
- Dominio definitivo `ssjoyeria.com`: **aún sin comprar**. Las URLs de los chips ya usan ese dominio
  (`src/config/sitio.ts`). **No grabar stickers reales hasta tener el dominio apuntando al Worker.**
- `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` van en `wrangler.jsonc` (`vars`): no son secretos, la
  protección la dan las políticas RLS. Nunca usar ni pedir la clave secreta (`sb_secret_…`).

## Comandos (Windows, PowerShell 5.1)

En cada comando de PowerShell, recargar el PATH primero (Node y Git se instalaron con la sesión abierta):
`$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`

| Tarea | Comando |
|---|---|
| Servidor local | `npm run dev` (o `preview_start` con `astro-dev` de `.claude/launch.json`) → http://127.0.0.1:4321 |
| Revisar tipos | `npx astro check` (debe dar 0 errores) |
| Pruebas de la base de datos | `npm run test:db` (PGlite, sin servidor; 36 pruebas) |
| Publicar | `npm run build` y luego `npx wrangler deploy` |
| Tipos de las variables | `npm run types` (usa `--include-runtime=false`; ver abajo) |
| Aplicar migraciones | `npx supabase db push --linked --dry-run`, luego sin `--dry-run` y con `--yes` |
| Consultar la base real | `npx supabase db query --linked "select ..."` (en una sola línea) |
| Revisión de seguridad | `npx supabase db advisors --linked` |

## Estructura

- `supabase/migrations/` — esquema, RLS y funciones. Las **reglas del Círculo** viven en
  `privado.circulo_reglas()` (monto mínimo 600.000, solo cuenta la primera compra que califique del
  referido, tope 10). Cambiarlas = nueva migración.
- `tests/db.test.mjs` — pruebas de reglas y permisos sobre PGlite con un entorno que imita a Supabase.
  Agregar una prueba por cada regla o permiso nuevo.
- `src/config/` — textos editables: `sitio.ts` (WhatsApp, redes, URL de chips), `circulo.ts` (premios),
  `mensajes.ts` (plantillas de WhatsApp), `textos.ts` (garantía, cuidado).
- `src/lib/` — `supabase.ts` (cliente con sesión en cookies httpOnly), `caja.ts` (página pública),
  `venta.ts` (formulario de venta), `exportar.ts` + `csv.ts` (informes), `whatsapp.ts`, `formato.ts`.
- `src/middleware.ts` — protege `/admin/*`: exige sesión y estar en la tabla `admins`.
- `src/pages/c/[codigo].astro` — página del chip; su cuerpo (propia, regalo o neutra) está en
  `src/components/caja/PaginaCaja.astro`. `/garantia` y `/datos` leen `src/config/legal.ts`.
  `src/pages/admin/` — panel.
- `src/components/Logo.astro` — símbolo de los 7 rombos redibujado en SVG (medidas del logo original).
- `.claude/skills/` — skills de diseño instaladas (origen y qué ejecutan: `.claude/skills-fuentes/FUENTES.md`).
  `impeccable` descarga un ejecutable la primera vez; sus hooks están apagados.

## Seguridad y privacidad (no romper)

- El visitante anónimo solo puede llamar a `public.pagina_caja(codigo)`; no lee ninguna tabla.
  Las funciones internas van en el esquema `privado` (no expuesto por la API).
- La página pública muestra solo el primer nombre; nunca WhatsApp ni ids internos.
- `/c/*` lleva `noindex`, `Cache-Control: private, no-store` y `Referrer-Policy: no-referrer`.
- Al crear funciones nuevas: `revoke execute ... from public, anon` y conceder solo lo necesario.
  Si un valor por defecto de columna llama a una función de `privado`, `authenticated` necesita `execute`.

## Convenciones

- Código, comentarios, nombres y textos en español. Commits en español.
- Marca: rojo `#d0041a` (medido en el logo digital; referencia impresa Pantone 7620 C) y negro `#000`.
  Variables en `src/layouts/Base.astro`. El panel usa la serif del sistema (`--serif`).
- Página pública, dirección "Oscura" (`src/layouts/Publica.astro`): todo negro, texto marfil `#f2ece4`,
  gris `#a39a92`. Una sola fuente web, Cormorant Garamond (`src/assets/fuentes/`, OFL, 37 KB, `swap`),
  para títulos, piezas, contador y código. Primera pantalla: el logo completo a pantalla entera.
  Cada sección es una tarjeta vino oscuro (`--franja`) con tres rombos del imagotipo arriba. Rojo solo
  para el botón principal y los rombos ganados del Círculo. Botones oscuros con filete marfil.
- Datos de prueba de la página del chip sin base de datos: `/pruebas/casos?datos=demo|peor|cero|diez|regalo|regalo-sin-nombre|neutra|temporal`
  (solo en desarrollo; en producción da 404).
- Nombres con mayúscula inicial (`capitalizar()` al guardar y al mostrar).
- CSV "informes" para Excel en español: separador `;` y decimales con coma. Los de "respaldo técnico"
  usan formato estándar con coma.
- Revisar cada cambio visible en el navegador en tamaño de celular (375 px) antes de publicar.

## Trampas conocidas

- **Mensajes de commit**: PowerShell 5.1 rompe comillas dobles en argumentos. Escribir el mensaje en un
  archivo del scratchpad y usar `git commit -F <archivo>`. Terminar con
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npx supabase db query` con SQL de varias líneas falla: pasar el SQL en una sola línea.
- El servidor local se fija a `127.0.0.1` (en Windows escuchaba solo en IPv6). Tarda ~30 s en arrancar.
- `wrangler types` con los tipos completos del runtime choca con los del navegador; por eso
  `--include-runtime=false` y el módulo `cloudflare:workers` se declara en `src/env.d.ts`.
- npm bloquea scripts de instalación: aprobados solo `esbuild` y `workerd` (`allowScripts` en package.json).
- Operaciones interactivas (login de wrangler/supabase, `git push` con credenciales) van en la terminal
  del panel (`run_in_terminal`), no en el shell en segundo plano.
- A veces falla la red (DNS) en un comando: reintentar antes de investigar.

## Datos de prueba en producción

- Venta de prueba de un socio con la caja `pc2pv27v4i` (referencia `SS-4GKKS`), compra propia de
  1.250.000. Cada visita a `/c/pc2pv27v4i` suma un escaneo. Anular o borrar antes del lanzamiento.
- Admins: `simongonzalezyusti@gmail.com` y `segonas66@gmail.com`. No iniciar sesión con sus contraseñas;
  las pruebas con sesión las hacen ellos.

## Estado (26 de octubre de 2026)

- [x] Fase 0 — proyecto base, Cloudflare y GitHub.
- [x] Fase 1 — base de datos, reglas del Círculo, RLS y pruebas.
- [x] Fase 2 — panel: login, registrar venta, clientes, avisar por WhatsApp, premios, anular/regenerar
      chip, exportar (informes para Excel y respaldo técnico).
- [x] Fase 3 — página del chip (compra propia) y página neutra. Identidad de marca aplicada.
- [x] Fase 4 — versión de regalo en `/c/[codigo]` (saludo con el primer nombre del destinatario o solo
      "Hola", "Te lo regala {comprador}", piezas, Círculo sin contador con WhatsApp que lleva el código
      del comprador) y páginas `/garantia` y `/datos` (muestran un aviso con WhatsApp hasta que
      `src/config/legal.ts` tenga los textos).
- [x] **Fases 4A–4E (inventario, antes de la fase 5).** Decisiones de los socios (28 oct 2026):
      inventario por **referencias con cantidad**, pero **cada pieza física tiene su propio peso**
      (se anota al registrar el lote; no hay peso de referencia); todas las piezas son de **18k** (no se
      pregunta la ley); costo por pieza = peso × (costo del oro por gramo del **lote** + mano de obra por gramo de
      la **categoría**); precio de venta **por gramo, por categoría**; descuento opcional en la venta;
      un proveedor por ahora (igual se registra).
  - [x] 4A — catálogo: categorías (mano de obra y precio por gramo) y productos/referencias (código,
        nombre, categoría, stock mínimo), páginas del panel. Aplicada y publicada.
  - [x] 4B — lotes y existencias: proveedores, lotes con costo del oro por gramo, y cada pieza física
        (tabla `unidades`) con su referencia y su peso; la mano de obra se copia a la pieza al entrar.
        Vistas `unidades_detalle`, `existencias`, `lotes_resumen`; `registrar_lote(p)` atómica.
        Carga rápida pegando "código peso" desde Excel. Aplicada y publicada.
  - [x] 4C — precio por pieza en la venta (migración `20261028140000_venta_por_pieza.sql` aplicada
        y publicada; también acepta piezas "fuera del inventario" con precio escrito a mano): se elige la pieza física del inventario (trae su peso),
        la marca `vendida` (las vendidas no se borran ni cambian), guarda precio y costo del momento; el monto total = suma − descuento (lo usa el Círculo); la venta descuenta inventario y
        la anulación lo devuelve. Precios y costos nunca llegan a `pagina_caja`.
  - [x] 4D — informes cruzados (`/admin/informes`, vista `piezas_vendidas` con el descuento repartido
        por pieza): ventas y margen por mes, categoría y producto, inventario valorizado, productos sin
        ventas y piezas con más de 90 días; CSV para Excel de ventas por pieza e inventario disponible.
        Aplicada y publicada.
  - [x] 4E — conteo físico por producto y peso (`/admin/inventario/productos/[id]/conteo`, función
        `registrar_conteo`: las faltantes se dan de baja), bajas y reintegros sueltos con motivo
        (`ajustar_inventario`), tablas `conteos` y `ajustes` de solo lectura para el panel, historial en
        la ficha del producto. Aplicada y publicada. Revisión de seguridad (29 oct): anon solo ejecuta
        `pagina_caja` y no lee tablas; las funciones del panel verifican `es_admin()`.
- [ ] **Fase 5 (siguiente)** — activar en Supabase Auth la protección contra contraseñas filtradas; límite de intentos en `/c/` (regla de Cloudflare), cabeceras de seguridad, respaldo
      automático, tarea que evite la pausa de Supabase por inactividad, QR de respaldo para la carta,
      revisión de rendimiento.
- [ ] Fase 6 — dominio `ssjoyeria.com`, prueba con sticker real sobre la caja real, lanzamiento.

## Pendiente de los socios

- Número de WhatsApp de atención, enlaces de Instagram y TikTok (`src/config/sitio.ts`).
- Premios de los niveles 3, 5 y 10 (`src/config/circulo.ts`).
- Resumen y términos de la garantía; texto de la política de datos (habeas data), en `src/config/legal.ts`.
- Revisar los consejos de cuidado (`src/config/textos.ts`).
- Fuente tipográfica original del logo, si quieren usarla en lugar de la serif del sistema.
