# Origen de las skills de `.claude/skills`

Copiadas el 26 de octubre de 2026. Para actualizarlas, volver a copiar desde estos repositorios.

| Skills | Repositorio | Versión | Licencia |
|---|---|---|---|
| animate, animate-expo, animation-performance, animation-vocabulary, apple-design, ask-sonner, break-ui, emil-design-eng, find-animation-opportunities, improve-animations, mobile-native, pick-ui-library, prototype, review-animations, write-swift | https://github.com/emilkowalski/skills (carpeta `skills/`) | `2d22863` | MIT (`emilkowalski-skills.txt`) |
| taste-skill (nombre interno: `design-taste-frontend`) | https://github.com/leonxlnx/taste-skill (carpeta `skills/taste-skill`) | `12af471` | MIT (`taste-skill.txt`) |
| impeccable | https://github.com/pbakaus/impeccable (carpeta `.claude/skills/impeccable`) | `414603b` | Apache 2.0 (`impeccable.txt`) |

## Qué ejecutan

- **emilkowalski/skills**: solo instrucciones en texto; no traen scripts.
- **taste-skill**: scripts de Node que abren Chrome o Edge sin ventana (perfil temporal que se borra al terminar)
  para tomar capturas y revisar páginas, y que buscan imágenes de licencia libre en Openverse, Wikimedia,
  museos y la NASA. No usan claves.
- **impeccable**: la primera vez que se usa su script, descarga un ejecutable (`impeccable-windows-x64.exe`)
  desde las versiones publicadas en GitHub del proyecto, lo verifica contra `scripts/engine-checksums.txt`
  y lo guarda en `%USERPROFILE%\.impeccable`. Sus hooks (revisión automática tras cada edición) están
  apagados hasta que se activen con `/impeccable hooks on`.
