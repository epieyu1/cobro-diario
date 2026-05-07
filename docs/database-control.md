# Control Complementario de Base de Datos, Seguridad y ACID

Este archivo no reemplaza `docs/implementation-plan.md`.

- Fuente de verdad de avance por fase: `docs/implementation-plan.md`
- Fuente de verdad de arquitectura: `docs/architecture.md`
- Fuente de verdad del contrato financiero: `docs/financial-contract-v1.md` y `docs/financial-contract-v2.md`
- Fuente de verdad del RPC transaccional vigente: `supabase/migrations/20260507115523_phase6_financial_v2_record_payment.sql`

## Estado de OR-1 de originacion

Estado validado en `LANDING` al `2026-05-06`:

- existe una implementacion versionada en `supabase/migrations/20260506205243_phase7_origination_rpc_and_rls.sql`,
- existe el ajuste remoto `supabase/migrations/20260506212001_phase7_optimize_origination_rls_initplan.sql`,
- existe la restauracion remota `supabase/migrations/20260507133052_phase7_restore_origination_rls_initplan.sql` para mantener limpio el advisor despues de `BR-6`,
- existe el saneamiento remoto `phase7_drop_legacy_role_residue` para dejar el modelo de roles reducido de verdad a `admin` y `collector`,
- existe la recompilacion remota `phase7_refresh_origination_rpc_role_cutover` para volver a publicar `public.originate_loan()` contra el helper vigente,
- el write path propuesto es `public.originate_loan(uuid, jsonb, jsonb, jsonb)`,
- y su compuerta dedicada ya vive en `supabase/tests/phase7_origination_security_gate.sql`.

Alcance de esa implementacion local:

- mantiene `customers`, `loans` e `installments` cerrados a `INSERT` directo salvo contexto efimero del RPC,
- agrega trazabilidad `created_by`, `originated_at`, `payment_frequency` e `interest_mode` a `public.loans`,
- deja `public.app_role` materializado solo con `admin` y `collector`, sin helper privado ni valores enum heredados fuera del contrato final,
- y limita la originacion V1 a `admin` activo sobre un `collector` activo.

Salvedad:

- OR-1 ya quedó revalidado en remoto con:
  - `supabase db push --linked`,
  - `supabase db lint --linked --level warning`,
  - `supabase db advisors --linked`,
  - `supabase db query --linked --file supabase/tests/phase7_origination_security_gate.sql`.
- La revalidacion posterior al saneamiento de roles tambien ya quedó cerrada con:
  - `list_migrations` mostrando `phase7_drop_legacy_role_residue` y `phase7_refresh_origination_rpc_role_cutover`,
  - `execute_sql` confirmando que `public.app_role` solo contiene `admin` y `collector`,
  - `execute_sql` confirmando que ya no existe ningun helper `private.is_admin_or_%`,
  - `node scripts/phase4-auth-user.mjs smoke fase7.admin@cobrodiario.dev 123456`,
  - `node scripts/phase4-auth-user.mjs smoke fase4.collector@cobrodiario.dev 123456`.
- El unico `WARN` remanente de advisor sigue siendo `auth_leaked_password_protection`; originacion no deja `WARN` o `ERROR` nuevos en el dominio operativo despues de restaurar el patron `initplan`.

## Estado del alta segura de cobradores

Estado validado en `LANDING` al `2026-05-06`:

- existe una implementacion versionada en `supabase/migrations/20260507002021_phase7_collector_account_provisioning_rpc.sql`,
- existe el ajuste remoto `supabase/migrations/20260507003901_phase7_recover_orphan_collector_accounts.sql`,
- el write path propuesto es `public.provision_collector_account(text, text, text, text)`,
- la logica privilegiada vive en `private.provision_collector_account(...)` con `SECURITY DEFINER`,
- y la compuerta dedicada ya vive en `supabase/tests/phase7_collector_provisioning_gate.sql`.

Alcance de esa implementacion:

- elimina el alta antigua basada en `auth.signUp()` desde el browser y el `upsert` directo a `public.profiles`,
- mantiene cerrado `public.profiles` a DML directo para `authenticated`,
- provisiona `auth.users`, `auth.identities` y `public.profiles` dentro de PostgreSQL,
- evita abrir un segundo cliente GoTrue en el mismo contexto del navegador,
- y recupera cuentas Auth huerfanas sin `public.profiles` para que vuelvan a aparecer en la lista de cobradores activos.

Salvedad:

- la version remota ya quedó alineada con `list_migrations` y la compuerta remota pasó por MCP con `ROLLBACK`,
- los advisors posteriores no dejaron `WARN` o `ERROR` nuevos del dominio operativo por este cambio,
- este RPC debe revalidarse cada vez que cambie el shape requerido por GoTrue para usuarios creados por SQL, porque el login depende de que tokens y strings criticos no queden en `NULL`.

## Estado del alta manual de administradores

Estado validado en `LANDING` al `2026-05-07`:

- existe una implementacion versionada en `supabase/migrations/20260507214642_phase7_manual_admin_profile_alignment.sql`,
- el helper propuesto es `private.align_manual_admin_account(uuid, text, text)`,
- y la compuerta dedicada ya vive en `supabase/tests/phase7_admin_manual_profile_gate.sql`.

Alcance de esa implementacion:

- mantiene el principio de `least privilege`: `private.current_app_role()` sigue degradando cualquier claim inesperado a `collector`,
- evita triggers sobre `auth.users` para no convertir una alta incompleta en una promoción automática a `admin`,
- alinea `auth.users.raw_app_meta_data.role = 'admin'`, `auth.users.raw_user_meta_data.full_name` y `public.profiles` en un único write path explícito,
- y reactiva perfiles `admin` previamente degradados o inactivos sin abrir DML directo del cliente sobre `public.profiles`.

Salvedad:

- `Authentication > Users > Add User` sigue siendo insuficiente por sí solo; el helper es el paso obligatorio para que la cuenta quede operativa como administrador,
- la compuerta remota ya probó que `authenticated` no puede ejecutar el helper,
- la compuerta remota también ya probó alta válida desde Auth huérfano, rechazo por nombre faltante y upgrade seguro desde perfil `collector`,
- y los advisors posteriores no dejaron `WARN` o `ERROR` nuevos del dominio operativo; solo persiste `auth_leaked_password_protection` como aviso externo al repo.

## Estado de OR-2 de originacion

Estado validado en `LANDING` al `2026-05-06`:

- existe una implementacion versionada en `supabase/migrations/20260506212651_phase7_origination_schedule_v1.sql`,
- existen los ajustes remotos `supabase/migrations/20260506213204_phase7_clean_origination_schedule_lint.sql` y `supabase/migrations/20260506213302_phase7_fix_schedule_out_variable_shadow.sql`,
- `private.next_origination_due_date(...)` fija el desplazamiento canonico por frecuencia,
- `private.build_origination_schedule(...)` fija el reparto financiero y los estados iniciales,
- y `public.originate_loan(...)` ya rechaza previews que no coincidan con ese cronograma generado en PostgreSQL.

Alcance de esa implementacion local:

- mantiene el cronograma como regla de backend y no como convencion opcional del frontend,
- obliga `first_due_date >= disbursement_date`,
- distribuye el interes simple materializado con residuo en la ultima cuota,
- y deja `fee_amount = 0`, `outstanding_amount = scheduled_amount` y `status = pending` en cada cuota nueva.

Salvedad:

- OR-2 ya quedó revalidado en remoto con:
  - `npm run test:phase7`,
  - `list_migrations`,
  - `execute_sql` por MCP sobre `supabase/tests/phase7_origination_security_gate.sql`,
  - `execute_sql` por MCP sobre `supabase/tests/phase7_origination_schedule_gate.sql`,
  - `get_advisors(security)`,
  - `get_advisors(performance)`.
- Los lints actuales no muestran `WARN` o `ERROR` nuevos del dominio operativo de originacion; persisten solo el `WARN` heredado de Auth por `Leaked Password Protection`, el `INFO` de la tabla demo cuarentenada y `INFO` de indices aun sin uso.

