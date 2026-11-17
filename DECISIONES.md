# Decisiones sobre la especificación (v1)

Complementa `Especificación landing NFC – SS Joyería.md`. Acordadas el 25 de octubre de 2026.

## Stack

- Hosting y funciones: Cloudflare Pages + Workers (plan gratis, permite uso comercial).
- Base de datos y login del admin: Supabase (Postgres + Auth). Tarea programada para evitar la pausa por inactividad y respaldo automático semanal.
- Framework: Astro con render en servidor.
- Dominio: Cloudflare Registrar.
- El visitante anónimo no consulta la base directamente: la página del chip se arma en el servidor.

## Reglas del Círculo SS

- **Desde el 17 nov 2026 el Círculo se mide en gramos** (antes: interacciones de compras desde 600.000 COP, premios a las 3, 5 y 10, tope 10).
- Cada compra de un cliente suma todos los gramos de sus piezas, sin monto mínimo. Las ventas anuladas y las ventas a aliados no suman.
- Referido = cliente nuevo: `referido_por` solo se puede asignar cuando el cliente se crea en esa misma venta.
- Del referido, quien lo refirió suma el 10% de los gramos de su **primera** compra (la más antigua no anulada), redondeado a centésimas; las siguientes no suman. Queda como configuración.
- Premios: 5 g, una manilla con 10 balines; 10 g, 10 balines más; 15 g, 10 balines más. El contador se detiene en 15 g.
- `referido_por` se guarda también en `clientes` y no se puede cambiar después.

## Datos

- Piezas en tabla aparte (una caja puede tener varias): descripción, peso en gramos, ley.
- Cada caja tiene una referencia corta aparte del `codigo_chip`; esa referencia es la que va en el mensaje de garantía.
- Teléfonos en formato internacional (E.164), no solo +57. Por defecto, Colombia.
- La autorización de datos se pide por la línea de WhatsApp de atención; el socio la marca en el admin con su fecha.
- El admin permite editar o anular ventas y regenerar el código de un chip que falló.
- Se registra cada escaneo de chip (fecha y caja), para métricas.

## Páginas

- Versión regalo: quien recibe ve las piezas (peso y ley). Sin `nombre_destinatario`, el saludo es solo "Hola".

## Configuración

- Plantillas de WhatsApp y regla de referidos en un archivo de configuración del código (no editables desde el admin en la v1).
