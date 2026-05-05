# AGENTS.md

Este archivo es obligatorio para cualquier asistente que intervenga el repositorio.

## Lectura obligatoria antes de editar

1. Leer este archivo completo.
2. Leer [docs/engineering-standards.md](./docs/engineering-standards.md).
3. Leer [docs/commenting-standard.md](./docs/commenting-standard.md).
4. Leer la documentación inline y los comentarios del archivo que se va a modificar.
5. Si la tarea toca una tecnología con skill disponible, respetar ese skill antes de proponer o aplicar cambios.

## Reglas no negociables

- No tocar credenciales, despliegues ni conexiones externas sin autorización explícita del usuario.
- No borrar ni reescribir comentarios de documentación sin reemplazarlos por una versión actualizada.
- No cambiar una lógica financiera, de sincronización, seguridad o integración externa sin documentar el motivo en el código afectado.
- No introducir accesos inseguros a Supabase: nunca exponer `service_role`, nunca debilitar RLS por conveniencia.
- No asumir que la base local es la fuente de verdad. IndexedDB es caché operativa; PostgreSQL es la fuente de verdad.
- No revertir cambios ajenos ni simplificar flujos críticos sin revisar la documentación existente.

## Skills y herramientas a respetar

- `supabase`: obligatorio cuando se toque Auth, RLS, SQL, funciones RPC, Storage, Realtime o despliegue relacionado.
- `vercel-deploy`: usarlo cuando el trabajo trate de despliegues o configuración operativa en Vercel.
- `gh-fix-ci` y `gh-address-comments`: usarlos en flujos de GitHub/CI/PR cuando aplique.
- `find-skills`: usarlo si falta una capacidad especializada y hay que verificar si existe un skill adecuado.

## Regla de documentación

Toda pieza nueva de lógica o integración debe dejar:

- comentario de intención,
- comentario de riesgo o restricción cuando exista,
- referencia a la fuente de verdad si el flujo no debe romperse,
- actualización de documentación en `docs/` si el cambio modifica arquitectura, flujo, seguridad o proceso.

## Validación mínima antes de cerrar trabajo

- Ejecutar validación local razonable para el cambio.
- Si no se puede validar, dejar el bloqueo explícito.
- Confirmar que los comentarios siguen describiendo el comportamiento real.