## Estado de OR-5 de originacion

Estado validado en `LANDING` al `2026-05-06`:

- existe la compuerta remota `supabase/tests/phase7_origination_roles_gate.sql`,
- `private.current_app_role()` ya degrada cualquier claim inesperado a `collector`,
- `public.originate_loan()` ya quedó probado contra `admin` activo permitido, `collector` denegado, `admin` inactivo denegado y `collector` destino inactivo denegado,
- y el smoke remoto final ya sigue pasando con `scripts/phase7-origination-smoke.mjs`.

Alcance de esa validacion:

- congela el contrato final de roles de originacion en `admin` y `collector`,
- demuestra que `profiles.role` no reabre privilegios si el JWT llega con un claim inesperado,
- y deja reproducible el cierre remoto del write path sin depender de inspeccion manual del proyecto.

Salvedad:

- OR-5 debe revalidarse si cambian `private.current_app_role()`, `private.is_admin()`, `private.can_originate_for_collector(uuid)` o el contrato de `public.originate_loan(...)`.
- El smoke de Auth/RLS por rol ahora puede fijar el rol esperado desde `scripts/phase4-auth-user.mjs smoke <email> <password> [expected-role]`.

## Objetivo

Dejar visible, de forma operativa:

- qué controles reales ya existen hoy en la base remota,
- qué parte de ACID ya está materializada en `LANDING`,
- qué riesgos fueron cerrados en la sesión actual,
- y qué brechas siguen abiertas antes de operación/release.

## Alcance de esta revisión

Fecha de revisión: `2026-05-06`

Esta revisión contrastó:

- migraciones SQL versionadas en `supabase/migrations/`,
- compuertas SQL `supabase/tests/phase1_security_gate.sql` y `supabase/tests/phase2_record_payment_gate.sql`,
- capas cliente que dependen de RLS y del RPC (`collector-workspace.ts` y `payment-sync.ts`),
- validaciones locales `npm run test:phase2`, `npm run test:phase3`, `npm run test:phase4`, `npm run check`,
- y validación remota real sobre `LANDING`.

Validación remota ejecutada en `LANDING`:

- `supabase migration list --linked`
- `supabase db push --linked` para `20260506163855_phase1_security_hardening.sql`
- `supabase db push --linked` para `20260506171708_phase1_fix_record_payment_write_context_order.sql`
- `supabase db query --linked --file supabase/migrations/20260506184500_fix_record_payment_partial_component_reconstruction.sql`
- `supabase db push --linked` para `20260506184500_fix_record_payment_partial_component_reconstruction.sql`
- `supabase db query --linked --file supabase/seeds/phase4_landing_playground.sql`
- `npm run playground -- status fase4.playground@cobrodiario.dev 123456`
- `npm run playground -- pay fase4.playground@cobrodiario.dev 123456 PG-JUL-001 15`
- `npm run playground -- settle fase4.playground@cobrodiario.dev 123456 PG-KAR-001`
- `supabase db advisors --linked`
- `supabase db query --linked --file supabase/tests/phase1_security_gate.sql`
- `supabase db query --linked --file supabase/tests/phase2_record_payment_gate.sql`

Nota operativa:

- al intentar varias conexiones CLI en paralelo apareció `ECIRCUITBREAKER` por demasiados intentos de autenticación temporales contra el pool,
- la evidencia final de esta revisión se tomó de reintentos secuenciales, no de las ejecuciones paralelas fallidas.
- después de aplicar `20260506184500`, `supabase db lint --linked --level warning` volvió a mostrar inestabilidad del canal `cli_login_postgres`; las compuertas SQL y de producto sí revalidaron el comportamiento correcto en remoto.

## Estado real actual de la base

