# Especificación: landing NFC de SS Joyería

Documento para construir con Claude Code. Versión 1 (lanzamiento previsto: mediados de noviembre / inicios de diciembre de 2026).

## 1. Objetivo

La landing es la página que se abre cuando el cliente (o quien recibe el regalo) acerca el celular al sticker NFC de la caja. Debe cumplir cuatro funciones:

1. Confirmar la garantía y generar confianza.
2. Activar el Círculo SS: mostrar el contador de interacciones y el código de referido.
3. Ofrecer un canal directo a WhatsApp.
4. Convertir a quien recibe un regalo en un posible cliente.

## 2. Alcance

**Dentro de la v1:** página por código de chip (dos versiones: compra propia y regalo), panel de administración, contador del Círculo, botones de WhatsApp con mensaje prellenado, página de términos de garantía y política de datos.

**Fuera de la v1:** enlace personal "Mi Círculo" para compradores de regalos, mensajes automáticos con la API de WhatsApp, pasarela de pagos, video de bienvenida, cuentas de usuario para clientes.

## 3. Restricciones y stack

- Presupuesto tecnológico cercano a cero: base de datos y hosting en planes gratuitos que permitan uso comercial (verificar los términos de cada plan). Sugerido: Postgres gestionado (tipo Supabase) y hosting estático/serverless.
- Dominio: ssjoyeria.com (pendiente de comprar y verificar disponibilidad). Todas las URLs de los chips deben usar este dominio para poder cambiar el backend sin reprogramar chips.
- Mobile-first. Debe cargar rápido en 4G, sin videos ni librerías pesadas.
- Idioma: español de Colombia. Marca: logo SS Joyería y color de marca (rojo) según los SVG editables ya definidos.

## 4. Modelo de datos

**clientes**

- id, nombre (primer nombre y apellido opcional), whatsapp (único, formato +57XXXXXXXXXX), codigo\_referido (único), autorizo\_datos (bool) y fecha, created\_at.
- `codigo_referido`: primer nombre en mayúsculas, sin tildes ni espacios, más guion y 4 dígitos aleatorios (ej. `MARIA-4821`). Se genera al registrar al cliente por primera vez y debe validarse como único.

**ventas**

- id, cliente\_id (comprador), fecha, monto\_cop, referido\_por (cliente\_id, nullable), nota.

**cajas** (una por sticker NFC)

- id, venta\_id, codigo\_chip (único), es\_regalo (bool), nombre\_destinatario (nullable), piezas (descripción, peso en gramos, ley), created\_at.
- `codigo_chip`: 8 a 10 caracteres aleatorios, seguros para URL, **no secuenciales**. Es la llave de acceso a la página.

**premios**

- id, cliente\_id, hito (3, 5 o 10), fecha\_entrega. Evita entregar dos veces el mismo premio.

## 5. Reglas del Círculo SS

- Una compra cuenta como interacción desde 600.000 COP.
- Cuentan las compras propias del cliente y las de personas que él refiera. Los referidos deben ser clientes nuevos.
- Hitos: 3, 5 y 10 interacciones. La primera compra del cliente es la interacción 1.
- El contador se calcula por cliente, no por caja: un cliente con varias cajas ve el mismo contador en todas.
- **Regla definida:** del referido solo cuenta su primera compra para quien lo refirió; sus compras posteriores no suman a quien lo refirió. Implementarlo como configuración fácil de cambiar.

## 6. Páginas

### `/c/{codigo_chip}` (versión compra propia)

1. Bienvenida: "Hola, {nombre}", piezas compradas (peso y ley).
2. Tu garantía: resumen corto, enlace a términos completos, botón de WhatsApp (mensaje prellenado con la referencia de la caja).
3. Tu Círculo SS: contador visual con hitos 3/5/10, qué ganas en el siguiente nivel, tu código de referido y botón para compartir por WhatsApp.
4. Cuidado de la pieza (breve).
5. Pie: Instagram, TikTok, invitación a etiquetar la marca, enlace a política de datos.

### `/c/{codigo_chip}` (versión regalo, cuando es\_regalo = true)

1. Bienvenida: "Hola, {nombre\_destinatario}" y "Te lo regala {primer nombre del comprador}".
2. Tu garantía: igual que arriba.
3. Círculo SS: explicación breve del programa (sin mostrar el contador del comprador) y botón de WhatsApp con mensaje prellenado que incluye el código de referido del comprador.
4. Cuidado de la pieza y pie: igual.

### Casos de error

Si el código no existe, mostrar una página neutra con botón a WhatsApp, sin revelar ningún dato. Las páginas de chip llevan `noindex`.

### Privacidad en la página pública

Mostrar solo primer nombre. Nunca mostrar el WhatsApp de nadie. No exponer ids internos.

### `/admin` (login, solo los dos socios)

- **Registrar venta:** buscar o crear cliente por WhatsApp, monto, piezas, referido\_por (por código), por cada caja marcar si es regalo y nombre del destinatario. Al guardar, genera `codigo_chip` y muestra la URL completa para escribir en el sticker.
- **Clientes:** lista con contador, próximo hito, código de referido; búsqueda por nombre, WhatsApp o código.
- **Botón "Avisar por WhatsApp":** abre `wa.me/{numero}?text=...` con un mensaje prellenado con el estado del contador del comprador (útil sobre todo para compradores de regalos). Solo hay que pulsar enviar.
- **Premios:** marcar la entrega de cada hito.
- Exportar a CSV como respaldo.

### Otras páginas

`/garantia` (términos completos) y `/datos` (política de tratamiento de datos). Los textos los entregan los socios.

## 7. Mensajes de WhatsApp (plantillas editables)

- **Compartir (cliente a un amigo):** "Hola, me recomendaron SS Joyería. Mi código de referido: {codigo\_referido}".
- **Destinatario de un regalo:** "Hola, me regalaron una pieza de SS Joyería y quiero conocer el Círculo. Código de referido: {codigo\_referido\_comprador}".
- **Reclamo o consulta de garantía:** incluye la referencia de la caja.
- **Aviso al comprador (desde el admin):** estado del contador y qué falta para el siguiente hito.

## 8. Chips y empaque

- Sticker NFC con URL `https://ssjoyeria.com/c/{codigo_chip}`. Escribir la URL, **bloquear el chip**, escanearlo para confirmar y recién después pegarlo.
- Probar sobre la caja real (acabados metálicos pueden bloquear la lectura; usar stickers anti-metal si hace falta).
- Imprimir en la carta un QR de respaldo con la misma URL.

## 9. Seguridad

- Códigos de chip aleatorios y limitación de intentos de consulta.
- Políticas de acceso en la base de datos: el visitante anónimo solo puede leer lo necesario para su caja.
- Admin con autenticación; ningún secreto en el código del cliente.
- Respaldo periódico de la base de datos.

## 10. Pendientes antes del lanzamiento

- Plazos y respuesta concreta de la garantía (bloqueo previo al lanzamiento).
- Verificación de la ley real del oro en una muestra del primer lote.
- Texto de autorización de datos (habeas data).
- Comprar el dominio y verificar la marca.
- Regla de referidos recurrentes: ya definida (solo cuenta la primera compra del referido); verificar que el panel la aplique.

## 11. Orden de construcción sugerido

1. Base de datos y admin de registro de ventas.
2. Página de compra propia con contador.
3. Variante de regalo.
4. Botones de WhatsApp y mensajes.
5. Pruebas con un sticker real sobre la caja real.
