# Control Complementario de Fases y Funciones

Este archivo no reemplaza `docs/implementation-plan.md`.

- Fuente de verdad de avance: `docs/implementation-plan.md`
- Fuente de verdad de referentes: `docs/reference-benchmarks.md`
- Fuente de verdad de arquitectura y flujos: `docs/architecture.md`, `docs/offline-sync.md`, `docs/operational-ui.md` y `docs/financial-contract-v1.md`
- Fuente de verdad del estado de seguridad y ACID de la base: `docs/database-control.md`
- Fuente de verdad de terminología visible: `docs/terminology-guide.md`

## Objetivo

Convertir la revision funcional del repositorio en un control complementario que deje visible:

- que funciones ya existen,
- en que capa viven,
- que falta respecto a los referentes de producto,
- que test o gate debe pasar antes de avanzar de fase.

## Referentes revisados

El baseline funcional usado en esta revision sale de `docs/reference-benchmarks.md`.

| Capacidad | CobrApp | PrestaBIT | Baseline para `Cobro Diario` |
| --- | --- | --- | --- |
| Rutas de cobro por zona | Si | Si | Minimo esperado |
| Asignacion de clientes a cobrador | Si | Si | Minimo esperado |
| Alta rapida de clientes y prestamos | Si | Si | Minimo esperado |
| Geolocalizacion de pagos | Si | No documentado como eje principal | Deseable con degradacion segura |
| Interes simple y compuesto | Multiples modos de interes | Interes compuesto y cuotas fijas | V1 cubre simple; compuesto queda pendiente |
| Recibos e impresion Bluetooth | Si | Si | Debe quedar previsto como capacidad real |
| Operacion offline con sincronización | No destacado en la ficha resumida | Si | Requerimiento obligatorio |
| Roles operativos diferenciados | No detallado en el benchmark | Si | Requerimiento obligatorio |
| Reportes en tiempo real | Si | No destacado en la ficha resumida | Capacidad pendiente |
| UX rapida con cartera grande | Riesgo a superar | Riesgo a superar | Gate obligatorio antes de cerrar Fase 4 |

## Inventario actual por capa

### Frontend y shell operativa

| Funcion | Donde vive | Como funciona hoy |
| --- | --- | --- |
| Login con email y password | `src/App.tsx`, `src/lib/supabase/auth-session.ts` | Usa `signInWithPassword()`, restaura sesion con `getSession()` y escucha cambios con `onAuthStateChange()` |
| Bootstrap de cartera | `src/lib/collector/collector-workspace.ts` | Lee `profiles`, `customers`, `loans` e `installments` desde Supabase y los hidrata en IndexedDB |
| Originacion de deudor y prestamo | `docs/origination-control.md`, `src/lib/finance/origination-schedule.ts`, `src/lib/origination/origination-validation.ts`, `src/lib/origination/origination-wizard.ts`, `src/lib/origination/origination-wizard-panel.tsx`, `scripts/phase7-origination-smoke.mjs`, `scripts/phase4-auth-user.mjs`, `supabase/tests/phase7_origination_roles_gate.sql`, `supabase/migrations/20260506205243_phase7_origination_rpc_and_rls.sql`, `supabase/migrations/20260506212651_phase7_origination_schedule_v1.sql` | El flujo V1 ya quedó cerrado: RPC transaccional, cronograma versionado, wizard mobile-first, bootstrap local alineado, compuerta remota de roles y smoke real `admin -> collector -> cobro` |
| Cartera por prioridad y ruta operativa | `src/lib/collector/collector-route-board.ts`, `src/App.tsx` | Lee `routeLabel` desde `customers.route_label` bootstrapeado en IndexedDB; si falta, cae a `neighborhood` y luego `address`, y prioriza `sync-failed -> overdue -> due-today -> scheduled -> settled` |
| Busqueda y filtro operativo | `src/App.tsx` | Usa `useDeferredValue()` para no acoplar cada tecla al render completo de cartera |
| Detalle de prestamo y cuotas | `src/App.tsx` | Muestra saldo, estado, zona, contacto y lista de cuotas con estado local |
| Preview de cobro | `src/lib/finance/payment-planning.ts`, `src/App.tsx` | Convierte un monto libre en `applications` oldest-first y `fee -> interest -> principal` |
| Registro de cobro local | `src/lib/sync/payment-sync.ts`, `src/App.tsx` | Encola el pago, aplica efecto optimista en IndexedDB y luego intenta sincronizar |
| Estado visible de sincronización | `src/App.tsx`, `src/lib/sync/payment-sync.ts` | Expone cola con estados pendiente, en envío, con error y sincronizado, y permite reintento |
| Recibo autoritativo | `src/App.tsx`, `src/lib/receipts/`, `scripts/phase5-receipt-pdf-smoke.ts`, `supabase/migrations/20260507034341_phase5_authoritative_payment_receipts.sql`, `supabase/migrations/20260507170311_phase5_enriched_payment_receipt_pdf_contract.sql`, `supabase/tests/phase5_receipt_gate.sql` | Distingue recibo local pendiente vs comprobante confirmado, consulta `public.get_payment_receipt()` por `remotePaymentId`, separa snapshot operativo del crédito y ya exporta PDF real desde el contrato confirmado; Bluetooth sigue documentado como decisión diferida |
| Gestion de visita con cola offline | `src/lib/sync/collection-action-sync.ts`, `src/lib/collector/collector-workspace.ts`, `src/lib/collector/collection-actions.ts`, `src/App.tsx` | Encola `promise_to_pay`, `not_found`, `return_visit` y `visited_no_payment`, conserva efecto local y reintenta contra `record_collection_action()` |

