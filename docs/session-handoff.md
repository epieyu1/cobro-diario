# Session Handoff

## Estado confirmado al cierre de esta sesión

### GitHub

- Repo remoto configurado: `https://github.com/epieyu1/cobro-diario.git`
- Rama principal: `main`
- Commit inicial publicado: `0261ccc` (`chore: bootstrap cobro diario foundation`)
- Candidato local actual de preview: rama `preview-phase5-candidate-20260507`
- Commit local actual del candidato: `cb3d560` (`docs: record preview candidate branch`)
- Estado actual: el candidato ya quedó empujado a GitHub y sigue trackeando `origin/preview-phase5-candidate-20260507`.

### Supabase CLI

- `supabase login`: completado
- `supabase link --project-ref vmlxfbqezgjivesxahfe`: completado
- Proyecto enlazado localmente: `LANDING`
- Verificación vigente: `supabase projects list --output json` mostró `linked: true` para `LANDING`

### Supabase proyecto objetivo

- Nombre: `LANDING`
- `project_ref`: `vmlxfbqezgjivesxahfe`
- URL: `https://vmlxfbqezgjivesxahfe.supabase.co`
- Host DB: `db.vmlxfbqezgjivesxahfe.supabase.co`

### Frontend local

- `.env.local` ya apunta a `LANDING`
- `VITE_SUPABASE_URL` configurado
- `VITE_SUPABASE_PUBLISHABLE_KEY` configurado
- `npm run check` pasó después de la configuración local

### MCP de Supabase

- `.mcp.json` del repo apunta a `https://mcp.supabase.com/mcp?project_ref=vmlxfbqezgjivesxahfe`
- `~/.codex/config.toml` quedó corregido al mismo `project_ref`
- El MCP ya respondió correctamente en sesión nueva con `get_project_url`, `get_publishable_keys` y `list_tables`
- En la sesión del `2026-05-06` también quedó observado un bloqueo distinto:
  `codex mcp list` y `codex mcp get supabase` seguían viendo el servidor `supabase`,
  pero `list_mcp_resources(server="supabase")` falló por `OAuth token refresh failed`.
  Si vuelve a aparecer ese síntoma, no lanzar un segundo login en la misma sesión; tratarlo
  como bloqueo de refresh/callback y reiniciar Codex antes de intentar otra autenticación.

### Cierre BR-6 y revalidación del `2026-05-07`

- `LANDING` ya tiene aplicadas `phase6_financial_v2_remote_contract`, `phase6_financial_v2_foundations`, `phase6_financial_v2_record_payment`, `phase6_financial_v2_reverse_payment`, `phase6_restore_reverse_payment_contract_compat` y `phase7_restore_origination_rls_initplan`
- `supabase/tests/phase6_financial_v2_gate.sql` ya pasó por MCP con `ROLLBACK`
- `supabase/tests/phase2_record_payment_gate.sql` fue actualizado al esquema real (`loans.created_by`) y volvió a pasar por MCP con `ROLLBACK`
- `supabase/tests/phase6_reverse_payment_gate.sql` volvió a pasar por MCP con `ROLLBACK` después de restaurar los códigos heredados `operator_inactive` y `reverse_role_not_allowed`
- `supabase/tests/phase7_origination_security_gate.sql` volvió a pasar por MCP con `ROLLBACK` después de restaurar el patrón `initplan` en las policies de originación
- `public.originate_loan()`, `public.record_payment()` y `public.reverse_payment()` ya sostienen coexistencia V1/V2 sobre saldos remotos por componente
- `get_advisors(performance)` volvió a quedar limpio; el único `WARN` activo sigue siendo `auth_leaked_password_protection`
- `BR-6` ya no queda como siguiente frente de código dentro del repo; el pendiente formal previo del roadmap era la validación manual móvil de `BR-1`, pero ese gate quedó diferido después por decisión de producto

### Endurecimiento de idempotencia del `2026-05-07`

- `LANDING` ya tiene aplicada `phase6_harden_record_payment_idempotency`
- `public.record_payment()` ya no acepta el mismo `device_local_id` cuando cambia `paid_at`, `payment_reference`, metadata o el arreglo de `applications`
- el helper privado `private.record_payment_payload_matches_existing()` quedó como comparación canónica del payload remoto
- `supabase/tests/phase2_record_payment_gate.sql` volvió a pasar por MCP con `ROLLBACK` después de agregar el caso negativo de payload mutado
- `src/lib/sync/payment-sync.ts` replica la misma regla en IndexedDB: un reintento local solo reusa la cola si el snapshot canónico del cobro es idéntico

### Recibo enriquecido y PDF del `2026-05-07`

- `LANDING` ya tiene aplicada `phase5_enriched_payment_receipt_pdf_contract`
- `public.get_payment_receipt()` ahora devuelve `collector.id` y `collector.fullName` junto con el comprobante confirmado
- `src/lib/receipts/receipt-panel.tsx` ya separa comprobante confirmado vs snapshot actual del crédito y prepara el PDF apenas llega la confirmación remota
- la acción primaria del recibo ya es mobile-first: `Compartir PDF` si el navegador soporta compartir archivos y `Guardar PDF` como fallback
- `src/lib/receipts/receipt-pdf.ts` ya genera un PDF real con `jspdf` dentro del chunk diferido del recibo, sin penalizar el shell móvil
- `scripts/phase5-receipt-pdf-smoke.ts` ya pasó con un pago real sobre `PG-ELI-001` en `LANDING`
- evidencia del smoke real:
  - `paymentId = c4b45a77-a2e3-40b0-85f8-e415c585f767`
  - `receiptReference = PDF-PG-ELI-001-1778175551427`
  - `outputPath = /var/folders/7q/rlhk14sx41z4r8pkzfbrpwzw0000gn/T/cobro-diario-receipt-smoke/recibo-pdf-pg-eli-001-1778175551427.pdf`
