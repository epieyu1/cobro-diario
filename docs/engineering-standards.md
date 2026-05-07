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
5. Verificar cualquier reporte o diagnóstico aportado por el usuario contra código, comentarios, documentación y validación razonable antes de asumirlo como correcto.
6. Cambiar el código.
7. Actualizar comentarios y documentación del flujo si el comportamiento cambió.
8. Validar.

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

### 2.1. Límite sobre credenciales y secretos

- No se permite buscar, leer, inferir ni reutilizar contraseñas, tokens, llaves, URLs con credenciales o secretos fuera del archivo, ruta o alcance explícitamente indicado por el usuario.
- No se debe inspeccionar `HOME`, Keychain, caches, configuraciones globales, archivos temporales, `~/.config`, `~/.supabase`, `Library/Keychains` ni variables de entorno para descubrir credenciales por iniciativa propia.
- Si una tarea externa depende de credenciales fuera del alcance visible del cambio, el asistente debe detenerse y pedir autorización específica para esa fuente antes de inspeccionarla.
- Esta restricción debe tratarse como control de seguridad del repositorio, no como una optimización opcional.

### 2.2. Preferencia por contexto del repo

- Si el proyecto ya expone un contexto autenticado o enlazado dentro del repo, el asistente debe usar primero esa vía.
- Ejemplos válidos: `.mcp.json`, `supabase link`, archivos temporales del proyecto bajo `supabase/.temp/`, variables del proyecto en `.env.local` y cualquier configuración documentada en `docs/`.
- No se debe pedir al usuario la misma credencial repetidamente si el repo ya conserva el contexto operativo suficiente para la tarea.
- Si ese contexto falla, primero se debe diagnosticar el fallo técnico con las rutas ya documentadas del proyecto antes de solicitar una fuente nueva de autenticación.

### 2.3. Regla operativa para OAuth de MCP

- Si el usuario ya completó la autorización OAuth de un MCP, el asistente no debe relanzar otro login en la misma sesión sin una verificación previa.
- La secuencia correcta es:
  1. una sola verificación del MCP ya autenticado,
  2. diagnóstico del error exacto si falla,
  3. detener nuevos intentos si el fallo apunta a refresh/callback/sesión no recargada.
- No se permite abrir una segunda confirmación de login como respuesta automática a un fallo de refresh.
- Si el canal MCP sigue roto después de esa única verificación, debe quedar documentado como bloqueo de sesión y no como ausencia de autenticación del usuario.

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

### 5. Cambios de frontend y diseño compartido

Si cambias UI operativa, diseño compartido o primitives de frontend:

- diseña mobile-first y responsive; el caso principal del producto es pantalla móvil,
- resuelve primero los flujos críticos en viewport pequeño y luego escala a tablet/desktop,
- evita depender de hover, precisión de mouse o anchos amplios como mecanismo principal de uso,
- evita `style={{...}}` para diseño estático,
- centraliza tokens y clases reutilizables en la capa CSS compartida,
- revisa que cualquier reporte de UI también sea correcto en móvil, no solo en desktop,
- documenta excepciones visuales o técnicas si un componente rompe el sistema base,
- actualiza `docs/audit-report.md` como evidencia de cierre cuando el cambio afecte diseño compartido.

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