### Backend transaccional y seguridad

| Funcion | Donde vive | Como funciona hoy |
| --- | --- | --- |
| Dominio base | `supabase/migrations/20260505063813_foundational_schema.sql` | Define `profiles`, `devices`, `customers`, `loans`, `installments`, `payments`, `payment_applications`, `payment_events`, `sync_events` |
| Roles y alcance | `private.current_app_role()`, `private.is_admin()`, `private.can_access_collector(uuid)` | Las policies dependen de `app_metadata.role` y del alcance del cobrador |
| RLS de tablas operativas | Migracion fundacional | Todas las tablas expuestas de `public` tienen RLS habilitado |
| RPC transaccional de cobro | `public.record_payment()` en `supabase/migrations/20260505145152_finalize_payment_allocation_v1.sql` | Registra pago atomico, valida alcance, idempotencia, orden de cuotas y orden por componente |
| RPC idempotente de gestión | `public.record_collection_action()` en `supabase/migrations/20260507025036_phase4_collection_actions_remote_sync.sql` | Versiona la auditoría remota de visita con `device_local_id`, alcance por collector y actor autenticado separado |
| Trazabilidad de eventos | `public.payment_events`, `public.sync_events` | Guarda eventos de pago y sincronizacion del lado servidor |
| Dataset remoto de smoke | `supabase/seeds/phase4_landing_smoke.sql` | Siembra y reinicia cobrador, clientes, prestamos y cuotas operativas para validar Fase 4 sin arrastrar cobros previos |

### Control actual de seguridad y ACID

| Control | Estado actual | Evidencia | Brecha real |
| --- | --- | --- | --- |
| Atomicidad de cobro y reverso base | Completo | `record_payment()` + `reverse_payment()` + `supabase/tests/phase2_record_payment_gate.sql` + `supabase/tests/phase6_reverse_payment_gate.sql` | No hay brecha activa para los write paths actuales; repetir el patrón cuando entren nuevas mutaciones críticas |
| Idempotencia remota | Completo para pagos, gestiones y reverso base | `payments.device_local_id unique` + `record_payment()`; `collection_actions.device_local_id unique` + `record_collection_action()`; `reverse_payment()` devuelve el mismo comprobante si el pago ya quedó `reversed` | Mantener el mismo patrón cuando entren otros write paths críticos |
| Aislamiento de cobro | Completo para pagos y reversos | `FOR UPDATE` sobre `loans`, `installments` y `payments` + `scripts/phase6-reversal-concurrency-smoke.mjs` | No hay brecha activa para el contrato base actual |
| Least privilege sobre tablas críticas | Completo para write paths operativos actuales | `20260506163855_phase1_security_hardening.sql` + `20260507050206_phase6_reverse_payment_rpc_and_reversal_tracing.sql` + `supabase/tests/phase1_security_gate.sql` | Repetir el mismo patrón cuando entren nuevas escrituras críticas |
| Bloqueo por perfil inactivo | Completo para lecturas y RPC operativos | `private.current_profile_is_active()` + `private.can_access_collector(uuid)` + `supabase/tests/phase1_security_gate.sql` | Extender el mismo criterio a futuros eventos operativos fuera del flujo de pago |
| Validación de ownership del dispositivo | Completo para `record_payment` V1 | `20260506163855_phase1_security_hardening.sql` + `20260506171708_phase1_fix_record_payment_write_context_order.sql` | Mantener el mismo control cuando aparezcan otros RPC que acepten `device_id` |
| Gate negativo de RLS y grants | Completo | `supabase/tests/phase1_security_gate.sql` | Mantener la compuerta alineada cuando cambien policies o grants |