- `supabase/seeds/phase4_landing_playground.sql` y `supabase/seeds/phase4_landing_smoke.sql` quedaron alineados con el esquema actual de `public.loans` e `installments`, incluyendo `created_by`, metadatos de originación y saldos pendientes por componente

### Cambio de criterio del `2026-05-07`

- la validación manual móvil de `BR-1` quedó diferida por decisión explícita de producto
- Fase 4 puede tratarse como cerrada para el alcance activo con evidencia automatizada reproducible
- Fase 5 deja de estar bloqueada por Fase 4 y queda en progreso con despliegue `preview` Git reproducible ya emitido.
- URL de Producción: https://cobro-diario.vercel.app
- URL de Preview inicial: https://cobro-diario-eru6x6mu7-alexander-restrepo-epieyus-projects.vercel.app
- URL de Preview Git vigente (`2026-05-07`): https://cobro-diario-6gkgufjfr-alexander-restrepo-epieyus-projects.vercel.app
- Alias Git del preview vigente: https://cobro-diario-git-pre-6576ff-alexander-restrepo-epieyus-projects.vercel.app
- Rama desplegada para el preview vigente: `preview-phase5-candidate-20260507`
- Commit candidato publicado para el preview vigente: `cb3d560`
- El proyecto fue vinculado a la cuenta `epieyu1` y las variables de entorno públicas (`VITE_*`) fueron configuradas para todos los entornos.
- La auditoría de Vercel confirmó presencia de `VITE_APP_NAME`, `VITE_DEFAULT_LOCALE`, `VITE_DEFAULT_CURRENCY`, `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en `Development`, `Preview` y `Production`, sin exponer sus valores.
- El smoke del preview Git sigue pendiente antes de tratar esta URL como candidato operativo compartible.

### Smoke operativo de preview del `2026-05-07`

- La rama `preview-phase5-candidate-20260507` volvió a disparar un preview Git nuevo después del commit documental `5df099e`:
  - URL directa vigente: https://cobro-diario-jo7ayujx7-alexander-restrepo-epieyus-projects.vercel.app
  - alias Git estable: https://cobro-diario-git-pre-6576ff-alexander-restrepo-epieyus-projects.vercel.app
- `scripts/phase4-mobile-smoke.mjs` no pudo completar el smoke sobre el preview porque ambas URLs respondieron `HTTP/2 403` con `x-vercel-mitigated: challenge` y `x-vercel-challenge-token`.
- Ese bloqueo quedó identificado como barrera perimetral de Vercel sobre el preview, no como error demostrado de la app dentro del runtime.
- La verificación complementaria de backend dejó dos resultados separados:
  - `npm run smoke:receipt-pdf -- fase4.playground@cobrodiario.dev 123456 PG-ELI-001` pasó contra `LANDING`, con `paymentId = 8a83c962-78d3-45e5-8741-6fbcadd828d7` y PDF válido en `/var/folders/7q/rlhk14sx41z4r8pkzfbrpwzw0000gn/T/cobro-diario-receipt-smoke/recibo-pdf-pg-eli-001-1778177809863.pdf`
  - `node scripts/phase4-auth-user.mjs smoke fase4.collector@cobrodiario.dev 123456 collector` falló con `expected_overdue_installments:1<2`
- El snapshot real visible para `fase4.collector@cobrodiario.dev` al momento del smoke fue:
  - `customerCount = 7`
  - `loanStatusCounts = { delinquent: 1, active: 2, settled: 4 }`
  - `installmentStatusCounts = { paid: 7, overdue: 1, pending: 6 }`
  - `partialOutstandingInstallments = []`
- La cartera remota de ese cobrador quedó contaminada por residuos smoke (`OR4 Smoke ...`, `RV6 Smoke ...`) y ya no coincide con el baseline histórico rígido del smoke Auth/RLS.

### Criterio operativo de altas del `2026-05-07`

- El alta de `collector` (cobrador) queda fijada como flujo exclusivo de la app web bajo sesión `admin`, usando `public.provision_collector_account(...)`.
- El alta de `admin` (administrador) queda fijada como flujo manual en Supabase, alineando `auth.users.raw_app_meta_data.role = 'admin'`, `public.profiles.role = 'admin'` y `public.profiles.active = true`.
- No debe usarse `Authentication > Users` como flujo aislado para cobradores, porque dejaría a Auth y `public.profiles` potencialmente desalineados.
- El runbook vigente para esta operación vive en `docs/deployment-runbook.md`.

### Hallazgo operativo del `2026-05-07`: cartera agregada contaminada por smoke remoto

- El valor visible `COP 910.210` en `Total Cartera` no vino de una suma defectuosa del frontend.
- La ruta `src/App.tsx -> totalOutstanding -> workspace.loanCards[].outstandingAmount` coincidió con la fuente remota de verdad en `LANDING`: `910210.00`.
- El corte exacto fue:
  - cartera operativa base: `910000.00`
  - residuo abierto de smoke remoto: `210.00`
- Ese `210.00` salió de tres préstamos de prueba todavía abiertos en `LANDING`:
- Ese `210.00` salió de tres préstamos de prueba que estaban abiertos en `LANDING`:
  - `OR4 Smoke ...` con `70.00`
  - `OR4 Smoke ...` con `70.00`
  - `RV6 Smoke ...` con `70.00`
- La limpieza remota ya se ejecutó el `2026-05-07` usando `public.record_payment()` bajo contexto real de cobrador, dejando:
  - `total_with_smoke = 910000.00`
  - `total_without_smoke = 910000.00`
  - `smoke_residual_total = 0.00`
- Para no volver a contaminar el total agregado:
  - `scripts/phase7-origination-smoke.mjs` ahora liquida el saldo restante antes de terminar,
  - `scripts/phase6-reversal-concurrency-smoke.mjs` ahora vuelve a dejar el préstamo de prueba en `settled` después del reverso validado,
  - y ambos cleanups pasan por `record_payment()`; no hacen mutaciones directas sobre tablas remotas.

### Esquema remoto validado

- `supabase db push` aplicó `20260505063813_foundational_schema.sql` en `LANDING`
- `supabase db push` aplicó `20260505135552_quarantine_demo_table_access.sql` en `LANDING`
- `supabase db push` aplicó `20260505135842_harden_function_search_path_and_fk_indexes.sql` en `LANDING`
- `supabase db push` aplicó `20260505141438_tighten_record_payment_contract.sql` en `LANDING`
- `supabase db push` aplicó `20260505145152_finalize_payment_allocation_v1.sql` en `LANDING`
- `supabase db push` aplicó `20260505172157_grant_private_schema_usage_for_rls_helpers.sql` en `LANDING`
- `list_migrations` ya muestra las seis migraciones aplicadas
- `list_tables` en `public` ya expone el dominio base: `profiles`, `devices`, `customers`, `loans`, `installments`, `payments`, `payment_applications`, `payment_events`, `sync_events`
- La migración fundacional se corrigió para calificar `extensions.gen_random_uuid()` y no depender de `search_path` implícito
- Las funciones base ahora fijan `search_path = ''`
- Los foreign keys que el advisor marcó sin índice ya quedaron cubiertos
- `supabase db lint --linked --level warning` terminó sin errores de esquema
- `record_payment` ya valida `device_local_id`, alcance de préstamo, estados pagables, duplicados por cuota y coherencia entre componentes y `applied_amount`
- `record_payment` ahora también exige `paid_at`, obliga cobrar la cuota más antigua primero y valida orden `fee -> interest -> principal` dentro de cada cuota
- El contrato temporal de pagos quedó documentado inline en `src/lib/finance/payment-contract.ts`, en el SQL de `record_payment` y en comentarios de objetos remotos
- La compuerta transaccional del RPC quedó versionada en `supabase/tests/phase2_record_payment_gate.sql` y ya pasó contra `LANDING` con `ROLLBACK`
- `npm run test:phase2`, `npm run check`, `supabase db lint --linked --level warning` y los advisors vigentes quedaron en verde operativo para la Fase 2
- La cola offline real ya vive en `src/lib/sync/payment-sync.ts` y `src/lib/db/local-db.ts`
- IndexedDB ahora conserva `syncStatus`, `clientEventId`, metadata de error/reintento y saldos por componente en cuotas locales
- `docs/offline-sync.md` fija el flujo de enqueue, replay, error y reconciliación local
- `npm run test:phase3` ya cubre enqueue offline, persistencia al reabrir, sync exitoso, reintento idempotente, error remoto y reconciliación local
- La compuerta de Fase 3 prueba la capa de sync con IndexedDB simulada y transporte remoto controlado; la validez real del RPC contra `LANDING` sigue cubierta por la compuerta SQL de Fase 2
- La base de Fase 4 ya vive en `src/App.tsx`, `src/lib/collector/collector-workspace.ts`, `src/lib/finance/payment-planning.ts`, `src/lib/supabase/auth-session.ts` y `src/lib/device/geolocation.ts`
- La UI ya soporta login con password, bootstrap remoto a IndexedDB, cartera por asignacion, detalle de prestamos/cuotas, preview oldest-first, recibo local pendiente vs comprobante remoto confirmado y cola offline con reintentos
- La shell operativa ahora prioriza cartera por la fuente remota vigente `customer.routeLabel`; solo cae a `customer.neighborhood` o al tramo final de `address` como compatibilidad mientras no exista una entidad dedicada de rutas
- `docs/function-gap-control.md` ya registra el corte activo de brechas funcionales sin competir con `docs/implementation-plan.md`
- `list_migrations` por MCP ya muestra `phase4_formalize_customer_route_label` y `phase4_collection_actions_remote_sync` aplicadas en `LANDING`
- `supabase/tests/phase4_routes_gate.sql` y `supabase/tests/phase4_collection_actions_gate.sql` ya pasaron por MCP con `ROLLBACK`, validando `route_label`, alcance por collector e idempotencia de `record_collection_action()`
- Los advisors posteriores a `BR-2` ya no dejan `WARN` o `ERROR` nuevos del dominio operativo; después de `phase4_cover_fk_indexes_and_demo_rls` solo persiste el `WARN` heredado de Auth por `Leaked Password Protection`
- `src/index.css` ya concentra las primitivas visuales reales que usa `src/App.tsx`, incluyendo `.input` unificada para login, busqueda y registro de cobro
- La experiencia movil ahora mantiene un menu hamburguesa sticky desde el primer render: en bloqueo de entorno muestra setup/contexto, durante bootstrap muestra estado de arranque, en estado publico apunta a acceso/reglas/arquitectura, y con sesion `src/App.tsx` usa `activeMobilePane` para alternar `portfolio` y `detail` mientras `Operacion` abre una hoja operativa con la misma fuente de verdad de estado
- La shell ya encola gestion de visita (`promise_to_pay`, `not_found`, `return_visit`, `visited_no_payment`) con `enqueueOfflineCollectionAction()`, manteniendo visibilidad inmediata en IndexedDB y reintento posterior contra un RPC dedicado
- El panel operativo ahora se navega con un menu explicito (`Cobro`, `Gestion`, `Recibo`, `Cola`, `Reglas`) dentro de una `operations-sheet` movil y de un panel persistente en desktop
- La sesión `admin` ya no queda recortada a cartera propia vacía: el bootstrap remoto y el snapshot local ahora agregan todos los `customers`, `loans` e `installments` que RLS le permita leer, y la originación puede enfocar en la misma sesión un préstamo asignado a otro cobrador
- `src/index.css` ya fue invertido a mobile-first real: móvil es la base y desktop entra por `@media (min-width: ...)`
- El bootstrap de IndexedDB ya no cierra `localDb` en el cleanup del efecto base; Dexie queda abierto durante la vida de la app para no romper el remount de React `StrictMode`
- El refresh remoto ahora se bloquea si quedan items `pending`, `processing` o `failed` en la cola para no pisar saldos optimistas locales
- El cierre de sesion ahora exige cola limpia y luego borra el cache operativo local para no mezclar cartera entre cobradores
- `docs/operational-ui.md` documenta decisiones UX, restricciones y tradeoffs de la UI operativa
- `docs/audit-report.md` ya marca cerradas las subfases 4.2 y 4.4 del subplan de UI; queda pendiente solo evidencia manual responsive/tactil en dispositivo real
- `npm run test:phase4`, `npm run test`, `npm run check`, `npm run build`, `npm run lint` y `npm run typecheck` quedaron en verde para la implementacion base de Fase 4
- `supabase/seeds/phase4_landing_smoke.sql` ya deja un cobrador semilla operativo en `LANDING`
- El usuario semilla es `fase4.collector@cobrodiario.dev`, la clave de smoke vigente es `123456` y el smoke remoto autenticado ya pasó con `scripts/phase4-auth-user.mjs`
- `supabase/seeds/phase4_landing_playground.sql` ya deja un cobrador playground separado en `LANDING`
- El usuario playground es `fase4.playground@cobrodiario.dev`, la clave vigente es `123456` y `scripts/phase4-playground.mjs` ya soporta `status`, `pay` y `settle` sobre la cartera real editable
- `supabase/seeds/phase7_landing_roles.sql` ya deja un acceso operativo no productivo adicional para validar el rol `admin` en `LANDING`
- El usuario `admin` vigente es `fase7.admin@cobrodiario.dev` con clave `123456`
- `node scripts/phase4-auth-user.mjs smoke fase7.admin@cobrodiario.dev 123456` ya pasó contra `LANDING`
- El set operativo actual de credenciales queda reducido a tres accesos reales: `fase7.admin@cobrodiario.dev`, `fase4.collector@cobrodiario.dev` y `fase4.playground@cobrodiario.dev`, todos con clave `123456`
- `LANDING` ya quedó saneado a dos roles reales (`admin` y `collector`): el enum `public.app_role` ya no conserva valores legacy, el helper privado viejo ya fue eliminado y la identidad residual inactiva de pruebas ya no existe en remoto
- La revalidación final del corte de roles quedó registrada con `supabase/tests/phase7_origination_security_gate.sql` en verde, `node scripts/phase4-auth-user.mjs smoke fase7.admin@cobrodiario.dev 123456` en verde y `node scripts/phase4-auth-user.mjs smoke fase4.collector@cobrodiario.dev 123456` en verde
- `docs/origination-control.md` ya abrió el subplan formal de originación sin romper la regla de “no planes paralelos”
- `OR-0` ya quedó cerrado en ese subplan: `admin` origina, `collector` no, la originación V1 será `online-required`, usará solo `simple_precomputed`, soportará `nuevo deudor` y `deudor existente`, y no permitirá más de un préstamo abierto por deudor
- `supabase db push --linked` aplicó `20260506205243_phase7_origination_rpc_and_rls.sql` y `20260506212001_phase7_optimize_origination_rls_initplan.sql` en `LANDING`
- `public.originate_loan()` ya quedó funcional en remoto con helpers privados de contexto/rol, nuevas columnas de trazabilidad en `public.loans` y policies de `INSERT` controlado para originación
- `supabase/tests/phase7_origination_security_gate.sql` ya pasó contra `LANDING` y cubre `admin`, denegación a `collector`, denegación a perfil inactivo, rollback sin huérfanos y bloqueo de DML directo para el nuevo write path
- `supabase db lint --linked --level warning` pasó después de OR-1 y `supabase db advisors --linked` ya no deja `WARN` nuevos de originación; solo persiste el `WARN` heredado de Auth por `Leaked Password Protection`
- `supabase db push --linked` también aplicó `20260506212651_phase7_origination_schedule_v1.sql`, `20260506213204_phase7_clean_origination_schedule_lint.sql` y `20260506213302_phase7_fix_schedule_out_variable_shadow.sql` en `LANDING`
- `private.next_origination_due_date()` y `private.build_origination_schedule()` ya fijan el cronograma canonico V1, y `public.originate_loan()` rechaza previews que no coincidan exactamente con ese calendario y reparto financiero
- `npm run test:phase7` ya pasó con `6` casos verdes para el preview TypeScript de originación
- `supabase/tests/phase7_origination_schedule_gate.sql` ya pasó contra `LANDING` por MCP y revalidó fechas `daily/weekly/biweekly/monthly`, residual de redondeo, rechazo por total bajo capital y persistencia correcta del cronograma
- `supabase/tests/phase7_origination_security_gate.sql` también fue reejecutado por MCP después del cambio de cronograma para confirmar que OR-2 no abrió huecos de permisos ni rompió atomicidad del write path
- El saneamiento final de roles también ya quedó aplicado en remoto con `phase7_drop_legacy_role_residue` y `phase7_refresh_origination_rpc_role_cutover`, lo que recompuso `public.originate_loan()` contra `private.is_admin()`, recreó `public.app_role` sin residuos y dejó la compuerta OR-1 nuevamente en verde
- Los advisors vistos por MCP después de OR-2 no dejaron `WARN` o `ERROR` nuevos del dominio operativo de originación; siguen solo el `WARN` heredado de Auth por `Leaked Password Protection`, el `INFO` de la tabla demo cuarentenada y `INFO` de índices aún sin uso
- `src/lib/origination/origination-validation.ts`, `src/lib/origination/origination-wizard.ts`, `src/lib/origination/origination-transport.ts` y `src/lib/origination/origination-wizard-panel.tsx` ya versionan OR-3 en frontend
- `src/App.tsx` y `src/index.css` ya integran `Originacion` como panel separado dentro de la `operations-sheet`, con CTA visible para `admin`, bloqueo de `collector`, paso `Deudor -> Prestamo -> Confirmacion`, busqueda remota de deudor existente y mensaje explicito de `requiere conexion`
- `src/lib/origination/origination-wizard-panel.tsx` ahora tambien deja crear un `collector` desde el mismo paso `Deudor` si no hay uno activo disponible; el alta ya no usa `auth.signUp()` en browser: viaja por `public.provision_collector_account()` para materializar `auth.users`, `auth.identities` y `public.profiles` sin reemplazar la sesion `admin`
- `src/lib/origination/collector-management-panel.tsx` ya deja esa misma alta en una vista separada dentro de `Gestion`, con listado de cobradores activos, para que `admin` no dependa del wizard de originacion para administrar accesos operativos
- `supabase/migrations/20260507002021_phase7_collector_account_provisioning_rpc.sql` ya quedó aplicado en `LANDING`; deja versionado el write path seguro de alta de cobradores y `supabase/tests/phase7_collector_provisioning_gate.sql` ya pasó por MCP con admin permitido, correo duplicado, collector denegado y admin inactivo denegado
- `supabase/migrations/20260507003901_phase7_recover_orphan_collector_accounts.sql` ya quedó aplicado en `LANDING`; ahora el mismo RPC recupera correos huerfanos en `auth.users` sin `public.profiles` en vez de dejarlos como duplicados invisibles. El caso detectado en esta sesión fue `marley@gmail.com`, creado el `2026-05-07 00:07:14+00`
- `npm run test:phase7` ahora cubre `origination-schedule`, `origination-validation` y `origination-wizard`; en esta sesion paso con `13` pruebas verdes
- `npm run check` ya volvió a pasar despues de integrar el wizard y `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"` sigue limpio
- `src/lib/collector/collector-workspace.ts` ya conserva `external_loan_number`, fechas y frecuencia del prestamo remoto, y el bootstrap ahora solo materializa cuotas de los `loans` visibles del cobrador actual
- `src/App.tsx` ya permite buscar por `external_loan_number` y el detalle del préstamo ya muestra consecutivo, frecuencia, fechas y cronograma del caso originado
- `scripts/phase7-origination-smoke.mjs` ya pasó contra `LANDING` con `fase7.admin@cobrodiario.dev -> fase4.collector@cobrodiario.dev -> record_payment`, dejando un préstamo nuevo visible y la primera cuota pagada por el flujo real
- `supabase/tests/phase7_origination_roles_gate.sql` ya cerró `OR-5` con `ROLLBACK`: `admin` activo puede originar, un claim inesperado se degrada a `collector`, `collector` no puede originar, un `admin` inactivo queda bloqueado y un `collector` inactivo no puede recibir alta nueva
- `scripts/phase4-auth-user.mjs` ahora acepta `expected-role` opcional para que el smoke Auth/RLS también falle si el perfil remoto no coincide con el rol esperado
- El subplan de originacion ya quedó cerrado de punta a punta; el siguiente frente del repo ya no es originacion sino validacion manual de Fase 4 y luego `BR-4` para roles/reportes mas amplios
- El smoke real ya valida `login -> profile -> customers -> loans -> installments` con dataset operativo completo bajo RLS y confirma presencia de estados `active`, `delinquent`, `settled`, `overdue`, `pending` y `paid`
- La causa raiz del bloqueo de Auth quedó identificada: un `auth.users` creado por SQL no puede dejar `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change`, `phone`, `phone_change`, `phone_change_token` o `reauthentication_token` en `NULL`
- La causa raiz del bloqueo RLS también quedó cerrada: las policies operativas usan helpers en `private`, por lo que `authenticated` necesita `USAGE` sobre ese esquema y `EXECUTE` explicito sobre `private.current_app_role()`, `private.is_admin()` y `private.can_access_collector(uuid)`
- `supabase db query --linked --file supabase/seeds/phase4_landing_smoke.sql` ya pasó otra vez para validar idempotencia y reinicio de cartera operativa
- `supabase db lint --linked --level warning` volvió a pasar despues de la migracion correctiva
- Security Advisor ahora deja un `INFO` por la tabla demo cuarentenada y un `WARN` de Auth porque `Leaked Password Protection` sigue deshabilitado; Performance Advisor solo deja `INFO` de índices aún no usados por falta de carga real
- `supabase db push --linked` aplicó `20260506163855_phase1_security_hardening.sql` en `LANDING`
- La primera corrida remota de `supabase/tests/phase1_security_gate.sql` destapó una regresión real: `record_payment()` abría `record_payment_write_context` después del primer `FOR UPDATE`, y bajo RLS endurecido eso terminaba en `loan_not_found`
- `supabase db push --linked` aplicó `20260506171708_phase1_fix_record_payment_write_context_order.sql` en `LANDING`
- La migración correctiva movió la activación del contexto efímero de escritura antes de los locks `FOR UPDATE` para no romper el RPC sin reabrir DML directo por Data API
- La validación remota de Fase 4 sobre `LANDING` destapó otra regresión real: una cuota parcial válida podía fallar con `installment_component_balance_mismatch` si solo existía `outstanding_amount` materializado y no todo el histórico de `payment_applications`
- `supabase db query --linked --file supabase/migrations/20260506184500_fix_record_payment_partial_component_reconstruction.sql` restauró el comportamiento remoto
- `supabase db push --linked` registró `20260506184500_fix_record_payment_partial_component_reconstruction.sql` en el historial remoto de `LANDING`
- La corrección hace que `record_payment()` reconstruya `fee`, `interest` y `principal` pendientes desde `outstanding_amount` usando el orden contractual `fee -> interest -> principal`, alineando backend, bootstrap y frontend
- `supabase migration list --linked` ya muestra nueve migraciones alineadas entre local y remoto
- `supabase/tests/phase1_security_gate.sql` ya pasó contra `LANDING` con `ROLLBACK`
- `supabase/tests/phase2_record_payment_gate.sql` volvió a pasar contra `LANDING` con `ROLLBACK` después del hardening y la corrección
- `supabase db advisors --linked` ahora deja solo un `WARN` de Auth por `Leaked Password Protection`; no deja `WARN` o `ERROR` nuevos del dominio operativo
- La Fase 2 ya tiene documento canónico base en `docs/financial-contract-v1.md`
- `npm run test:phase4` ahora también ejecuta `collector-route-board.test.ts` y `collector-operational-flow.test.ts`, alineando la compuerta con el tablero de control de Fase 4
- `collector-operational-flow.test.ts` ya recorre `bootstrap -> ruta -> gestion local -> cobro oldest-first -> cola -> sync` con datos de clientes, prestamos y cuotas realistas
- `collector-route-board.test.ts` ya cubre una cartera simulada grande de 1200 casos para validar orden operativo y carga base sin degradación local notable
- `scripts/phase4-mobile-smoke.mjs` ya valida `login -> menú móvil -> cobro offline -> cola local -> resync online` contra `LANDING` en viewport móvil headless
- Ese smoke móvil volvió a pasar con el usuario semilla después de la corrección del RPC, ahora con `portfolioCount=4`, `customer="Brayan Rojas"` y cola offline drenada al volver online
- La verificación directa del caso que fallaba en remoto ya devolvió `paymentId` válido para una cuota parcial vencida de `Brayan Rojas`
- `scripts/test-perf.mjs` ya deja una compuerta local de `BR-1` para ruta grande + build + presupuesto de bundle inicial
- `npm run test:perf` quedó como paso previo obligatorio antes de la validación manual en dispositivo real
- `src/lib/runtime/operational-runtime.ts` ahora concentra Dexie, Supabase y sync detrás de un corte de importación dinámica para bajar el JS crítico del primer render
- El baseline actual de `npm run test:perf` quedó en `javascript entry = 372550 raw / 116415 gzip`, `css entry = 23707 raw / 5068 gzip`, `entry total = 396257 raw / 121483 gzip`, `operational runtime async = 207610 raw / 53530 gzip`
- El rerun mas reciente de `npm run test:perf` tambien ya quedó verde despues del split diferido de paneles administrativos y del recorte de constantes financieras del entry shell: `index chunk = 347525 raw / 105496 gzip`, `javascript entry = 383345 raw / 119733 gzip`, `css entry = 26782 raw / 5592 gzip`, `entry total = 410127 raw / 125325 gzip`, `operational runtime async = 214150 raw / 54340 gzip`
- `supabase/migrations/20260507034341_phase5_authoritative_payment_receipts.sql` ya quedó aplicado en `LANDING`; `public.get_payment_receipt()` devuelve el comprobante confirmado por `remotePaymentId` bajo `SECURITY INVOKER`, RLS existente y bloqueo por perfil inactivo
- `supabase/tests/phase5_receipt_gate.sql` ya pasó por MCP con `ROLLBACK`, validando lectura propia por collector, denegación fuera de alcance, acceso `admin` y bloqueo de operador inactivo
- `supabase/migrations/20260507041614_phase5_operational_reports_and_role_guards.sql` ya quedó aplicada en `LANDING`; `public.get_operational_report()` devuelve métricas operativas bajo `SECURITY INVOKER`, con filtros controlados y denegación para `collector`
- `supabase/tests/phase5_roles_gate.sql` y `supabase/tests/phase5_reports_gate.sql` ya pasaron por MCP con `ROLLBACK`, validando `admin` permitido, `collector` denegado e inactivos bloqueados
- `supabase/migrations/20260507050206_phase6_reverse_payment_rpc_and_reversal_tracing.sql`, `20260507053412_phase6_cover_reversal_fk_index.sql` y `20260507054218_phase6_fix_receipt_comment_typo.sql` ya quedaron aplicadas en `LANDING`
- `public.reverse_payment()` ya expone el contrato base de `BR-5`: admin-only, motivo obligatorio, restauración de saldos desde `payment_applications`, idempotencia por estado remoto y evento `payment_reversed`
- `supabase/tests/phase6_reverse_payment_gate.sql` ya pasó por MCP con `ROLLBACK`, validando reverso válido, idempotencia, denegación por rol, bloqueo de admin inactivo y rechazo de pago inexistente
- `node scripts/phase6-reversal-concurrency-smoke.mjs fase7.admin@cobrodiario.dev 123456 fase4.collector@cobrodiario.dev 123456` ya pasó contra `LANDING` con `concurrentCalls=2`, `eventCount=1` y cuota restaurada
- `supabase db advisors --linked` ya no deja lints de performance del dominio operativo después del índice `payments_reversed_by_idx`; el único `WARN` activo sigue siendo `auth_leaked_password_protection`
- `docs/financial-contract-v2.md` ya abrió el contrato local de `BR-6` con dos pilares versionados: `compound_fixed_installment` y abonos dirigidos `principal_only` / `interest_only`
- `src/lib/finance/compound-interest.ts`, `src/lib/finance/payment-contract-v2.ts` y `src/lib/finance/payment-planning-v2.ts` ya tienen tests unitarios dedicados en `LANDING` local, pero no se han activado todavía en RPC ni UI porque el backend remoto V1 no persiste saldo pendiente por componente como fuente de verdad
- `npm run test:financial-v2` ya queda como compuerta local del contrato V2 antes de tocar SQL o shell operativa
- `src/lib/receipts/` ya concentra `receipt-mapper`, `receipt-status`, `receipt-transport`, `receipt-panel` y la decisión explícita de Bluetooth; `npm run test:phase5`, `npm run check` y `npm run test:perf` quedaron verdes después de este corte
- `src/lib/auth/role-guards.ts` ya fija las capacidades visibles del shell y evita repartir comparaciones directas de rol por la UI
- `src/lib/reports/report-panel.tsx` ya expone un panel mobile-first diferido para `admin`, con filtros por cobrador/ruta/estado y una tarjeta explícita de salud de sync local del dispositivo
- El warning anterior de Vite por chunk principal > `500 kB` ya no aparece en el build actual
- El seed playground destapó y cerró una integración real de Auth: cada usuario SQL de pruebas necesita un `auth.users.phone` estable y único; ya quedó corregido para que smoke y playground coexistan sin chocar con `users_phone_key`
- `npm run db:playground:reset` ya pasó contra `LANDING`
- El playground remoto ya validó cartera editable real con `status` inicial: `5` clientes, `5` prestamos, `1` moroso, `1` liquidado y `505000.00` COP pendientes
- `npm run playground -- pay fase4.playground@cobrodiario.dev 123456 PG-JUL-001 15` ya registró un pago real sobre una cuota parcial sin historico, confirmando aplicacion exclusiva a capital pendiente
- `npm run playground -- settle fase4.playground@cobrodiario.dev 123456 PG-KAR-001` ya liquidó un prestamo de una sola cuota y lo dejó `settled` en remoto
- `scripts/phase4-mobile-smoke.mjs` tambien ya pasó con la cuenta playground, con `portfolioCount=5`, `customer="Julián Mora"` y cola offline drenada al volver online
- La lectura final de `PG-JUL-001` dejó la primera cuota en `paid`, la segunda aun `overdue` y el saldo remoto total del prestamo en `120000.00`
- En ese momento la Fase 4 seguía activa en el tablero maestro; después, el gate manual quedó diferido por decisión de producto y la fase pasó a considerarse cerrada para el alcance activo
- En ese momento Fase 5 seguía bloqueada por Fase 4; después del cambio de criterio quedó habilitada y conserva adelantados `docs/deployment-runbook.md` y `docs/release-checklist.md`
- La Fase 1 volvió a quedar cerrada el `2026-05-06`: hardening remoto aplicado, compuerta negativa de seguridad aprobada y `record_payment` revalidado contra la base endurecida
- `docs/database-control.md` quedó como control complementario específico para base de datos, seguridad y ACID

