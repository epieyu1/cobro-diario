# Runbook de Despliegue y Operación

Este documento no reemplaza `docs/implementation-plan.md`.

- Fuente de verdad de avance: `docs/implementation-plan.md`
- Fuente de verdad de arquitectura: `docs/architecture.md`
- Fuente de verdad del cierre de Fase 4: `docs/phase4-manual-validation.md`
- Evidencia de continuidad: `docs/session-handoff.md`

## Objetivo

Dejar una guía operativa mínima para Fase 5 sin fingir que la fase ya quedó habilitada.

Este runbook sirve para:

- auditar variables de entorno públicas,
- fijar el alta operativa de administradores y cobradores,
- preparar despliegue preview repetible en Vercel,
- ejecutar smoke básico sobre preview,
- definir rollback procedural,
- acotar debugging operativo inicial.

## Restricción de fase

- Fase 4 ya quedó cerrada para el alcance activo con evidencia automatizada reproducible.
- La validación manual en dispositivo real quedó diferida por decisión de producto y no bloquea este runbook.
- Este runbook prepara y gobierna Fase 5, pero no autoriza marcarla como cerrada sin preview validado y smoke suficiente.
- No se debe desplegar a producción por inercia; el flujo por defecto es `preview`.

## Política operativa de altas

La operación vigente del producto queda dividida en dos flujos y no deben mezclarse:

- `admin` (administrador): alta manual en Supabase.
- `collector` (cobrador): alta desde la app web por un administrador autenticado.

Razón:

- la autorización remota real depende del claim `app_metadata.role` del JWT,
- la UI también consume `public.profiles.role`,
- y el bloqueo operativo adicional depende de `public.profiles.active`.

Si solo se crea un usuario en `Authentication > Users` y no se alinea `public.profiles`, la app puede quedar desincronizada frente a RLS. Si solo se cambia `public.profiles.role` y no el JWT, la UI puede verse correcta pero la base seguirá negando permisos.

Referencia:

- `docs/architecture.md`
- `docs/database-control.md`
- `docs/origination-control.md`

## Alta manual de administradores en Supabase

Este es el único caso donde el runbook acepta alta manual directa fuera de la app web.

### Restricciones

- El rol autorizado solo puede ser `admin` o `collector`.
- Para administración manual usar únicamente `admin`.
- No usar `user_metadata` como fuente de autorización.
- Después del cambio, el usuario debe volver a iniciar sesión para refrescar el JWT.

### Procedimiento

1. Crear el usuario en `Supabase Dashboard > Authentication > Users`.
2. Copiar el `UUID` del usuario creado.
3. Ejecutar en `SQL Editor` el helper versionado de alineación:

```sql
select private.align_manual_admin_account(
  'UUID_DEL_USUARIO',
  'Nombre Administrador',
  '3001234567'
);
```

4. Pedir al usuario cerrar sesión y volver a entrar.
5. Verificar que Auth y perfil quedaron alineados:

```sql
select
  id,
  email,
  raw_app_meta_data ->> 'role' as jwt_role
from auth.users
where id = 'UUID_DEL_USUARIO';

select
  id,
  role,
  full_name,
  active
from public.profiles
where id = 'UUID_DEL_USUARIO';
```

### Riesgos

- Si `raw_app_meta_data.role` no queda en `admin`, RLS seguirá tratando al usuario como `collector`.
- Si falta la fila en `public.profiles`, la shell puede no resolver bien el perfil operativo.
- Si `active = false`, el usuario puede autenticarse pero quedará bloqueado en flujos críticos.
- `Add User` por sí solo no crea una cuenta administrativa operativa; la alineación es un paso obligatorio.

## Alta de cobradores desde la app web

El alta normal de cobradores no se hace manualmente en Supabase.

### Flujo autorizado

1. Un administrador inicia sesión en la app web.
2. Desde `Originación` o `Gestión`, crea el cobrador.
3. La app invoca `public.provision_collector_account(...)`.
4. El write path remoto materializa `auth.users`, `auth.identities` y `public.profiles` en una sola operación controlada.