### Cache local y sincronizacion

| Funcion | Donde vive | Como funciona hoy |
| --- | --- | --- |
| Cache offline | `src/lib/db/local-db.ts` | Dexie guarda clientes, prestamos, cuotas, pagos, gestiones, cola y perfil local |
| Idempotencia local | `src/lib/sync/payment-sync.ts`, `src/lib/sync/collection-action-sync.ts` | Reusa `deviceLocalId` y `clientEventId` para evitar duplicados optimistas en pagos y gestiones |
| Replay de cola | `flushPaymentSyncQueue()`, `flushCollectionActionSyncQueue()` | Reenvia el payload persistido completo a cada RPC sin reconstruirlo desde cabeceras |
| Clasificacion de errores | `normalizePaymentSyncFailure()` | Separa conflictos de negocio de errores reintentables |
| Limpieza operativa al cerrar sesion | `clearCollectorOperationalCache()` | Borra cache local solo cuando la cola ya esta resuelta |

### Gates automatizados vigentes y requeridos

| Gate | Comando o archivo | Cubre |
| --- | --- | --- |
| Fase 1 seguridad | `supabase/tests/phase1_security_gate.sql` | Gate versionado y aprobado en `LANDING` para denegación de lectura/escritura fuera de alcance, bloqueo de DML directo y perfiles inactivos |
| Fase 2 unitario | `npm run test:phase2` | Dinero, contrato financiero y normalizacion de aplicaciones |
| Fase 2 SQL | `supabase/tests/phase2_record_payment_gate.sql` | RPC `record_payment` con casos transaccionales e idempotencia |
| Fase 3 | `npm run test:phase3` | Cola offline, reintentos, persistencia y reconciliacion |
| Fase 4 unitario | `npm run test:phase4` | Planeacion de pago, bootstrap de workspace, tablero de rutas y recorrido completo `bootstrap -> ruta -> gestion -> cobro -> cola -> sync`, incluyendo cartera simulada grande |
| BR-2 rutas formales | `supabase/tests/phase4_routes_gate.sql` | Gate versionado y aprobado en `LANDING` para `customers.route_label` y persistencia coherente desde `originate_loan()` |
| BR-2 gestiones remotas | `supabase/tests/phase4_collection_actions_gate.sql` | Gate versionado y aprobado en `LANDING` para `collection_actions` + `record_collection_action()` con alcance por collector e idempotencia |
| Rendimiento BR-1 | `npm run test:perf` | Ruta grande, build de produccion y presupuesto versionado del bundle inicial |
| Validacion general | `npm run check` | Lint y build |
| Smoke remoto Fase 4 | `scripts/phase4-auth-user.mjs` | `login -> profile -> customers -> loans -> installments` y validacion de dataset remoto esperado |
| Playground remoto de negocio | `npm run db:playground:reset` + `npm run playground -- ...` | Cartera editable en `LANDING`, pagos reales, liquidaciones reales y verificacion del estado remoto final |
| Smoke móvil Fase 4 | `scripts/phase4-mobile-smoke.mjs` | `login -> menu movil -> cobro offline -> cola local -> resync online` sin errores de runtime en ese recorrido |
| Politica de inline styles | `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"` | Detecta deriva contra la subfase 4.3 |

## Validacion local reejecutada en esta revision

- Fecha: 6 de mayo de 2026.
- Gates locales reejecutados y aprobados:
  - `npm run test:phase2`
  - `npm run test:phase3`
  - `npm run test:phase4`
  - `npm run test:perf`
  - `npm run check`
- Resultado del presupuesto vigente:
  - `npm run test:perf` ya volvió a verde con `entry total = 410127 raw / 125325 gzip`, `javascript entry = 383345 raw / 119733 gzip`, `css entry = 26782 raw / 5592 gzip` e `index chunk = 347525 raw / 105496 gzip`.