### Tabla demo heredada

- Sigue existiendo `public."TABLA DE USUARIOS DEMO"` con 2 filas
- No pertenece al dominio operativo de `Cobro Diario`
- Ya se aplicó la migración `20260505135552_quarantine_demo_table_access.sql`
- La inserción pública fue removida, `anon`/`authenticated` quedaron revocados y `phase4_cover_fk_indexes_and_demo_rls` dejó una policy explícita de cuarentena
- Security Advisor ya no deja `INFO` por esa tabla

## Lo más importante para la próxima sesión

- No generar nuevos enlaces OAuth de Supabase por inercia.
- El problema de recarga de sesión del MCP ya no bloquea trabajo sobre `LANDING`, pero igual conviene verificarlo al reingresar.
- No asumir que `LANDING` está vacío: la fundacional ya vive en remoto.
- Si el login rompe con `Database error querying schema`, revisar primero el shape del usuario en `auth.users` antes de tocar OAuth o RLS.
- Si una lectura autenticada falla con `permission denied for schema private`, revisar grants de esquema/funcion para los helpers privados antes de relajar policies.
- No borrar la tabla demo heredada sin una decisión explícita; ya quedó cuarentenada, no falta reabrir seguridad.
- La siguiente tarea razonable ya no es endurecer la base remota ni abrir otra vez `BR-4`: Fase 1 sigue cerrada y `BR-4` ya quedó resuelto en su contrato base con evidencia remota real; tras el cambio de criterio del `2026-05-07`, el siguiente frente ya no es validación manual sino Fase 5 u operación posterior.
- El subplan de originación ya quedó cerrado de punta a punta: `OR-1`, `OR-2`, `OR-4` y `OR-5` ya tienen evidencia remota real, y `OR-3` ya quedó cerrado localmente.
- Esta recomendación quedó superada por el cambio de criterio del `2026-05-07`: la validación manual de Fase 4 pasó a estado diferido y ya no impide tratar la fase como cerrada para el alcance activo.
- Si aun así se decide seguir implementando producto sin cerrar ese gate manual, el siguiente corte de código del subplan ya no es `BR-5`: `BR-5` quedó cerrado en su contrato base y el siguiente frente funcional es `BR-6`.
- Si el bundle inicial crece o cambia su composición, revalidar `npm run test:perf` antes de seguir con BR-1; no subir el presupuesto por inercia.
- La siguiente tarea de producto en UI debe preservar `customers.route_label` como fuente remota vigente del tablero mientras no exista una entidad dedicada de rutas; no volver a una lista plana ni a derivar todo solo desde `neighborhood` sin una decision explicita.
- La siguiente tarea de UX debe respetar el menu hamburguesa movil y la hoja de operaciones; no reintroducir una columna larga ni esconder funciones criticas detras de un acceso dificil de descubrir.
- La siguiente tarea de UX tampoco debe volver a ocultar el header movil detras de `dbReady`, `authReady` o `sessionUserId`; el arranque del telefono ya depende de ver navegacion desde el primer render.
- La siguiente iteracion de UI debe respetar tambien el menu operativo; no volver a apilar cobro, gestion, recibo y cola en un solo panel visible.
- La siguiente iteracion de estilos no debe reintroducir layout desktop-first con parches `max-width`; la base movil ya es regla del repo y del CSS actual.
- GPS queda diferido por decisión de producto y no debe tratarse como bloqueo activo de esta línea mientras esa decisión siga vigente.
- No volver a cerrar `localDb` desde el cleanup del montaje raiz salvo que exista un reemplazo real del singleton; en desarrollo eso reintroduce `Database has been closed`.
- La gestión de visita ya quedó aplicada y revalidada en `LANDING`; la siguiente tarea puede construir sobre `collection_actions` + `record_collection_action()` sin reabrir el contrato base de `BR-2`.
- Los referentes de producto ya quedaron fijados en `docs/reference-benchmarks.md`; revisarlos antes de recortar GPS, rutas, impresión o flexibilidad financiera.
- `docs/implementation-plan.md` ya funciona como tablero maestro de fases, checklist y tests de compuerta. No avanzar de fase sin tachar tareas y pasar esos gates.
- El siguiente trabajo debe mantener alineados `docs/financial-contract-v1.md`, `docs/offline-sync.md`, `docs/operational-ui.md`, `payment-contract.ts`, `payment-planning.ts`, `payment-sync.ts`, `record_payment` y `supabase/tests/phase2_record_payment_gate.sql`.
- El siguiente trabajo de base debe mantener alineados `docs/database-control.md`, `docs/implementation-plan.md`, `docs/phase-control.md`, helpers privados de RLS, grants remotos y la compuerta `supabase/tests/phase1_security_gate.sql` cuando cambie cualquier policy o write path crítico.

