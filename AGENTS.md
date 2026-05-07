# AGENTS.md

Este archivo es obligatorio para cualquier asistente que intervenga el repositorio.

## Lectura obligatoria antes de editar

1. Leer este archivo completo.
2. Leer [docs/engineering-standards.md](./docs/engineering-standards.md).
3. Leer [docs/commenting-standard.md](./docs/commenting-standard.md).
4. Leer [docs/implementation-plan.md](./docs/implementation-plan.md) si la tarea toca roadmap o cierre de fases.
5. Leer [docs/audit-report.md](./docs/audit-report.md) si la tarea toca UI compartida o diseño. Si hace falta contexto histórico de la estandarización ya cerrada, consultar [docs/archive/standardization-plan.md](./docs/archive/standardization-plan.md).
6. Leer la documentación inline y los comentarios del archivo que se va a modificar.
7. Si la tarea toca una tecnología con skill disponible, respetar ese skill antes de proponer o aplicar cambios.

## Reglas no negociables

- No tocar credenciales, despliegues ni conexiones externas sin autorización explícita del usuario.
- No buscar, leer, inferir ni reutilizar contraseñas, tokens, llaves, `pooler-url`, secretos de Keychain, archivos en `HOME`, caches, configuraciones globales o variables de entorno fuera del archivo, ruta o alcance explícitamente indicado por el usuario.
- Si una operación depende de credenciales fuera del archivo o alcance visible de la tarea, detenerse y pedir autorización específica para esa fuente concreta antes de inspeccionarla.
- No borrar ni reescribir comentarios de documentación sin reemplazarlos por una versión actualizada.
- No cambiar una lógica financiera, de sincronización, seguridad o integración externa sin documentar el motivo en el código afectado.
- No introducir accesos inseguros a Supabase: nunca exponer `service_role`, nunca debilitar RLS por conveniencia.
- No asumir que la base local es la fuente de verdad. IndexedDB es caché operativa; PostgreSQL es la fuente de verdad.
- No revertir cambios ajenos ni simplificar flujos críticos sin revisar la documentación existente.
- No introducir `style={{...}}` para diseño estático en JSX/TSX; las excepciones dinámicas deben justificarse.
- No crear planes paralelos que compitan con `docs/implementation-plan.md`; los subplanes deben referenciarlo.
- No aprobar cambios de UI que releguen móvil a segundo plano; la experiencia primaria del producto es responsive y `mobile-first`.
- No aceptar reportes, auditorías o diagnósticos del usuario como hechos cerrados sin verificarlos contra código, comentarios, documentación y validación razonable.
- Si un reporte toca UI, confirmar además que cumpla los estándares globales del repo y los criterios `mobile-first` antes de darlo por correcto.

## Skills y herramientas a respetar

- `supabase`: obligatorio cuando se toque Auth, RLS, SQL, funciones RPC, Storage, Realtime o despliegue relacionado.
- `vercel-deploy`: usarlo cuando el trabajo trate de despliegues o configuración operativa en Vercel.
- `gh-fix-ci` y `gh-address-comments`: usarlos en flujos de GitHub/CI/PR cuando aplique.
- `find-skills`: usarlo si falta una capacidad especializada y hay que verificar si existe un skill adecuado.

## Regla de contexto autenticado

- Si el repo ya tiene MCP configurado, proyecto enlazado, `.mcp.json`, `.env.local`, `supabase link` o contexto local equivalente, ese contexto debe tratarse como la primera vía autorizada de trabajo.
- No se debe volver a pedir credenciales ni intentar descubrir secretos alternos mientras esa vía local o del repo siga siendo la ruta correcta de operación.
- Solo si esa vía falla y el bloqueo no puede resolverse con el contexto ya presente en el proyecto, se puede pedir autorización específica al usuario para una fuente adicional concreta.

## Regla de login MCP

- Si el usuario ya autorizó un MCP en navegador o indicó que la autenticación ya fue hecha, no se debe disparar un segundo flujo de login u OAuth en la misma sesión por intuición.
- Primero se hace una sola verificación del canal MCP ya autenticado.
- Si esa verificación falla por refresh OAuth, callback inválido o sesión no recargada, el asistente debe detener la cadena de login, documentar el estado y pedir reinicio de sesión o confirmación del usuario antes de relanzar otro login.
- Nunca encadenar `login -> open browser -> segundo login` como táctica de recuperación rápida; eso se considera error de proceso.

## Regla de documentación

Toda pieza nueva de lógica o integración debe dejar:

- comentario de intención,
- comentario de flujo u origen/destino de datos cuando aplique,
- comentario de riesgo o restricción cuando exista,
- referencia a la fuente de verdad si el flujo no debe romperse,
- actualización de documentación en `docs/` si el cambio modifica arquitectura, flujo, seguridad o proceso.

## Validación mínima antes de cerrar trabajo

- Ejecutar validación local razonable para el cambio.
- Si no se puede validar, dejar el bloqueo explícito.
- Confirmar que los comentarios siguen describiendo el comportamiento real.
- Si la tarea tocó UI compartida o diseño, actualizar `docs/audit-report.md` antes de cerrar.