| Capacidad | Evidencia | Estado actual |
| --- | --- | --- |
| Esquema transaccional base | `20260505063813_foundational_schema.sql` | Existe dominio remoto para `profiles`, `devices`, `customers`, `loans`, `installments`, `payments`, `payment_applications`, `payment_events`, `sync_events` |
| Seguridad por esquema privado | helpers `private.*` con `search_path = ''` | Los helpers sensibles siguen fuera de `public` y con `EXECUTE` explícito para `authenticated` |
| Hardening de grants y RLS | `20260506163855_phase1_security_hardening.sql` | Las tablas críticas dejaron de depender de policies `FOR ALL`; el DML directo del cliente quedó acotado al contexto interno de `record_payment` |
| Compatibilidad del RPC bajo RLS endurecido | `20260506171708_phase1_fix_record_payment_write_context_order.sql` | `record_payment()` abre el contexto de escritura antes de los `FOR UPDATE`, evitando regresión por invisibilidad de filas bloqueadas |
| Compatibilidad del RPC con cuotas parciales materializadas | `20260506184500_fix_record_payment_partial_component_reconstruction.sql` | `record_payment()` reconstruye componentes pendientes desde `outstanding_amount` y ya no rechaza cuotas parciales válidas sin histórico completo |
| Playground remoto editable | `supabase/seeds/phase4_landing_playground.sql` + `scripts/phase4-playground.mjs` | `LANDING` ya expone una cartera separada del smoke para consultar, cobrar, liquidar y resetear casos reales de negocio |
| Bloqueo por perfil inactivo | `private.current_profile_is_active()` + `private.can_access_collector(uuid)` | `profiles.active` ya participa en lecturas y RPC críticos |
| Trazabilidad de dispositivo | `record_payment()` | El RPC rechaza `device_id` que no pertenezca al mismo cobrador |
| Idempotencia remota | `payments.device_local_id unique` + `record_payment()` + `20260507160421_phase6_harden_record_payment_idempotency.sql` | Reintentar el mismo cobro devuelve el mismo `payment.id`; reutilizar el identificador con payload mutado o fuera de contexto falla |
| Lectura autoritativa de recibos | `public.get_payment_receipt()` + `supabase/tests/phase5_receipt_gate.sql` + `scripts/phase5-receipt-pdf-smoke.ts` | El comprobante remoto ya puede leerse bajo RLS por `remotePaymentId`, expone `collector.fullName` para el ticket visible, mantiene bloqueo de perfiles inactivos, denegación fuera de alcance, desglose coherente por cuota y smoke real de PDF contra `LANDING` |
| Reporte operativo seguro | `public.get_operational_report()` + `supabase/tests/phase5_roles_gate.sql` + `supabase/tests/phase5_reports_gate.sql` | El agregado operativo ya existe por RPC con `SECURITY INVOKER`, filtros controlados, denegación para `collector` y bloqueo de perfiles inactivos |
| Compuerta negativa de seguridad | `supabase/tests/phase1_security_gate.sql` | Ya prueba denegación por alcance, denegación de DML directo y bloqueo de perfiles inactivos |
| Compuerta transaccional financiera | `supabase/tests/phase2_record_payment_gate.sql` | Sigue probando pago válido, parcial, multi-cuota, rechazo por orden, idempotencia exacta y conflicto por `device_local_id` con payload mutado o fuera de contexto |

## Evaluación ACID actual

| Propiedad | Qué ya cubre hoy | Evidencia | Brecha real |
| --- | --- | --- | --- |
| Atomicidad | `record_payment()` y `reverse_payment()` mutan pagos, cuotas, préstamo y eventos dentro de un solo flujo transaccional | `supabase/tests/phase2_record_payment_gate.sql` + `supabase/tests/phase6_reverse_payment_gate.sql` | No hay brecha activa para los write paths actuales |
| Consistencia | FKs, `check`, unicidad de `device_local_id`, validación `fee -> interest -> principal`, cuota más antigua primero, bloqueo de DML directo fuera del contexto del RPC, comparación exacta del payload idempotente y metadata consistente de reverso | migraciones fundacionales + hardening Fase 1 + migraciones `20260507050206`, `20260507053412` y `20260507160421` + gates remotos Fase 1, 2 y 6 | El patrón actual quedó cerrado; solo debe repetirse cuando entren nuevos RPC de escritura |
| Isolation | `FOR UPDATE` sobre préstamo/cuotas/pago + `ON CONFLICT (device_local_id)` para carreras de reintento + idempotencia estricta por payload + idempotencia por estado en reverso | `record_payment()` + `reverse_payment()` + `scripts/phase6-reversal-concurrency-smoke.mjs` | No hay brecha activa para el contrato base actual |
| Durabilidad | PostgreSQL/Supabase es fuente de verdad y el cliente solo confirma sync cuando hay `paymentId` remoto | arquitectura, sync offline, gates remotos Fase 1 y Fase 2 | No hay brecha activa para pagos V1; la siguiente deuda es operativa/release, no de persistencia base |