## Verificación inmediata al reingresar

Ejecutar en este orden:

```bash
codex mcp get supabase
codex mcp list
```

Lo esperado es ver:

- `project_ref=vmlxfbqezgjivesxahfe`
- servidor `supabase` habilitado

Después probar una llamada MCP real al proyecto, por ejemplo:

- `get_project_url`
- `get_publishable_keys`
- `list_tables`

Si el objetivo es continuar implementación:

- ejecutar `docs/phase4-manual-validation.md` en dispositivo real para cerrar Fase 4,
- correr `npm run test:perf` antes de esa validación manual para confirmar presupuesto de bundle y ruta grande,
- confirmar gestion de visita, percepcion tactil y respuesta visual final con uso real,
- o, si se difiere de nuevo ese gate manual, abrir directamente `BR-6` como siguiente fase de código,
- solo despues de eso marcar Fase 4 como completada y pasar a despliegue/operacion.

## Si el MCP sigue pidiendo auth

1. No asumir que el proyecto está mal configurado.
2. Confirmar que `~/.codex/config.toml` sigue apuntando a `vmlxfbqezgjivesxahfe`.
3. Reiniciar Codex nuevamente antes de repetir OAuth.
4. Solo si sigue fallando después de reiniciar, relanzar `codex mcp login supabase`.
5. Si el usuario ya completó la autorización en navegador, no disparar un segundo login en la misma sesión:
   primero hacer una sola verificación del MCP ya autenticado y, si falla por refresh/callback, tratarlo como bloqueo de sesión hasta reiniciar Codex.