## Matriz comparativa: lo que tenemos vs lo que debemos tener

| Capacidad | Estado actual | Debemos tener | Brecha real | Fase dueña | Gate para avanzar |
| --- | --- | --- | --- | --- | --- |
| Auth con sesion persistida | Completo | Mantener login seguro y reingreso offline | Sin brecha activa en el alcance actual; el procedimiento manual queda diferido por decisión de producto | Fase 4 | `scripts/phase4-auth-user.mjs` y `docs/phase4-manual-validation.md` |
| Carga de cartera por cobrador | Completo | Mantener bootstrap remoto -> cache local | La compuerta automatizada ya cubre dataset operativo, jornada del cobrador y cartera simulada grande; la confirmación manual queda diferida y no bloquea el cierre activo | Fase 4 | `npm run test:phase4` y `docs/phase4-manual-validation.md` |
| Alta de deudor y prestamo | Completo para V1 | Alta rapida y segura comparable con el baseline acotado | El RPC, los grants controlados, el cronograma canonico, el wizard local, la convergencia cartera -> cobro y la compuerta final de roles ya existen; el trabajo futuro de roles/reportes pertenece a `BR-4`, no a este subplan | Subplan de originacion | Gates `OR-0` a `OR-5` |
| Rutas de cobro | Parcial | Ruta remota persistida o entidad dedicada de backend | `customers.route_label` ya existe como fuente remota vigente; la brecha real restante es una entidad dedicada de rutas, no la validación manual móvil | BR-2 | `npm run test:phase4` + `supabase/tests/phase4_routes_gate.sql` + smoke UI |
| Detalle de prestamo y cuotas | Completo | Mantener claridad operativa | Sin brecha activa en el cierre automatizado; el smoke táctil queda diferido | Fase 4 | `docs/phase4-manual-validation.md` |
| Planeacion oldest-first | Completo | Mantener convergencia UI/cache/RPC | Ya cubierto en V1 | Fase 2 | `npm run test:phase2` y `npm run test:phase4` |
| RPC transaccional de cobro | Completo | Mantener atomicidad e idempotencia | El patrón base ya quedó revalidado también bajo `BR-6`; cualquier cambio futuro debe conservar coexistencia V1/V2 y las compuertas heredadas | Fase 2 / BR-6 | `supabase/tests/phase2_record_payment_gate.sql` + `supabase/tests/phase6_reverse_payment_gate.sql` + `supabase/tests/phase6_financial_v2_gate.sql` |
| Cola offline visible | Completo para flujo headless | Mantener reintento seguro y estados claros | Sin brecha activa en el cierre automatizado; la validación en dispositivo real queda diferida | Fase 3 y 4 | `npm run test:phase3` + `scripts/phase4-mobile-smoke.mjs` |
| Escritura critica solo por RPC | Completo para write paths actuales | Blindar integridad operacional en `public` | El patrón debe repetirse solo cuando aparezcan nuevas escrituras críticas fuera de cobro/reverso/gestión | Fase 1 / BR-5 | `supabase/tests/phase1_security_gate.sql` + revisión de grants |
| Bloqueo por perfil inactivo | Completo | Desactivar un cobrador sin abrir un hueco de sesión | Mantener el mismo bloqueo en futuros flujos operativos remotos | Fase 1 / futura | Gate SQL de seguridad + smoke Auth/RLS |
| Ownership de `device_id` en pagos | Completo para pagos V1 | Asegurar trazabilidad real del dispositivo | Repetir la validación si futuros eventos aceptan `device_id` | Fase 2 / futura | SQL gate de `record_payment` ampliado |
| Recibo digital | Completo para BR-3 base | Recibo consistente con pago confirmado por servidor | El comprobante remoto ya existe y la UI distingue pendiente vs confirmado; la impresión física sigue pendiente como integración aparte | BR-3 | `npm run test:phase5` + `supabase/tests/phase5_receipt_gate.sql` + `npm run check` |
| GPS best-effort | Diferido | Mantener captura opcional sin volverla gate de release | La implementación sigue disponible, pero el usuario difirió su validación e integración como objetivo activo | Diferido | No bloquea el cierre actual |
| Gestion de visita | Completo para el contrato base de BR-2 | Auditoria operativa consistente | El sync remoto ya quedó revalidado; no hay bloqueo activo adicional en esta línea | BR-2 / BR-1 | `npm run test:phase4` + `supabase/tests/phase4_collection_actions_gate.sql` |
| Abonos dirigidos a capital o interes | Completo para el contrato base de `BR-6` | Flexibilidad comparable con PrestaBIT cuando entre a alcance | El backend remoto y el contrato V2 ya aceptan `principal_only` e `interest_only`; la exposición comercial puede graduarse en UI sin reabrir SQL | BR-6 | `npm run test:financial-v2` + `supabase/tests/phase6_financial_v2_gate.sql` + `supabase/tests/phase2_record_payment_gate.sql` |
| Roles `admin/collector` | Completo para el contrato base de BR-4 | Roles operativos diferenciados end-to-end | Los guards, la navegación visible y la denegación remota ya existen; en la UI visible corresponden a administrador y cobrador | BR-4 / BR-1 | `npm run test:phase5` + `supabase/tests/phase5_roles_gate.sql` + smoke por rol |
| Politica de inline styles | Completo | Cero estilos inline estaticos o excepciones justificadas | Sin brecha activa; el remanente de `src/App.tsx` ya fue movido a clases compartidas | Fase 4, subfase 4.3 | `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"` |
| Rendimiento con cartera grande | Completo para el cierre activo | UI fluida con volumen y bundle movil razonable | `test:phase4`, `test:perf` y `check` ya cubren la compuerta vigente; la validación física queda diferida por decisión de producto | Fase 4 y 5 | `npm run test:phase4` + `npm run test:perf` + `npm run check` |
| Reportes en tiempo real | Completo para el contrato base de BR-4 | Comparar al menos con baseline de CobrApp | Ya existe panel visible para el rol `admin` (administrador) con métricas, filtros y salud de sincronización local; futuras expansiones de alcance ya no dependen de la validación manual móvil diferida | BR-4 / BR-1 | `npm run test:phase5` + `supabase/tests/phase5_reports_gate.sql` + smoke por rol |
| Interes compuesto | Completo para el contrato base de `BR-6` | Baseline comparable con PrestaBIT si entra a alcance | `compound_fixed_installment` ya quedó materializado en backend y revalidado contra coexistencia V1/V2; la expansión futura es de producto, no de contrato base | BR-6 | `npm run test:financial-v2` + `supabase/tests/phase6_financial_v2_gate.sql` |
| Reverso de pagos | Completo para BR-5 y coexistencia `BR-6` | Trazabilidad completa de compensacion | El flujo ya existe con RPC admin-only, recibo reversado, compuerta SQL, smoke multi-sesión y contrato visible restaurado tras la reescritura V2 | BR-5 / BR-6 | `npm run test:phase6` + `supabase/tests/phase6_reverse_payment_gate.sql` + `scripts/phase6-reversal-concurrency-smoke.mjs` |
| Impresion Bluetooth | Pendiente | Capacidad real prevista por benchmark | No implementada | Fase 5 o integracion dedicada | Smoke de recibo fisico |