## Brechas cerradas en esta sesión

### 1. Least privilege y grants efectivos para el flujo de cobro

Estado:

- cerrado en `LANDING`.

Evidencia:

- `20260506163855_phase1_security_hardening.sql`
- `supabase/tests/phase1_security_gate.sql`

Resultado:

- el cliente autenticado ya no puede replicar por Data API el DML crítico que la arquitectura reservó para `record_payment`.

### 2. Bloqueo real por `profiles.active`

Estado:

- cerrado para lecturas y RPC operativos del flujo de cobro.

Evidencia:

- `private.current_profile_is_active()`
- `private.can_access_collector(uuid)`
- `supabase/tests/phase1_security_gate.sql`

Resultado:

- un collector con `active = false` queda bloqueado incluso si conserva una sesión válida.

### 3. Ownership de `device_id` en `record_payment`

Estado:

- cerrado para pagos V1.

Evidencia:

- `20260506163855_phase1_security_hardening.sql`
- `20260506171708_phase1_fix_record_payment_write_context_order.sql`
- `20260506184500_fix_record_payment_partial_component_reconstruction.sql`
- `supabase/tests/phase2_record_payment_gate.sql`

Resultado:

- la trazabilidad del pago ya no acepta un `device_id` ajeno al cobrador del evento.

### 4. Evidencia negativa de RLS y privilegios

Estado:

- cerrado.

Evidencia:

- `supabase/tests/phase1_security_gate.sql`

Resultado:

- la Fase 1 ya no depende solo de evidencia positiva de funcionamiento; ahora también tiene denegación comprobada.

## Estado de brechas y hallazgos

### 1. La fuente de verdad de rol sigue dividida entre JWT y `profiles.role`

Hallazgo:

- las policies autorizan con `auth.jwt() -> app_metadata.role`,
- la UI también lee `profiles.role`,
- y no existe evidencia en el repo de un sincronizador explícito entre ambas fuentes.

Impacto:

- un cambio operativo de rol puede desalinear lo que ve la UI frente a lo que autoriza la base.

Dueña principal:

- operación/admin futura.

### 2. El reverso transaccional ya quedó cerrado en `LANDING`

Estado:

- cerrado para el contrato base de `BR-5`.

Evidencia:

- `20260507050206_phase6_reverse_payment_rpc_and_reversal_tracing.sql`
- `20260507053412_phase6_cover_reversal_fk_index.sql`
- `supabase/tests/phase6_reverse_payment_gate.sql`
- `scripts/phase6-reversal-concurrency-smoke.mjs`

Resultado:

- `public.reverse_payment()` ya existe como write path admin-only,
- restaura saldos desde `payment_applications`,
- marca `payments.status = reversed`,
- deja un único `payment_reversed`,
- y ya pasó un smoke real de dos sesiones concurrentes contra `LANDING`.

### 3. La auditoría remota de gestión de visita ya quedó revalidada en `LANDING`

Hallazgo:

- `phase4_formalize_customer_route_label` y `phase4_collection_actions_remote_sync` ya quedaron aplicadas en `LANDING`,
- `supabase/tests/phase4_routes_gate.sql` y `supabase/tests/phase4_collection_actions_gate.sql` ya pasaron por MCP con `ROLLBACK`,
- y `public.collection_actions` + `public.record_collection_action()` ya tienen evidencia remota real de alcance por collector e idempotencia por `device_local_id`.

Impacto:

- la operación táctica de campo ya no depende de un contrato solo local para gestión de visita,
- y la trazabilidad remota base de `BR-2` queda cerrada en el entorno vinculado.

Dueña principal:

- `BR-2` para el contrato remoto base; `BR-1` sigue dueña de la validación móvil.

### 4. `Leaked Password Protection` sigue deshabilitado en Auth

Hallazgo:

- `supabase db advisors --linked` dejó un único `WARN`: `auth_leaked_password_protection`.

Impacto:

- no bloquea el cierre técnico de Fase 1 del dominio operativo,
- pero sí queda como deuda de seguridad operativa de Auth antes de producción.

Dueña principal:

- operación/Auth.

### 6. Los advisors de performance ya no dejan lints activos del dominio operativo

Hallazgo:

- se aplicó `phase4_cover_fk_indexes_and_demo_rls`,
- `loans.created_by`, `collection_actions.created_by` y `collection_actions.customer_id` ya quedaron cubiertos con índices,
- y la tabla demo heredada quedó con policy explícita de cuarentena para no depender de ausencia de policies.

Impacto:

- el dominio operativo remoto ya no deja hallazgos activos de performance en advisors,
- y el único aviso de seguridad remanente queda fuera del alcance SQL del repo.

Dueña principal:

- cerrada en esta revisión para el dominio operativo.

## Impacto por fase

### Fase 1. Capa de datos remota

Estado real:

- cerrada de nuevo el `2026-05-06`.

Evidencia:

- migraciones remotas alineadas hasta `20260506184500`
- `supabase db advisors --linked` sin hallazgos nuevos del dominio operativo
- `supabase/tests/phase1_security_gate.sql` en verde
- `supabase/tests/phase2_record_payment_gate.sql` en verde
- smoke Auth/RLS, playground remoto editable y smoke móvil de Fase 4 en verde contra `LANDING`

### Fase 2. Contrato financiero y ACID del cobro

Estado real:

- sigue verde para V1 y quedó revalidada contra la base endurecida.

Falta:

- no queda una nueva brecha financiera remota dentro del repo; el pendiente formal del roadmap sigue siendo `BR-1` y el `WARN` externo de Auth.

### Fase 3. Sync offline real

Estado real:

- sin cambio estructural; la cola local sigue apoyándose sobre un RPC remoto ya endurecido y revalidado.

### Fase 4. UI operativa

Estado real:

- sigue abierta, pero ya no por offline/online, cartera simulada grande ni roles/reportes base.
- `BR-4` ya quedó cerrado para su contrato actual: guards visibles por rol en frontend, RPC `public.get_operational_report()` en `LANDING` y compuertas remotas verdes para roles/reportes.

### Fase 5. Despliegue y operación

Falta:

- review de Auth/seguridad operativa,
- preview/release process,
- y cualquier habilitación comercial posterior que quiera exponer `BR-6` en la UI final.

## Validación ejecutada hoy

Local:

- `npm run test:phase2`
- `npm run test:phase3`
- `npm run test:phase4`
- `npm run check`

Remota en `LANDING`:

- `supabase migration list --linked`
- `supabase db push --linked` para `20260506163855_phase1_security_hardening.sql`
- `supabase db push --linked` para `20260506171708_phase1_fix_record_payment_write_context_order.sql`
- `supabase db query --linked --file supabase/migrations/20260506184500_fix_record_payment_partial_component_reconstruction.sql`
- `supabase db push --linked` para `20260506184500_fix_record_payment_partial_component_reconstruction.sql`
- `supabase db advisors --linked`
- `supabase db query --linked --file supabase/tests/phase1_security_gate.sql`
- `supabase db query --linked --file supabase/tests/phase2_record_payment_gate.sql`

Resultado:

- todas las compuertas locales siguieron en verde,
- el hardening remoto quedó aplicado,
- la compuerta Fase 1 detectó una regresión real del orden de `record_payment_write_context`,
- esa regresión quedó corregida con una migración incremental,
- y la revalidación final sobre `LANDING` dejó Fase 1 cerrada otra vez con evidencia remota completa.
