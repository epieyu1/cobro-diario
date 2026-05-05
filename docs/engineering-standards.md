# Engineering Standards

## Objetivo

Estos estándares existen para que múltiples asistentes puedan intervenir el código sin romper flujos críticos ni perder contexto.

## Fuente de verdad por capa

- PostgreSQL/Supabase: fuente de verdad de negocio y consistencia transaccional.
- IndexedDB/Dexie: caché operativa offline y cola local de trabajo.
- Documentación inline: contrato técnico inmediato del archivo.
- Documentación en `docs/`: contrato de arquitectura, procesos y restricciones transversales.

## Flujo obligatorio de trabajo para asistentes

1. Leer `AGENTS.md`.
2. Leer los documentos de `docs/` relacionados.
3. Leer comentarios del archivo objetivo.
4. Identificar qué skill aplica.
5. Cambiar el código.
6. Actualizar comentarios y documentación del flujo si el comportamiento cambió.
7. Validar.

## Estándares de cambio

### 1. Cambios de lógica

Si cambias lógica:

- explica la intención en el código,
- documenta entradas y salidas relevantes,
- aclara supuestos de negocio,
- deja visibles riesgos de romper compatibilidad.

### 2. Cambios en integraciones externas

Si cambias GitHub, Vercel, Supabase o cualquier comunicación externa:

- documenta la dependencia externa,
- documenta credenciales esperadas sin escribir secretos,
- documenta restricciones de seguridad,
- documenta qué rompe el flujo si se altera incorrectamente.

### 3. Cambios financieros

Si cambias cálculo monetario o aplicación de pagos:

- documenta redondeo,
- documenta orden de aplicación,
- documenta idempotencia y duplicados,
- documenta qué tabla o RPC es la fuente final.

### 4. Cambios de sincronización offline

Si cambias sync:

- documenta origen del evento,
- documenta quién genera el identificador idempotente,
- documenta cuándo un dato sigue local y cuándo ya es persistido en servidor,
- documenta la estrategia frente a conflicto o reintento.

## Comentarios: política del repositorio

- Los comentarios no son decorativos; son contrato operativo.
- Si un comentario ya no describe el comportamiento real, debe actualizarse en el mismo cambio.
- No se aceptan cambios que agreguen complejidad nueva sin documentación inline mínima.

## Skills esperados por tecnología

- Supabase: `supabase`
- GitHub/CI: `gh-fix-ci`, `gh-address-comments`
- Vercel/deploy: `vercel-deploy`
- Búsqueda de capacidades nuevas: `find-skills`

## Cierre de tarea

Antes de cerrar una tarea, cada asistente debe dejar claro:

- qué cambió,
- qué validó,
- qué no pudo validar,
- qué parte del flujo queda sensible o pendiente.