## Control de fases

### Fase 0. Reingreso y entorno

- [x] `AGENTS.md` y documentos base revisados
- [x] MCP de Supabase verificado en la sesion previa documentada
- [x] `npm run check` definido como gate general
- Gate vigente: verificacion de MCP y `npm run check`

### Fase 1. Capa de datos remota

- [x] Esquema base y migraciones aplicadas
- [x] RLS y helpers privados definidos
- [x] `record_payment` endurecido y documentado
- [x] Policies críticas separadas por operación y no por `FOR ALL`
- [x] Grants remotos revisados para evitar DML directo donde la arquitectura exige RPC
- [x] `profiles.active` integrado al control de acceso real
- [x] Gate negativo de seguridad versionado y aprobado
- Gate vigente:
  - [x] `supabase migration list --linked`
  - [x] `supabase db lint --linked --level warning`
  - [x] `supabase db advisors --linked`
  - [x] `supabase/tests/phase1_security_gate.sql`
  - [x] `supabase/tests/phase2_record_payment_gate.sql`

### Fase 2. Contrato financiero

- [x] Helpers de dinero versionados
- [x] Contrato financiero V1 documentado
- [x] RPC y frontend alineados a `fee -> interest -> principal`
- Gate vigente:
  - [x] `npm run test:phase2`
  - [x] `supabase/tests/phase2_record_payment_gate.sql`

### Fase 3. Sync offline real