### Razón

- evita reabrir DML directo sobre `public.profiles`,
- evita exponer `service_role`,
- evita reemplazar la sesión activa del administrador,
- y mantiene el contrato de seguridad ya revalidado en `LANDING`.

### Excepción y recuperación

Si alguien crea por error un cobrador manualmente en `Authentication > Users`, no se debe completar el alta inventando un flujo paralelo. La recuperación permitida es reintentar el alta desde la app con el mismo correo, porque el write path actual ya contempla la recuperación de cuentas Auth huérfanas sin `public.profiles`.

## Auditoría de variables de entorno

La app actual es frontend Vite puro. Toda variable `VITE_*` queda expuesta al cliente compilado y debe tratarse como pública.

Variables públicas autorizadas hoy:

| Variable | Obligatoria | Uso | Riesgo |
| --- | --- | --- | --- |
| `VITE_APP_NAME` | No | Etiqueta visible de la app | Bajo; solo branding |
| `VITE_DEFAULT_LOCALE` | No | Locale base del frontend | Bajo; solo UX |
| `VITE_DEFAULT_CURRENCY` | No | Moneda por defecto del frontend | Bajo; solo UX mientras no cambie contrato financiero |
| `VITE_SUPABASE_URL` | Sí | URL pública del proyecto Supabase | Exponer otra URL rompe login, bootstrap y sync |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Sí | Clave publicable del cliente Supabase | Debe ser publishable; nunca `service_role` |

Variables explícitamente prohibidas en cliente:

- `SUPABASE_SERVICE_ROLE`
- passwords de base de datos
- tokens de administración
- cualquier secreto operativo inyectado con prefijo `VITE_`

Riesgo:

- este repo no tiene backend Node propio ni BFF que consuma secretos en runtime; meter secretos aquí solo los filtraría al bundle o al pipeline sin aportar capacidad real.

## Procedimiento de preview en Vercel

### Prerrequisitos

- `npm run check` en verde en la rama a desplegar.
- `npm run test:perf` en verde en la rama a desplegar.
- El preview no debe presentarse como release final mientras Fase 5 siga abierta.
- Variables públicas auditadas contra `.env.example` y `src/lib/env.ts`.
- El candidato debe existir ya en GitHub como rama o commit publicable; no usar un worktree local suelto como fuente de verdad del preview.
- Autorización explícita del usuario antes de tocar Vercel real.

### Flujo

1. Confirmar que el despliegue es `preview`, no producción.
2. Confirmar que el commit o rama candidato ya fue empujado a GitHub y registrar ese SHA como referencia.
3. Confirmar que las variables públicas de Vercel coinciden con:
   - `VITE_APP_NAME`
   - `VITE_DEFAULT_LOCALE`
   - `VITE_DEFAULT_CURRENCY`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
4. Ejecutar el deploy de preview con el flujo del skill `vercel-deploy`.
5. Registrar URL de preview y commit desplegado en `docs/session-handoff.md` si el preview se usará para continuidad.
6. Ejecutar smoke de preview antes de compartirlo como candidato.

## Smoke mínimo sobre preview

La validación de preview debe confirmar:

- carga inicial sin pantalla en blanco,
- login funcional,
- lectura de cartera,
- apertura de detalle,
- apertura de `Operacion`,
- registro de un cobro controlado solo si el entorno y el dataset lo permiten sin contaminar evidencia operativa,
- generación inmediata del recibo confirmado y acción mobile-first `Compartir PDF` o `Guardar PDF`,
- visibilidad de estados de sync.

Si el preview está detrás de `Deployment Protection` o `Vercel Authentication`:

- no relajar la barrera perimetral por conveniencia,
- usar `scripts/phase4-mobile-smoke.mjs` con `PHASE4_SMOKE_VERCEL_BYPASS_SECRET=<secret>` y, por defecto, `PHASE4_SMOKE_VERCEL_SET_BYPASS_COOKIE=true`,
- o usar una shareable preview link autorizada para la sesión de smoke.

Restricción:

- el secreto de bypass de automatización no debe escribirse en el repo, ni en `.env.example`, ni en documentación versionada;
- solo debe viajar como variable de entorno de la corrida operativa autorizada.

La validación manual en dispositivo real sigue diferida:

- el smoke de preview no la reemplaza,
- el preview sirve como evidencia operativa y verificación de pipeline,
- pero no convierte por sí solo el preview en release final.

## Rollback procedural

Este repo todavía no tiene un release productivo habilitado en este flujo, así que el rollback mínimo seguro es procedural:

1. No promover a producción un preview con smoke incompleto o con Fase 5 todavía abierta.
2. Si un preview falla, marcarlo como no apto y conservar como referencia el último commit conocido en verde.
3. Re-desplegar como preview el último commit conocido en verde.
4. Repetir smoke de preview antes de volver a circular la URL.
5. Registrar en `docs/session-handoff.md`:
   - commit fallido,
   - commit recuperado,
   - motivo del rollback,
   - evidencia básica del nuevo preview.

Riesgo:

- sin un flujo de promoción productiva ya ejercitado, el rollback real no debe improvisarse sobre tráfico real. Primero se asegura preview repetible; después se define promoción controlada.

## Debugging operativo básico

### 1. Login falla de inmediato

Revisar:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- shape del usuario semilla en `auth.users` si aparece `Database error querying schema`

Referencia:

- `docs/session-handoff.md`
- `scripts/phase4-auth-user.mjs`

### 2. La app carga pero no hay cartera

Revisar:

- sesión autenticada real,
- perfil existente en `public.profiles`,
- alcance RLS del cobrador,
- `profiles.active`

Riesgo:

- si el perfil no existe o quedó inactivo, la UI debe bloquear operación; no es válido abrir permisos por conveniencia.

### 3. El cobro no sincroniza

Revisar:

- estado de red,
- cola local `pending` / `failed`,
- reintentos desde la UI,
- consistencia entre `deviceLocalId` y payload persistido

Referencia:

- `docs/offline-sync.md`
- `src/lib/sync/payment-sync.ts`

### 4. El preview abre con runtime incorrecto

Revisar:

- variables de entorno del proyecto Vercel,
- commit realmente desplegado,
- si se está usando la URL de preview correcta y no otra antigua

### 4.1. El smoke del preview cae en `403 challenge`

Revisar:

- si la URL responde con `x-vercel-mitigated: challenge`,
- si el smoke se está ejecutando con `PHASE4_SMOKE_VERCEL_BYPASS_SECRET`,
- si la sesión usa una shareable preview link cuando no se permite el bypass automatizado.

Señal operativa ya observada en este proyecto:

- si `vercel project protection --format json` devuelve `ssoProtection.deploymentType = "all_except_custom_domains"`, todo `*.vercel.app` del proyecto seguirá detrás de `Vercel Security Checkpoint`,
- en ese estado el smoke UI del preview no puede cerrarse solo con la URL de preview; hace falta un `custom domain` conectado al proyecto o una vía autorizada de bypass/shareable preview link para la sesión de smoke.

Referencia:

- `scripts/phase4-mobile-smoke.mjs`

### 5. `manifest.webmanifest` devuelve `403` en preview protegido

Revisar:

- si el proyecto tiene `Deployment Protection` o `Vercel Authentication` activa,
- si el manifiesto se enlaza con `crossorigin="use-credentials"` en `index.html`,
- si el error ocurre en preview protegido y no en el dominio de producción.

Restricción:

- no relajar la protección del deployment como salida por defecto; la barrera perimetral sigue siendo compatible con la seguridad de la app,
- el fix de frontend autorizado para PWA bajo protección es enviar credenciales en el `link rel="manifest"`.

## Criterio de uso

Este runbook queda listo como preparación de Fase 5 cuando:

- la auditoría de variables queda documentada,
- el flujo de preview queda definido,
- el rollback procedural queda escrito,
- el debugging básico queda acotado.

Fase 5 solo podrá cerrarse después de:

- preview real validado,
- smoke de preview aprobado,
- criterio operativo y accesos ya documentados,
- y checklist de release completo.