## Skills instalados en el proyecto

- `.agents/skills/supabase`
- `.agents/skills/supabase-postgres-best-practices`
- `skills-lock.json` ya registra ambos

## Archivos clave para continuidad

- [AGENTS.md](../AGENTS.md)
- [docs/mcp-setup.md](./mcp-setup.md)
- [docs/implementation-plan.md](./implementation-plan.md)
- [docs/database-control.md](./database-control.md)
- [docs/financial-contract-v1.md](./financial-contract-v1.md)
- [docs/offline-sync.md](./offline-sync.md)
- [docs/operational-ui.md](./operational-ui.md)
- [docs/phase4-manual-validation.md](./phase4-manual-validation.md)
- [docs/deployment-runbook.md](./deployment-runbook.md)
- [docs/release-checklist.md](./release-checklist.md)
- [docs/reference-benchmarks.md](./reference-benchmarks.md)
- [supabase/migrations/20260505063813_foundational_schema.sql](../supabase/migrations/20260505063813_foundational_schema.sql)
- [supabase/migrations/20260505135552_quarantine_demo_table_access.sql](../supabase/migrations/20260505135552_quarantine_demo_table_access.sql)
- [supabase/migrations/20260505135842_harden_function_search_path_and_fk_indexes.sql](../supabase/migrations/20260505135842_harden_function_search_path_and_fk_indexes.sql)
- [supabase/migrations/20260505141438_tighten_record_payment_contract.sql](../supabase/migrations/20260505141438_tighten_record_payment_contract.sql)
- [supabase/migrations/20260505145152_finalize_payment_allocation_v1.sql](../supabase/migrations/20260505145152_finalize_payment_allocation_v1.sql)
- [supabase/migrations/20260505172157_grant_private_schema_usage_for_rls_helpers.sql](../supabase/migrations/20260505172157_grant_private_schema_usage_for_rls_helpers.sql)
- [supabase/migrations/20260506163855_phase1_security_hardening.sql](../supabase/migrations/20260506163855_phase1_security_hardening.sql)
- [supabase/migrations/20260506171708_phase1_fix_record_payment_write_context_order.sql](../supabase/migrations/20260506171708_phase1_fix_record_payment_write_context_order.sql)
- [supabase/tests/phase1_security_gate.sql](../supabase/tests/phase1_security_gate.sql)
- [supabase/seeds/phase4_landing_smoke.sql](../supabase/seeds/phase4_landing_smoke.sql)
- [supabase/tests/phase2_record_payment_gate.sql](../supabase/tests/phase2_record_payment_gate.sql)
- [scripts/phase4-auth-user.mjs](../scripts/phase4-auth-user.mjs)
- [scripts/phase4-mobile-smoke.mjs](../scripts/phase4-mobile-smoke.mjs)
- [src/lib/finance/payment-contract.ts](../src/lib/finance/payment-contract.ts)
- [src/lib/finance/payment-planning.ts](../src/lib/finance/payment-planning.ts)
- [src/lib/collector/collector-workspace.ts](../src/lib/collector/collector-workspace.ts)
- [src/lib/sync/payment-sync.ts](../src/lib/sync/payment-sync.ts)