- [x] Cola local con estados
- [x] Replay idempotente
- [x] Reintentos y clasificacion de errores
- Gate vigente:
  - [x] `npm run test:phase3`
  - [x] `npm run check`

### Fase 4. UI operativa

- [x] Login
- [x] Bootstrap remoto a IndexedDB
- [x] Cartera, detalle, cobro, recibo y cola visibles
- [x] Tablero provisional de ruta/prioridad
- [x] Gestion de visita con cola offline
- [x] Navegacion y permisos visibles por rol
- [x] Reportes operativos minimos para `admin`
- [x] Procedimiento manual movil documentado y diferido por decisión de producto
- [x] Smoke offline: entrar, revisar cartera, cobrar y ver cola
- [x] Smoke online: sincronizar y confirmar
- [x] Validacion con cartera grande o simulada
- [x] Sin errores de consola en estados principales
- [x] Politica de inline styles restablecida o excepciones justificadas
- [x] Presupuesto local de runtime y bundle inicial versionado
- [x] Procedimiento manual de cierre documentado
- Gate vigente:
  - [x] `npm run test:phase4`
  - [x] `npm run test:perf`
  - [x] `scripts/phase4-auth-user.mjs`
  - [x] `scripts/phase4-mobile-smoke.mjs`
  - [x] `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"` sin deriva
  - [x] `docs/phase4-manual-validation.md`
  - [x] `docs/phase4-manual-validation.md` queda archivado como procedimiento diferido, no como gate activo

### Fase 5. Despliegue y operacion

- [ ] Preview deployment por rama
- [ ] Variables de entorno auditadas
- [ ] Smoke en preview
- [ ] Procedimiento de rollback
- [x] Runbook operativo y de debugging basico documentado
- [ ] Definicion de recibo fisico/Bluetooth si entra al release
- [x] Checklist de release preparado
- Gate vigente:
  - [ ] `npm run build`
  - [ ] Smoke en preview
  - [ ] Checklist de release

## Hallazgos de esta revision

1. La comparacion contra referentes confirma que la base transaccional, offline y mobile-first ya existe, y que ya se abrió la capa minima de reportes, separación visible por rol y reverso trazable, pero la app todavia no iguala el baseline de recibo fisico, una entidad dedicada de rutas, abonos dirigidos a capital/interes ni percepcion operativa validada en dispositivo fisico con carga real comparable.
2. El hardening perimetral de la base ya quedó aplicado en `LANDING`: las policies críticas fueron separadas por operación, el DML directo del cliente quedó acotado al contexto interno del RPC y la compuerta negativa ya cubre denegación real por fila, rol y operación.
3. `profiles.active` ya gobierna RLS y RPC críticos en el flujo operativo de cobro; un cobrador inactivo queda bloqueado en lecturas y en `record_payment` aun si conserva una sesión válida.
4. La gestión de visita ya dejó de ser un apunte exclusivamente local en código: `collection-action-sync.ts` conserva la continuidad offline, `record_collection_action()` versiona el write path remoto y la compuerta `phase4_collection_actions_gate.sql` ya quedó verde en `LANDING`.
5. `buildCollectorRouteBoard()` ya consume la fuente remota vigente `customers.route_label`, pero el agrupamiento diario sigue siendo una capa operativa transitoria mientras no exista una entidad dedicada de rutas.
6. `BR-4` ya quedó materializado en el contrato base: la shell resuelve capacidades por rol en frontend, `collector` no ve panes administrativos/reportes y `admin` ya consume `public.get_operational_report()` sin bypass de RLS.
7. La compuerta de la subfase 4.3 ya vuelve a sostenerse: los estilos inline estaticos remanentes de `src/App.tsx` fueron movidos a clases compartidas y Fase 4 ya no depende de un gate manual activo para su cierre.
8. La validacion local reejecutada en esta revision dejó verdes `test:phase2`, `test:phase3`, `test:phase4`, `test:phase5`, `test:perf` y `check`; `BR-1` ya no arrastra deuda de bundle y su parte manual queda diferida por decisión de producto.
9. La revalidación remota posterior a `BR-6`, incluyendo `phase6_restore_reverse_payment_contract_compat` y `phase7_restore_origination_rls_initplan`, no dejó lints de performance del dominio operativo; el único `WARN` restante sigue siendo `auth_leaked_password_protection`, que depende de configuración Auth fuera del repo.
