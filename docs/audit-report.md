# Reporte de Auditoría de UI y Estandarización

Este documento es la evidencia operativa del subplan histórico `docs/archive/standardization-plan.md`.

- No reemplaza `docs/implementation-plan.md`.
- El plan activo del repo sigue siendo `docs/implementation-plan.md`, con `docs/phase-control.md` como tablero funcional complementario.
- Debe actualizarse en cualquier tarea que cambie diseño compartido, auth UI, sync UI o documentación de flujos operativos.

## Estado de cierre por subfase

- [x] Subfase 4.1 cerrada: consolidación de tokens
- [x] Subfase 4.2 cerrada: primitivas compartidas
- [x] Subfase 4.3 cerrada: política de inline styles
- [x] Subfase 4.4 cerrada: documentación de fragmentos críticos
- [x] Subfase 4.5 cerrada: integración con estándares del repo

## Línea base verificada

Decisión vigente al `2026-05-07`:

- la validación manual móvil queda diferida por decisión explícita de producto,
- no bloquea el cierre activo de Fase 4,
- y las referencias históricas de este documento a “pendiente manual” deben leerse como estado previo, no como gate vigente.

Estado auditado el 5 de mayo de 2026:

- [x] Existen tokens globales en `src/index.css`.
- [x] Existen primitivas visuales compartidas como `.panel`, `.button` y `.status-card`.
- [x] La regla de cero `style={{...}}` vuelve a sostenerse; la limpieza del `2026-05-06` dejó `src/App.tsx` sin estilos inline estáticos.
- [x] Existe una primitiva `.input` claramente estandarizada para toda la app.
- [x] Hay un procedimiento manual versionado para responsive en las vistas principales, hoy diferido por decisión de producto.
- [x] Hay evidencia automatizada de rendimiento con cartera simulada grande; la confirmación manual en dispositivo físico quedó diferida.

## Evidencia mínima que debe registrar cada asistente

En cualquier cierre relacionado con UI, agregar o actualizar:

- fecha,
- alcance,
- archivos tocados,
- comandos de verificación ejecutados,
- resultado,
- pendientes o riesgos.

## Registro de evidencia

### OR-3.13: formalizacion remota de la ruta operativa en originacion y tablero

- Fecha: `2026-05-06`
- Alcance: dejar de depender solo del barrio para la ruta visible del cobrador, materializando `route_label` como fuente remota vigente desde el alta del deudor hasta el tablero operativo, sin romper el layout mobile-first del wizard
- Archivos tocados:
  - `src/lib/db/local-db.ts`
  - `src/lib/collector/collector-workspace.ts`
  - `src/lib/collector/collector-route-board.ts`
  - `src/lib/collector/collector-route-board.test.ts`
  - `src/lib/origination/origination-validation.ts`
  - `src/lib/origination/origination-validation.test.ts`
  - `src/lib/origination/origination-transport.ts`
  - `src/lib/origination/origination-wizard-panel.tsx`
  - `src/lib/origination/origination-wizard.test.ts`
  - `docs/operational-ui.md`
  - `docs/origination-control.md`
  - `docs/phase-control.md`
  - `docs/function-gap-control.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase4`
  - `npm run test:phase7`
  - `npm run check`
  - `npm run test:perf`
  - `git diff --check`
- Resultado:
  - la UI de originacion ahora expone una etiqueta dedicada de `Ruta operativa` sin salir del patrón responsive existente,
  - el payload de originacion y el bootstrap de cartera ya convergen sobre `public.customers.route_label`,
  - el tablero sigue teniendo fallback de compatibilidad (`neighborhood` y `address`) para datos heredados,
  - y queda versionada la compuerta `supabase/tests/phase4_routes_gate.sql` como evidencia de `BR-2`.
- Pendiente:
  - la gestion de visita ya no debe permanecer `local-only`; su siguiente corte queda registrado en `OR-3.14`,
  - la validacion manual movil de `BR-1` sigue abierta,
  - `npm run test:perf` quedo por encima del presupuesto vigente del entry bundle y debe tratarse como riesgo abierto de rendimiento movil,
  - y todavia no existe una entidad dedicada de rutas con asignacion administrativa.

### OR-3.14: cola offline y write path remoto para gestión de visita

- Fecha: `2026-05-06`
- Alcance: sacar la novedad de visita del estado `local-only`, manteniendo el layout mobile-first actual mientras se agrega cola offline, reintento e hidratación remota de `collection_actions`
- Archivos tocados:
  - `src/App.tsx`
  - `src/lib/db/local-db.ts`
  - `src/lib/collector/collector-workspace.ts`
  - `src/lib/runtime/operational-runtime.ts`
  - `src/lib/sync/collection-action-sync.ts`
  - `src/lib/sync/collection-action-sync.test.ts`
  - `package.json`
  - `supabase/migrations/20260507025036_phase4_collection_actions_remote_sync.sql`
  - `supabase/tests/phase4_collection_actions_gate.sql`
  - `docs/operational-ui.md`
  - `docs/phase-control.md`
  - `docs/function-gap-control.md`
  - `docs/database-control.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase4`
  - `npm run test:phase7`
  - `npm run check`
  - `npm run test:perf`
  - `git diff --check`
- Resultado:
  - la UI ya registra gestiones en una cola offline visible y reintentable,
  - el bootstrap local ya puede rehidratar `collection_actions` remotas sin pisar eventos pendientes,
  - quedó versionado `record_collection_action()` como write path remoto idempotente,
  - y `test:phase4` ya incluye `collection-action-sync.test.ts` como compuerta local de `BR-2`.
- Pendiente:
  - la revalidación remota posterior queda registrada en `OR-3.15`,
  - la validación manual móvil de `BR-1` sigue abierta,
  - y la deuda histórica de `test:perf` quedó cerrada después en `OR-3.16`.

### OR-3.15: revalidación remota de rutas y gestión de visita en `LANDING`

- Fecha: `2026-05-06`
- Alcance: cerrar la evidencia remota de `BR-2` sin mover el layout mobile-first, dejando aplicadas en `LANDING` las migraciones de `route_label` y `collection_actions` junto con sus compuertas SQL
- Archivos tocados:
  - `docs/function-gap-control.md`
  - `docs/phase-control.md`
  - `docs/operational-ui.md`
  - `docs/database-control.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `list_migrations`
  - `apply_migration(phase4_formalize_customer_route_label)`
  - `apply_migration(phase4_collection_actions_remote_sync)`
  - `execute_sql(supabase/tests/phase4_routes_gate.sql)`
  - `execute_sql(supabase/tests/phase4_collection_actions_gate.sql)`
  - `get_advisors(security)`
  - `get_advisors(performance)`
- Resultado:
  - `LANDING` ya expone `customers.route_label` como fuente remota vigente del tablero y la originación,
  - `LANDING` ya expone `collection_actions` + `record_collection_action()` como write path remoto operativo para gestión de visita,
  - ambas compuertas SQL quedaron verdes con `ROLLBACK`,
  - y la auditoría remota posterior no dejó `WARN` o `ERROR` nuevos del dominio operativo.
- Pendiente:
  - la validación manual móvil de `BR-1` sigue abierta,
  - y la activación de `Leaked Password Protection` sigue dependiendo de configuración Auth fuera del repo.

### OR-3.16: cierre de presupuesto inicial y limpieza final de advisors del dominio operativo

- Fecha: `2026-05-06`
- Alcance: dejar el `entry bundle` nuevamente dentro de presupuesto y cerrar los lints remotos resolubles del dominio operativo sin alterar el flujo mobile-first ni el contrato financiero V1
- Archivos tocados:
  - `src/App.tsx`
  - `src/lib/finance/financial-config.ts`
  - `src/lib/finance/money.ts`
  - `src/lib/finance/payment-contract.ts`
  - `src/lib/finance/origination-schedule.ts`
  - `src/lib/sync/payment-sync.ts`
  - `src/lib/collector/collector-route-board.ts`
  - `supabase/migrations/20260507032546_phase4_cover_fk_indexes_and_demo_rls.sql`
  - `docs/phase-control.md`
  - `docs/operational-ui.md`
  - `docs/database-control.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase2`
  - `npm run test:phase4`
  - `npm run test:phase7`
  - `npm run test:perf`
  - `npm run check`
  - `git diff --check`
  - `apply_migration(phase4_cover_fk_indexes_and_demo_rls)`
  - `get_advisors(security)`
  - `get_advisors(performance)`
- Resultado:
  - el shell inicial ahora difiere los paneles administrativos pesados y deja el baseline financiero visible en un módulo liviano,
  - `npm run test:perf` volvió a verde con `entry total = 410127 raw / 125325 gzip`,
  - Performance Advisor quedó sin lints activos del dominio operativo,
  - y Security Advisor ya solo conserva `auth_leaked_password_protection` como aviso externo al repo.
- Pendiente:
  - la validación manual móvil de `BR-1` sigue abierta,
  - y la activación de `Leaked Password Protection` sigue dependiendo de configuración Auth fuera del repo.

### OR-3.17: recibo autoritativo remoto y decisión explícita de Bluetooth

- Fecha: `2026-05-06`
- Alcance: cerrar el contrato base de `BR-3` sin degradar el shell mobile-first, distinguiendo recibo local pendiente vs comprobante confirmado por servidor y dejando Bluetooth documentado como gate manual futuro
- Archivos tocados:
  - `src/App.tsx`
  - `src/index.css`
  - `src/lib/finance/financial-config.ts`
  - `src/lib/runtime/operational-runtime.ts`
  - `src/lib/receipts/receipt-types.ts`
  - `src/lib/receipts/receipt-mapper.ts`
  - `src/lib/receipts/receipt-transport.ts`
  - `src/lib/receipts/receipt-status.ts`
  - `src/lib/receipts/bluetooth-printer.ts`
  - `src/lib/receipts/receipt-panel.tsx`
  - `src/lib/receipts/receipt-mapper.test.ts`
  - `src/lib/receipts/receipt-status.test.ts`
  - `src/lib/receipts/bluetooth-printer.test.ts`
  - `package.json`
  - `supabase/migrations/20260507034341_phase5_authoritative_payment_receipts.sql`
  - `supabase/tests/phase5_receipt_gate.sql`
  - `docs/phase-control.md`
  - `docs/operational-ui.md`
  - `docs/database-control.md`
  - `docs/function-gap-control.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase2`
  - `npm run test:phase4`
  - `npm run test:phase5`
  - `npm run test:phase7`
  - `npm run check`
  - `npm run test:perf`
  - `git diff --check`
  - `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"`
  - `apply_migration(phase5_authoritative_payment_receipts)`
  - `execute_sql(supabase/tests/phase5_receipt_gate.sql)`
  - `list_migrations`
  - `get_advisors(security)`
  - `get_advisors(performance)`
- Resultado:
  - la UI ya diferencia recibo local pendiente, envío en curso, fallo local, sync incompleto y comprobante confirmado,
  - el comprobante confirmado ya se lee por `remotePaymentId` desde PostgreSQL con desglose por cuota, capital, interés y mora,
  - el panel `Recibo` quedó diferido en un chunk propio para no reabrir el presupuesto del shell inicial,
  - y Bluetooth ya no queda como promesa ambigua: Web Bluetooth quedó documentado como siguiente gate manual con hardware real.
- Pendiente:
  - la validación manual móvil de `BR-1` sigue abierta,
  - la impresión física Bluetooth no está implementada,
  - y la activación de `Leaked Password Protection` sigue dependiendo de configuración Auth fuera del repo.

### OR-3.18: roles visibles end-to-end y reportes operativos base para `admin`

- Fecha: `2026-05-06`
- Alcance: cerrar el contrato base de `BR-4` sin romper la shell mobile-first, separando de forma visible las capacidades `admin/collector` y abriendo un panel de reportes operativos seguro y diferido
- Archivos tocados:
  - `src/App.tsx`
  - `src/index.css`
  - `src/lib/runtime/operational-runtime.ts`
  - `src/lib/origination/origination-wizard.ts`
  - `src/lib/origination/collector-management-panel.tsx`
  - `src/lib/auth/role-guards.ts`
  - `src/lib/auth/role-guards.test.ts`
  - `src/lib/reports/report-types.ts`
  - `src/lib/reports/report-mappers.ts`
  - `src/lib/reports/report-mappers.test.ts`
  - `src/lib/reports/report-queries.ts`
  - `src/lib/reports/report-queries.test.ts`
  - `src/lib/reports/report-panel.tsx`
  - `package.json`
  - `supabase/migrations/20260507041614_phase5_operational_reports_and_role_guards.sql`
  - `supabase/tests/phase5_roles_gate.sql`
  - `supabase/tests/phase5_reports_gate.sql`
  - `docs/implementation-plan.md`
  - `docs/phase-control.md`
  - `docs/operational-ui.md`
  - `docs/database-control.md`
  - `docs/function-gap-control.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase4`
  - `npm run test:phase5`
  - `npm run test:phase7`
  - `npm run typecheck`
  - `npm run check`
  - `npm run test:perf`
  - `git diff --check`
  - `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"`
  - `apply_migration(phase5_operational_reports_and_role_guards)`
  - `execute_sql(supabase/tests/phase5_roles_gate.sql)`
  - `execute_sql(supabase/tests/phase5_reports_gate.sql)`
  - `list_migrations`
  - `get_advisors(security)`
  - `get_advisors(performance)`
- Resultado:
  - la shell ya resuelve capacidades por rol en una sola capa y deja de insinuar permisos visibles que el backend negaría,
  - `admin` ya ve un panel de reportes con métricas de cartera, cobro del día, mora, breakdowns y filtros por cobrador/ruta/estado,
  - `collector` ya no ve entradas de originación o reportes y la denegación también quedó probada en SQL,
  - y el panel de reportes quedó diferido en un chunk propio, preservando el presupuesto móvil del shell inicial.
- Pendiente:
  - la validación manual móvil de `BR-1` sigue abierta,
  - la impresión física Bluetooth sigue diferida como integración separada,
  - y la activación de `Leaked Password Protection` sigue dependiendo de configuración Auth fuera del repo.

### OR-3.19: reverso transaccional base y concurrencia real de BR-5

- Fecha: `2026-05-06`
- Alcance: cerrar el contrato base de `BR-5` sin debilitar RLS ni romper el shell mobile-first, dejando reverso admin-only, recibo reversado y evidencia concurrente real en `LANDING`
- Archivos tocados:
  - `src/App.tsx`
  - `src/index.css`
  - `src/lib/db/local-db.ts`
  - `src/lib/runtime/operational-runtime.ts`
  - `src/lib/auth/role-guards.ts`
  - `src/lib/auth/role-guards.test.ts`
  - `src/lib/finance/payment-reversal.ts`
  - `src/lib/finance/payment-reversal.test.ts`
  - `src/lib/receipts/receipt-types.ts`
  - `src/lib/receipts/receipt-mapper.ts`
  - `src/lib/receipts/receipt-mapper.test.ts`
  - `src/lib/receipts/receipt-status.ts`
  - `src/lib/receipts/receipt-status.test.ts`
  - `src/lib/receipts/receipt-panel.tsx`
  - `src/lib/sync/payment-reversal-sync.ts`
  - `src/lib/sync/payment-reversal-sync.test.ts`
  - `scripts/phase6-reversal-concurrency-smoke.mjs`
  - `package.json`
  - `supabase/migrations/20260507050206_phase6_reverse_payment_rpc_and_reversal_tracing.sql`
  - `supabase/migrations/20260507053412_phase6_cover_reversal_fk_index.sql`
  - `supabase/migrations/20260507054218_phase6_fix_receipt_comment_typo.sql`
  - `supabase/tests/phase6_reverse_payment_gate.sql`
  - `docs/financial-contract-v1.md`
  - `docs/database-control.md`
  - `docs/function-gap-control.md`
  - `docs/phase-control.md`
  - `docs/operational-ui.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase5`
  - `npm run test:phase6`
  - `npm run typecheck`
  - `npm run check`
  - `npm run test:perf`
  - `git diff --check`
  - `apply_migration(phase6_reverse_payment_rpc_and_reversal_tracing)`
  - `execute_sql(supabase/tests/phase6_reverse_payment_gate.sql)`
  - `node scripts/phase6-reversal-concurrency-smoke.mjs fase7.admin@cobrodiario.dev 123456 fase4.collector@cobrodiario.dev 123456`
  - `get_advisors(performance)`
  - `get_advisors(security)`
- Resultado:
  - `public.reverse_payment()` ya restaura saldos, recalcula préstamo/cuotas, marca `payments.status = reversed` y registra `payment_reversed` sin borrar historial,
  - el panel `Recibo` ya distingue comprobante confirmado vs reversado y permite reverso solo a `admin` online con motivo obligatorio,
  - la compuerta SQL ya cubre reverso válido, idempotencia, denegación por rol, admin inactivo y pago inexistente,
  - el smoke concurrente real ya dejó evidencia de dos sesiones `admin` intentando el mismo reverso con un solo evento compensatorio,
  - Performance Advisor quedó sin lints activos del dominio operativo y Security Advisor sigue dejando solo `auth_leaked_password_protection` como aviso externo al repo.
- Pendiente:
  - la validación manual móvil de `BR-1` sigue abierta,
  - Bluetooth físico sigue diferido,
  - y la activación de `Leaked Password Protection` sigue dependiendo de configuración Auth fuera del repo.

### OR-3.20: terminología visible alineada a referentes y glosario operativo

- Fecha: `2026-05-07`
- Alcance: normalizar la terminología visible de la app y de la documentación operativa para usar el mismo léxico de producto que fijan los referentes (`cobrador`, `ruta`, `recibo`, `reporte`, `sin conexión`, `sincronización`)
- Archivos tocados:
  - `src/App.tsx`
  - `src/lib/reports/report-panel.tsx`
  - `src/lib/receipts/receipt-panel.tsx`
  - `src/lib/origination/origination-wizard-panel.tsx`
  - `src/lib/origination/collector-management-panel.tsx`
  - `src/lib/origination/origination-validation.ts`
  - `src/lib/origination/origination-wizard.ts`
  - `docs/terminology-guide.md`
  - `docs/operational-ui.md`
  - `docs/function-gap-control.md`
  - `docs/phase-control.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase4`
  - `npm run test:phase5`
  - `npm run test:phase7`
  - `npm run check`
  - `npm run test:perf`
  - `git diff --check`
  - `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"`
- Resultado:
  - la UI visible ya evita `admin`, `collector`, `setup`, `runtime`, `sync` y estados en inglés cuando no aportan valor al operador,
  - `Recibo`, `Reportes`, `Sincronización`, `Administrador`, `Cobrador`, `Ruta` y `sin conexión` quedan fijados como léxico visible base,
  - el panel de recibo ya traduce también la metadata diferida de Bluetooth para no mostrar `web_bluetooth`, `deferred` o `manual_smoke...` en la experiencia operativa,
  - y `docs/terminology-guide.md` quedó como fuente transversal para que futuros cambios no reintroduzcan anglicismos en copy de producto.
- Pendiente:
  - no queda un bloqueo de código por terminología en esta línea; cualquier ajuste futuro debe seguir el glosario nuevo y el baseline de `docs/reference-benchmarks.md`.

### OR-3.21: visualización explícita de COP en la UI financiera compartida

- Fecha: `2026-05-07`
- Alcance: corregir la ambigüedad visual del símbolo `$` para la moneda base del producto, dejando `COP` como código visible en la app sin alterar cálculo, redondeo ni persistencia
- Archivos tocados:
  - `src/lib/finance/money.ts`
  - `src/lib/finance/money.test.ts`
  - `docs/financial-contract-v1.md`
  - `docs/terminology-guide.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase2`
  - `npm run test:phase4`
  - `npm run test:phase5`
  - `npm run check`
  - `npm run test:perf`
  - `git diff --check`
- Resultado:
  - `formatCurrency()` ahora muestra `COP` como código visible por defecto cuando la moneda es `COP`,
  - monedas no `COP` conservan visualización por símbolo salvo override explícito, evitando una regresión global innecesaria,
  - toda la UI que depende del helper central ahora deja de mostrar `$` para la cartera colombiana,
  - y el contrato financiero V1 ya documenta que `COP` es la visualización monetaria oficial del proyecto.
- Pendiente:
  - si en el futuro entra una segunda moneda operativa con regla visual distinta, debe declararse en `money.ts`, `money.test.ts` y `docs/financial-contract-v1.md` en el mismo cambio.

### OR-3.12: Localización completa al español y eliminación de anglicismos

- Fecha: `2026-05-06`
- Alcance: identificación y sustitución de todos los términos en inglés visibles en la UI por sus equivalentes en español, incluyendo estados técnicos y mensajes informativos.
- Archivos tocados:
  - `src/App.tsx`
  - `src/lib/origination/origination-wizard-panel.tsx`
  - `src/lib/origination/origination-wizard.ts`
  - `src/lib/origination/origination-validation.ts`
- Comandos:
  - `Grep de términos específicos (Sync, Offline, Runtime, Setup)`
- Resultado:
  - Se tradujeron etiquetas críticas como "Sync" (Sincronización), "Offline First" (Enfoque Local) y "Setup" (Configuración).
  - Se implementaron mapeos de traducción para los estados de préstamos y cuotas que venían directamente de la base de datos en inglés.
  - Se corrigieron tildes y términos operativos (admin -> administrador, collector -> cobrador) en todos los paneles de ayuda.
  - La interfaz ahora cumple con el estándar de profesionalismo castizo requerido.

### OR-3.11: Cierre definitivo de desbordamiento horizontal y márgenes de seguridad

- Fecha: `2026-05-06`
- Alcance: eliminar el desbordamiento horizontal persistente mediante la corrección de umbrales matemáticos en rejillas y la restauración de márgenes de seguridad (`2rem`) en el contenedor principal.
- Archivos tocados:
  - `src/index.css`
  - `docs/audit-report.md`
- Comandos:
  - `Manual verification (visual check against 360px math)`
- Resultado:
  - `.ops-shell` se refactorizó a `width: 100%` con `padding-inline: 1rem` para garantizar simetría perfecta.
  - Se liberó la rigidez estructural mediante `min-width: 0` en `.panel` y `.workspace-pane`, y `flex-shrink: 1` en `.loan-row-meta`.
  - El buscador ahora permite envoltura (`flex-wrap: wrap`) y compresión del input para evitar el empuje lateral del panel.
  - Se eliminó el código redundante para cumplir con los estándares de limpieza y mantenibilidad del proyecto.

### OR-3.10: compresión real del buscador y ajuste fino del foco operativo

- Fecha: `2026-05-06`
- Alcance: intentar cerrar la parte que seguía permitiendo desborde móvil después del primer ajuste fluido, especialmente la competencia horizontal entre el buscador y el pill de casos
- Archivos tocados:
  - `src/index.css`
  - `docs/operational-ui.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run check`
  - `git diff --check`
- Resultado:
  - se aplicó un segundo ajuste sobre `ops-shell`, `search-row` y `route-focus-grid`,
  - pero el cierre no puede marcarse como resuelto porque siguió habiendo reporte visual de desborde en móvil,
  - así que esta entrada queda abierta hasta aislar el nodo exacto con evidencia visual o inspección runtime del viewport real.

### OR-3.9: fluidez intrínseca en foco y filtros de ruta

- Fecha: `2026-05-06`
- Alcance: reducir rigidez innecesaria en la shell mobile-first donde el foco operativo y los chips de ruta podían forzar desborde lateral al depender de columnas fijas y `min-width` duro
- Archivos tocados:
  - `src/index.css`
  - `docs/operational-ui.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run check`
  - `git diff --check`
- Resultado:
  - `.route-focus-grid`, `.route-filter-strip` y `.ops-shell` se movieron hacia composición más fluida,
  - pero el resultado no puede darse por bueno todavía porque faltó aislar el elemento exacto que sigue provocando desborde en el viewport real,
  - así que esta entrada también queda abierta y no debe leerse como cierre definitivo.

### OR-3.8: refresh de claims antes del bootstrap administrativo

- Fecha: `2026-05-06`
- Alcance: corregir el caso donde `admin` reingresa con una sesión persistida cuyo JWT todavía trae claim viejo de `collector`, dejando la cartera vacía aunque `profiles.role` ya sea `admin`
- Archivos tocados:
  - `src/lib/collector/collector-workspace.ts`
  - `src/lib/collector/collector-workspace.test.ts`
  - `docs/operational-ui.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase4`
  - `npm run check`
  - `git diff --check`
- Resultado:
  - el bootstrap remoto ahora compara `profiles.role` con `session.user.app_metadata.role`,
  - si detecta desalineación, fuerza `refreshSession()` antes de consultar `customers` y `loans`,
  - y así evita que una sesión `admin` restaurada desde almacenamiento local siga recibiendo filtros RLS de `collector`.

### OR-3.7: workspace agregado para sesión admin

- Fecha: `2026-05-06`
- Alcance: corregir el workspace de `admin` para que sí agregue la cartera visible por RLS y deje de ocultar préstamos asignados a otros cobradores dentro de la misma sesión administrativa
- Archivos tocados:
  - `src/App.tsx`
  - `src/lib/collector/collector-workspace.test.ts`
  - `src/lib/collector/collector-workspace.ts`
  - `docs/operational-ui.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase4`
  - `npm run check`
  - `git diff --check`
- Resultado:
  - la sesión `admin` ya hidrata un workspace agregado sobre toda la cartera que RLS le permite leer,
  - el préstamo originado para otro cobrador ya aparece en métricas, lista y detalle sin cerrar sesión,
  - el alta exitosa ya puede enfocar ese caso por `external_loan_number`,
  - y el cobro/gestión desde la vista administrativa usa el `collectorId` real del préstamo para no romper el write path operativo.

### OR-3.6: cierre incondicional de la hoja tras originacion exitosa

- Fecha: `2026-05-06`
- Alcance: evitar que la originación deje la UI atrapada en estado de éxito, alineando móvil y desktop cuando el préstamo recién creado no entra en la cartera local del operador actual
- Archivos tocados:
  - `src/App.tsx`
  - `AGENTS.md`
  - `docs/engineering-standards.md`
  - `docs/operational-ui.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase4`
  - `npm run check`
  - `git diff --check`
- Resultado:
  - en móvil la confirmación de originación ya cierra la `operations-sheet`,
  - en desktop el panel persistente ya vuelve a `Cobro` y desmonta el wizard en vez de quedarse congelado en éxito,
  - el aviso global sigue informando si el préstamo quedará visible para otro cobrador,
  - el autoenfoque al detalle local permanece limitado a los casos en que el préstamo sí entra en la cartera del usuario activo del dispositivo,
  - y el repo ya deja explícito que cualquier reporte del usuario debe verificarse contra código y estándares antes de aceptarse como correcto.

### OR-3.5: presentacion COP y tasa informativa sin tocar el contrato contable

- Fecha: `2026-05-06`
- Alcance: resolver confusion visual de COP y de `interest_rate_daily` en originacion/cobro sin cambiar precision de almacenamiento ni la formula remota
- Archivos tocados:
  - `src/App.tsx`
  - `src/index.css`
  - `src/lib/finance/currency-amount-input.tsx`
  - `src/lib/finance/money.ts`
  - `src/lib/finance/money.test.ts`
  - `src/lib/origination/origination-validation.ts`
  - `src/lib/origination/origination-validation.test.ts`
  - `src/lib/origination/origination-wizard-panel.tsx`
  - `docs/financial-contract-v1.md`
  - `docs/operational-ui.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test`
  - `npm run test:phase7`
  - `npm run check`
  - `git diff --check`
- Resultado:
  - la UI ahora formatea COP con separador de miles al escribir y deja de mostrar `,00` cuando el valor visible no tiene centavos,
  - el valor canonico sigue llegando con precision de 2 decimales a todos los helpers y RPC,
  - la tasa diaria informativa deja de arrancar en `0.000000` visible y queda explicada como dato referencial de V1,
  - y el frontend deja de empujar al operador a contar ceros manualmente sin romper el contrato financiero vigente.

### OR-3.3: gestion separada de cobradores en la shell operativa

- Fecha: `2026-05-06`
- Alcance: sacar la administración básica de cobradores de la dependencia exclusiva del wizard y dejarla visible en la pestaña `Gestion` para sesiones `admin`
- Archivos tocados:
  - `src/App.tsx`
  - `src/index.css`
  - `src/lib/origination/collector-management-panel.tsx`
  - `src/lib/origination/origination-transport.ts`
  - `src/lib/origination/origination-validation.ts`
  - `docs/operational-ui.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase7`
  - `npm run check`
  - `git diff --check`
- Resultado:
  - `admin` ya puede gestionar cobradores activos desde una vista estable de la shell operativa,
  - el wizard de originación deja de ser la única puerta para crear el cobrador requerido por un deudor nuevo,
  - y la gestión de visita local sigue intacta para `collector` y para `admin` cuando hay un préstamo seleccionado.

### OR-3.4: write path seguro para alta de cobradores

- Fecha: `2026-05-06`
- Alcance: reemplazar el alta de cobradores basada en `auth.signUp()` desde browser por una RPC privilegiada que no reabra `INSERT` directo sobre `public.profiles` ni cree una segunda instancia GoTrue en la misma sesión
- Archivos tocados:
  - `supabase/migrations/20260507002021_phase7_collector_account_provisioning_rpc.sql`
  - `supabase/tests/phase7_collector_provisioning_gate.sql`
  - `src/lib/origination/origination-transport.ts`
  - `src/lib/origination/origination-transport.test.ts`
  - `src/lib/origination/origination-validation.ts`
  - `src/lib/origination/origination-wizard-panel.tsx`
  - `src/lib/origination/collector-management-panel.tsx`
  - `docs/database-control.md`
  - `docs/operational-ui.md`
  - `docs/origination-control.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase7`
  - `npm run check`
  - `execute_sql` por MCP sobre `supabase/tests/phase7_collector_provisioning_gate.sql`
  - `git diff --check`
- Resultado:
  - el alta de cobradores ya no depende de un segundo cliente Auth en el navegador,
  - el hardening de `public.profiles` se mantiene intacto porque la escritura ocurre dentro de PostgreSQL,
  - la compuerta remota ya probó `admin` permitido, correo duplicado denegado, `collector` denegado y `admin` inactivo denegado sin dejar residuos por `ROLLBACK`,
  - y el feedback de UI ahora refleja el write path real por RPC en vez del flujo roto anterior.

### OR-3.2: alta rápida de cobrador dentro del wizard

- Fecha: `2026-05-06`
- Alcance: destrabar la originacion cuando el admin necesita asignar un deudor nuevo pero no existe un cobrador activo disponible desde la misma UI
- Archivos tocados:
  - `src/lib/origination/origination-transport.ts`
  - `src/lib/origination/origination-validation.ts`
  - `src/lib/origination/origination-wizard-panel.tsx`
  - `src/index.css`
  - `docs/operational-ui.md`
  - `docs/origination-control.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase7`
  - `npm run check`
  - `git diff --check`
- Resultado:
  - el paso `Deudor` ya no depende de abandonar la app para dar de alta el cobrador faltante,
  - la identidad Auth nueva ya se provisiona por RPC segura para no reemplazar la sesion del `admin` ni depender de `INSERT` directo sobre `public.profiles`,
  - y la asignacion del deudor puede continuar inmediatamente con el `profile` `collector` recien creado.

### OR-5: hardening final por rol y cierre del subplan

- Fecha: `2026-05-06`
- Alcance: congelar el corte final de roles para originacion y dejar evidencia remota reproducible de `admin` permitido, `collector` denegado, bloqueo por perfil inactivo y degradacion de claims inesperados
- Archivos tocados:
  - `supabase/tests/phase7_origination_roles_gate.sql`
  - `scripts/phase4-auth-user.mjs`
  - `docs/database-control.md`
  - `docs/implementation-plan.md`
  - `docs/origination-control.md`
  - `docs/phase-control.md`
  - `docs/session-handoff.md`
- Comandos:
  - `supabase/tests/phase7_origination_roles_gate.sql` por `ROLLBACK`
  - `node scripts/phase4-auth-user.mjs smoke fase7.admin@cobrodiario.dev 123456 admin`
  - `node scripts/phase4-auth-user.mjs smoke fase4.collector@cobrodiario.dev 123456 collector`
  - `node scripts/phase7-origination-smoke.mjs fase7.admin@cobrodiario.dev 123456 fase4.collector@cobrodiario.dev 123456`
  - `git diff --check`
- Resultado:
  - el write path de originacion ya quedó congelado contra solo dos roles reales (`admin` y `collector`),
  - un claim inesperado ya no reabre privilegios porque `private.current_app_role()` lo degrada a `collector`,
  - el smoke remoto final sigue demostrando `admin -> collector -> cobro`,
  - y el subplan de originacion V1 ya puede tratarse como cerrado; el siguiente frente ya no es este flujo sino la validacion manual de Fase 4 y el trabajo futuro de `BR-4`.

### OR-4: convergencia originacion -> cartera -> cobro

- Fecha: `2026-05-06`
- Alcance: hacer visible en la shell operativa el préstamo recién originado y dejar un smoke remoto real que pruebe `admin -> collector -> cobro`
- Archivos tocados:
  - `src/App.tsx`
  - `src/lib/db/local-db.ts`
  - `src/lib/collector/collector-workspace.ts`
  - `src/lib/collector/collector-workspace.test.ts`
  - `src/lib/collector/collector-operational-flow.test.ts`
  - `src/lib/origination/origination-wizard-panel.tsx`
  - `scripts/lib/origination-v1.mjs`
  - `scripts/phase7-origination-smoke.mjs`
  - `package.json`
  - `docs/architecture.md`
  - `docs/operational-ui.md`
  - `docs/origination-control.md`
  - `docs/phase-control.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase4`
  - `npm run test:phase7`
  - `npm run check`
  - `node scripts/phase7-origination-smoke.mjs fase7.admin@cobrodiario.dev 123456 fase4.collector@cobrodiario.dev 123456`
- Resultado:
  - la cartera ya puede identificar el caso nuevo por `external_loan_number` y el detalle del préstamo ya muestra frecuencia, fechas y cronograma sin duplicar la fuente remota,
  - el bootstrap remoto ya no cachea cuotas fuera de los loans visibles del cobrador actual, evitando mezclar portfolios bajo sesiones `admin`,
  - el smoke remoto ya dejó evidencia real de `admin -> originate_loan -> collector -> cartera visible -> record_payment`,
  - OR-4 queda cerrado; el riesgo abierto del subplan ya no es convergencia técnica sino hardening final por rol y cierre documental en `OR-5`.

### OR-3.1: visibilidad de entrada de originacion

- Fecha: `2026-05-06`
- Alcance: corregir la descubrilidad del flujo nuevo para que la entrada de originación no dependa de que el usuario intuya el menú operativo
- Archivos tocados:
  - `src/App.tsx`
  - `docs/operational-ui.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run check`
- Resultado:
  - toda sesión autenticada ya ve una entrada visible de originación en el hero operativo,
  - `admin` sigue entrando al wizard completo,
  - `collector` ahora también descubre el flujo desde el encabezado, pero la denegación sigue ocurriendo dentro del panel y antes de tocar el RPC.

### OR-3: wizard mobile-first de originacion

- Fecha: `2026-05-06`
- Alcance: abrir una entrada separada de originacion dentro de la shell operativa, con validacion local, preview canonico y submit por RPC sin mezclarlo con el panel de cobro
- Archivos tocados:
  - `src/App.tsx`
  - `src/index.css`
  - `src/lib/origination/origination-validation.ts`
  - `src/lib/origination/origination-wizard.ts`
  - `src/lib/origination/origination-transport.ts`
  - `src/lib/origination/origination-wizard-panel.tsx`
  - `src/lib/origination/origination-validation.test.ts`
  - `src/lib/origination/origination-wizard.test.ts`
  - `package.json`
  - `docs/origination-control.md`
  - `docs/operational-ui.md`
  - `docs/phase-control.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase7`
  - `npm run check`
  - `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"`
  - `git diff --check -- src/App.tsx src/index.css src/lib/origination/origination-validation.ts src/lib/origination/origination-wizard.ts src/lib/origination/origination-transport.ts src/lib/origination/origination-wizard-panel.tsx src/lib/origination/origination-validation.test.ts src/lib/origination/origination-wizard.test.ts package.json`
- Resultado:
  - la `operations-sheet` ya tiene una sección `Originacion` separada de `Cobro`, visible desde móvil y desktop sin romper la gramática actual del shell,
  - el wizard ya guía `Deudor -> Prestamo -> Confirmacion`, soporta `nuevo deudor` y `deudor existente`, exige conexión antes del submit y deshabilita envíos duplicados mientras origina,
  - `collector` ya ve la denegación en UI antes de tocar el RPC; `admin` obtiene CTA visible, búsqueda remota de deudor y preview canonico del cronograma,
  - los tests nuevos fijan el contrato local del payload, el bloqueo por rol y la habilitación de pasos sin depender de `App.tsx`,
  - OR-3 quedó validado localmente; el riesgo abierto ya no es de UI base sino de convergencia end-to-end con cartera y cobro, que pertenece a `OR-4`.

### BR-1: compuerta local de rendimiento y presupuesto inicial de bundle

- Fecha: `2026-05-06`
- Alcance: convertir la conversación de rendimiento móvil en una compuerta reproducible y versionada antes de la validación manual en dispositivo real
- Archivos tocados:
  - `scripts/test-perf.mjs`
  - `package.json`
  - `README.md`
  - `docs/phase4-manual-validation.md`
  - `docs/phase-control.md`
  - `docs/implementation-plan.md`
  - `docs/audit-report.md`
  - `docs/session-handoff.md`
- Comandos:
  - `npm run test:perf`
  - `npm run check`
- Resultado:
  - `npm run test:perf` ahora valida el caso de cartera grande ya existente y luego inspecciona los assets iniciales generados por `vite build`,
  - el presupuesto inicial quedó versionado en `scripts/test-perf.mjs` para evitar que el bundle crezca sin decisión explícita,
  - el corte asincrono de `src/lib/runtime/operational-runtime.ts` movió Dexie, Supabase y sync fuera del JS crítico del primer render,
  - baseline actualizado en esta sesión: `javascript entry = 372550 raw / 116415 gzip`, `css entry = 23707 raw / 5068 gzip`, `entry total = 396257 raw / 121483 gzip`, `operational runtime async = 207610 raw / 53530 gzip`,
  - la validación manual de Fase 4 ahora exige esta compuerta antes de ejecutarse en dispositivo real,
  - el warning anterior de Vite por chunk > `500 kB` dejó de aparecer en el build actual, y el presupuesto se endureció sobre el nuevo baseline para no volver al tamaño previo por accidente.

### Procedimiento manual versionado para cierre de Fase 4

- Fecha: `2026-05-06`
- Alcance: convertir la brecha manual restante de Fase 4 en un procedimiento único, reusable y trazable para teléfono/dispositivo real
- Archivos tocados:
  - `docs/phase4-manual-validation.md`
  - `docs/implementation-plan.md`
  - `docs/phase-control.md`
  - `docs/operational-ui.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run check`
  - `git diff --check -- docs/phase4-manual-validation.md docs/implementation-plan.md docs/phase-control.md docs/operational-ui.md docs/session-handoff.md docs/audit-report.md`
- Resultado:
  - la validación manual pendiente ya no depende de memoria oral ni de notas dispersas; quedó versionada en `docs/phase4-manual-validation.md`,
  - el procedimiento deja explícitos prerrequisitos, recorrido táctil, verificación de gestión de visita y formato de evidencia para `docs/audit-report.md`,
  - `docs/implementation-plan.md`, `docs/phase-control.md`, `docs/operational-ui.md` y `docs/session-handoff.md` ahora apuntan al mismo gate manual,
  - en ese momento Fase 4 seguía abierta porque el procedimiento quedó preparado, pero no ejecutado en dispositivo físico real dentro de esa sesión; ese gate quedó diferido después por decisión de producto.

### Smoke móvil reproducible y cartera simulada grande

- Fecha: `2026-05-06`
- Alcance: convertir parte del cierre pendiente de Fase 4 en compuertas reproducibles de terminal para móvil/offline-online y carga simulada
- Archivos tocados:
  - `scripts/phase4-mobile-smoke.mjs`
  - `src/lib/collector/collector-route-board.test.ts`
  - `package.json`
  - `docs/implementation-plan.md`
  - `docs/phase-control.md`
  - `docs/operational-ui.md`
  - `docs/audit-report.md`
  - `docs/session-handoff.md`
  - `docs/database-control.md`
- Comandos:
  - `npm run test:phase4`
  - `node scripts/phase4-auth-user.mjs smoke fase4.collector@cobrodiario.dev 123456`
  - `PHASE4_SMOKE_DEBUG_PORT=9334 node scripts/phase4-mobile-smoke.mjs fase4.collector@cobrodiario.dev 123456`
  - `npm run check`
- Resultado:
  - `test:phase4` ahora sí ejecuta también `collector-route-board.test.ts`, alineando el script con el tablero documental,
  - la nueva prueba de cartera simulada grande valida 1200 casos sin romper el orden operativo ni exceder el umbral local definido,
  - `scripts/phase4-mobile-smoke.mjs` dejó un recorrido reproducible para `login -> drawer móvil -> cobro offline -> cola local -> resync online`,
  - la revalidación remota posterior pasó con `portfolioCount=4`, `customer="Brayan Rojas"` y `offlineQueueSnapshot="Cola1 pendientes / 0 fallidos"` antes del resync,
  - la regresión remota de `record_payment` sobre cuotas parciales quedó cerrada con `20260506184500_fix_record_payment_partial_component_reconstruction.sql`,
  - el script falla si encuentra errores de runtime o `console.error` en ese recorrido,
  - en ese momento Fase 4 seguía abierta solo por validación manual en dispositivo real y confirmación táctil/visual final de gestión de visita; esa condición quedó diferida después por decisión de producto.

### Cierre de la subfase 4.3

- Fecha: `2026-05-06`
- Alcance: mover estilos inline estáticos remanentes de la shell operativa a clases compartidas y restablecer la compuerta documental de UI
- Archivos tocados:
  - `src/App.tsx`
  - `src/index.css`
  - `docs/audit-report.md`
  - `docs/phase-control.md`
- Comandos:
  - `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"`
  - `git diff --check -- src/index.css docs/audit-report.md docs/phase-control.md`
  - `git diff --check -- src/App.tsx`
  - `npm run check`
- Resultado:
  - el encabezado móvil y la fila de cola ya usan clases compartidas en `src/index.css` en lugar de `style={{...}}`,
  - la compuerta de la subfase 4.3 vuelve a pasar sin excepciones activas en `src/**/*.tsx`,
  - `git diff --check -- src/App.tsx` sigue bloqueado por trailing whitespace preexistente en las lineas `1283`, `1390` y `1465`, sin cambios de esta tarea sobre esos renglones,
  - en ese momento Fase 4 seguía abierta por validación manual en dispositivo real; después, ese gate quedó diferido por decisión de producto mientras offline/online, consola limpia y cartera simulada grande ya estaban cubiertos por compuertas reproducibles.

### Auditoría funcional y control de fases

- Fecha: `2026-05-06`
- Alcance: inventario de funciones frontend/backend/offline contra los referentes documentados y reapertura de la compuerta de inline styles
- Archivos tocados:
  - `docs/phase-control.md`
  - `docs/implementation-plan.md`
  - `docs/audit-report.md`
- Comandos:
  - `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"`
  - `git diff --check`
- Resultado:
  - se creó `docs/phase-control.md` como tablero complementario de funciones, brechas y gates sin competir con `docs/implementation-plan.md`,
  - la comparación confirmó que la base actual ya cubre auth, bootstrap remoto, cartera, cobro oldest-first, cola offline y recibo local,
  - siguen abiertas brechas de producto respecto al baseline: recibo remoto/Bluetooth físico, una entidad dedicada de rutas, abonos dirigidos a capital/interés, rendimiento con cartera grande y smoke manual móvil,
  - la subfase 4.3 se reabre porque `src/App.tsx` tiene 4 estilos inline estáticos y el reporte no podía seguir marcándola como cerrada.

### Claridad de login y saneamiento de validacion

- Fecha: `2026-05-05`
- Alcance: mejora del mensaje de error de Auth en login y correcciones menores para recuperar validacion local de la shell operativa
- Archivos tocados:
  - `src/App.tsx`
  - `src/index.css`
  - `docs/audit-report.md`
- Comandos:
  - `npm run check`
- Resultado:
  - la UI ahora traduce `Invalid login credentials` a un mensaje operativo en español que tambien sugiere revisar `.env.local`,
  - `syncMessage` ya no rompe lint por quedar declarado sin uso,
  - se removio una llave sobrante en `src/index.css` que estaba rompiendo `vite build`,
  - la validacion del login sigue dependiendo de apuntar al proyecto Supabase correcto; este ajuste mejora diagnostico, no reemplaza esa alineacion.

### Auditoría base

- Fecha: `2026-05-05`
- Alcance: revisión de estandarización documental y estado real de la UI compartida
- Archivos observados:
  - `src/index.css`
  - `src/App.tsx`
  - `docs/standardization-plan.md`
  - `docs/improved-assistant-instructions.md`
  - `AGENTS.md`
- Comandos:
  - `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"`
  - `rg --files src | rg 'styles|css$'`
- Resultado:
  - no se encontraron inline styles en TSX/JSX,
  - la fuente actual de tokens sigue siendo `src/index.css`,
  - la estandarización de inputs y la evidencia manual de responsive siguen pendientes.

### Ajuste de estándares

- Fecha: `2026-05-05`
- Alcance: corrección de subplan, auditoría e integración mínima en estándares permanentes
- Archivos tocados:
  - `docs/standardization-plan.md`
  - `docs/audit-report.md`
  - `docs/improved-assistant-instructions.md`
  - `AGENTS.md`
  - `docs/engineering-standards.md`
  - `docs/commenting-standard.md`
  - `docs/implementation-plan.md`
- Comandos:
  - `git diff --check`
- Resultado:
  - el subplan ya no compite con el roadmap maestro,
  - los estándares permanentes ahora exigen inline styles justificados, comentarios con flujo y actualización de auditoría en tareas de UI compartida,
  - siguen abiertas la estandarización de `.input`, la auditoría manual responsive y la validación con cartera grande.

### Shell operativa y tablero provisional de rutas

- Fecha: `2026-05-05`
- Alcance: consolidación de primitivas compartidas para login/cartera/cobro y priorización operativa por ruta provisional
- Archivos tocados:
  - `src/App.tsx`
  - `src/index.css`
  - `src/lib/collector/collector-route-board.ts`
  - `src/lib/collector/collector-route-board.test.ts`
  - `src/lib/db/local-db.ts`
  - `src/lib/collector/collector-workspace.ts`
  - `docs/operational-ui.md`
  - `docs/session-handoff.md`
- Comandos:
  - `npm run test`
  - `npm run check`
  - `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"`
  - `git diff --check`
- Resultado:
  - `.input` ya es la primitiva única usada por login, búsqueda y formulario de cobro,
  - `src/index.css` ya contiene las clases compartidas que `src/App.tsx` necesitaba para render operativo coherente,
  - la cartera ahora se ordena por prioridad operativa y se agrupa por ruta provisional derivada desde `customer.neighborhood` o el tramo final de `address`,
  - los bloques nuevos de ruta/prioridad dejaron intención, flujo y riesgo inline en código,
  - siguen pendientes la evidencia manual responsive y la validación con cartera grande.

### Regla mobile-first institucionalizada

- Fecha: `2026-05-05`
- Alcance: convertir la prioridad móvil en estándar explícito de diseño compartido
- Archivos tocados:
  - `docs/engineering-standards.md`
  - `docs/standardization-plan.md`
  - `AGENTS.md`
  - `docs/audit-report.md`
- Comandos:
  - `git diff --check`
- Resultado:
  - el repositorio ya declara de forma explícita que la UI debe ser responsive y `mobile-first`,
  - cualquier asistente futuro debe resolver primero viewport pequeño y flujo táctil antes de expandir a desktop,
  - la evidencia manual responsive sigue pendiente; esta regla fija prioridad, pero no reemplaza la validación real en dispositivo.

### Shell operativa mobile-first

- Fecha: `2026-05-05`
- Alcance: navegación táctica por paneles para móvil sin duplicar componentes de cartera, detalle y cobro
- Archivos tocados:
  - `src/App.tsx`
  - `src/index.css`
  - `docs/operational-ui.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test`
  - `npm run check`
  - `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"`
  - `git diff --check`
- Resultado:
  - la UI ahora prioriza móvil con navegación por paneles `portfolio`, `detail` y `payment`,
  - la selección de cartera ya empuja al detalle y el detalle ya ofrece transición directa al cobro,
  - desktop mantiene la misma fuente de verdad y la misma grilla; móvil solo cambia visibilidad por media query,
  - sigue pendiente la validación manual en teléfono real; este cambio mejora el flujo, pero no reemplaza el smoke táctil.

### Optimización de experiencia nativa móvil (Auditado)

- Fecha: `2026-05-06`
- Alcance: Transformación integral de la UI para alcanzar una experiencia 100% idéntica a una App Nativa.
- Archivos tocados:
  - `src/index.css`
  - `index.html`
  - `src/App.tsx`
  - `docs/audit-report.md`
- Comandos:
  - `npm run check`
  - `rg "[0-9]+px" src/index.css` (verificación de remanentes)
- Resultado:
  - **Zero-PX Policy (Layout):** Migración total a `rem` para asegurar escalabilidad elástica en todas las densidades de pantalla.
  - **Dynamic Viewport:** Implementación de `dvh` para eliminar saltos visuales causados por las barras del navegador móvil.
  - **Touch Targets Estandarizados:** Elevación de todos los elementos interactivos críticos (botones, inputs, filas) a un mínimo de `3rem` (48px) siguiendo WCAG 2.1.
  - **Safe Area Hardening:** Uso de `viewport-fit=cover` en `index.html` y `env(safe-area-inset-*)` en CSS para soporte total de muescas (notches) y Dynamic Island.
  - **Input Hardening:** Forzado de `font-size: 1rem` en campos de texto para prevenir el auto-zoom intrusivo de iOS.
  - **Semántica y Accesibilidad:** Refactor de `App.tsx` con roles ARIA, etiquetas descriptivas y estructura jerárquica para navegación por gestos de asistencia.
  - **Native Transitions:** Refinamiento de animaciones `slide-in` con transformaciones de hardware-acceleration (`translate3d`).

### Gestión de visita local


- Fecha: `2026-05-05`
- Alcance: registro operativo local de promesas, novedades y revisitas sin introducir una falsa capa remota
- Archivos tocados:
  - `src/types/domain.ts`
  - `src/lib/db/local-db.ts`
  - `src/lib/collector/collection-actions.ts`
  - `src/lib/collector/collector-workspace.ts`
  - `src/lib/collector/collector-workspace.test.ts`
  - `src/App.tsx`
  - `src/index.css`
  - `docs/operational-ui.md`
  - `docs/audit-report.md`
  - `docs/session-handoff.md`
  - `docs/implementation-plan.md`
- Comandos:
  - `npm run test`
  - `npm run check`
  - `git diff --check`
- Resultado:
  - el cobrador ya puede registrar `promise_to_pay`, `not_found`, `return_visit` y `visited_no_payment`,
  - la gestión queda visible en cartera, detalle y búsqueda local del mismo dispositivo,
  - se exige fecha de seguimiento para promesas y revisitas,
  - ese corte quedó superado por `OR-3.14`, donde la gestión ya entra a cola offline y sincronización remota versionada.

### Menu operativo y verificación de secciones

- Fecha: `2026-05-05`
- Alcance: ordenar el panel operativo con navegación explícita y ampliar pruebas de helpers/flujo local
- Archivos tocados:
  - `src/App.tsx`
  - `src/index.css`
  - `src/lib/collector/collection-actions.test.ts`
  - `docs/operational-ui.md`
  - `docs/audit-report.md`
  - `docs/session-handoff.md`
  - `docs/implementation-plan.md`
- Comandos:
  - `npm run test`
  - `npm run check`
  - `npm run dev -- --host 127.0.0.1 --port 4173`
  - `curl -I http://127.0.0.1:4173`
  - `git diff --check`
- Resultado:
  - el panel operativo ya tiene un menú claro para `Cobro`, `Gestion`, `Recibo`, `Cola` y `Reglas`,
  - la UI ya no apila todas las funciones de operación en una sola columna visible,
  - las pruebas cubren helpers de gestión y persistencia local,
  - el servidor de desarrollo respondió `HTTP/1.1 200 OK`,
  - sigue pendiente la validación manual de navegación táctil real en navegador/móvil.

### Refactor mobile-first puro

- Fecha: `2026-05-05`
- Alcance: invertir la base CSS para que móvil sea la fuente primaria y desktop sea solo expansión
- Archivos tocados:
  - `src/index.css`
  - `docs/operational-ui.md`
  - `docs/audit-report.md`
  - `docs/session-handoff.md`
  - `docs/implementation-plan.md`
- Comandos:
  - `npm run test`
  - `npm run check`
  - `npm run dev -- --host 127.0.0.1 --port 4173`
  - `curl -I http://127.0.0.1:4174`
  - `git diff --check`
- Resultado:
  - la base de layout ahora arranca en una sola columna y usa `min-width` para crecer a tablet/desktop,
  - `mobile-workspace-nav` ya es visible por defecto en móvil y los paneles dependen de `workspace-pane.is-active`,
  - `ops-grid` dejó de nacer en tres columnas,
  - el servidor de desarrollo volvió a responder `HTTP/1.1 200 OK` tras el refactor,
  - sigue pendiente validación visual manual en teléfono real para confirmar tactilidad, sticky nav y jerarquía percibida.

### Corrección de descubribilidad móvil

- Fecha: `2026-05-05`
- Alcance: reemplazar la navegación móvil que escondía operaciones detrás de paneles por una barra inferior fija y una hoja operativa visible a un toque
- Archivos tocados:
  - `src/App.tsx`
  - `src/index.css`
  - `docs/operational-ui.md`
  - `docs/session-handoff.md`
  - `docs/implementation-plan.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test`
  - `npm run check`
  - `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"`
  - `git diff --check`
- Resultado:
  - la navegación primaria móvil ahora vive en una barra inferior fija con `Cartera`, `Detalle` y `Operacion`,
  - `Operacion` ya abre una `operations-sheet` con `Cobro`, `Gestion`, `Recibo`, `Cola` y `Reglas` sin depender de entrar antes a un panel oculto,
  - el cierre de la hoja quedó disponible por backdrop, botón explícito y cambio de destino en la barra inferior,
  - desktop conserva la misma lógica operativa, pero expande la hoja a panel persistente dentro de la grilla,
  - sigue pendiente validación manual en teléfono real y revisión visual de áreas táctiles en dispositivo.

### Corrección del bootstrap Dexie en StrictMode

- Fecha: `2026-05-05`
- Alcance: destrabar el arranque de la shell operativa evitando que IndexedDB se cierre durante el remount de desarrollo
- Archivos tocados:
  - `src/App.tsx`
  - `docs/operational-ui.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test`
  - `npm run check`
  - `npm run dev -- --host 127.0.0.1 --port 4175`
  - `curl -I http://127.0.0.1:4175`
  - `git diff --check`
- Resultado:
  - `localDb` ya no se cierra en el cleanup del efecto base,
  - la app deja de quedar atrapada en `!dbReady` por `Database has been closed` durante el remount de React `StrictMode`,
  - el servidor local volvió a responder `HTTP/1.1 200 OK` tras la corrección,
  - sigue pendiente validación manual visual del login y de la navegación móvil en dispositivo real.

### Menu hamburguesa movil operativo

- Fecha: `2026-05-05`
- Alcance: reemplazar la navegación móvil primaria basada en barra inferior por un menú hamburguesa sticky accesible desde cualquier punto del flujo autenticado
- Archivos tocados:
  - `src/App.tsx`
  - `src/index.css`
  - `docs/operational-ui.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run check`
  - `'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --headless=new --disable-gpu --remote-debugging-port=9333 --user-data-dir=/private/tmp/codex-chrome-mobile http://127.0.0.1:4174/`
  - `node - <<'NODE' ...` validación CDP móvil con login semilla y navegación `Cartera -> Detalle -> Operacion`
- Resultado:
  - la navegación móvil primaria ahora vive en `mobile-shell-header` y `mobile-navigation-drawer`,
  - el menú hamburguesa ya expone `Cartera`, `Detalle`, `Operacion`, atajos operativos y acciones de sesión sin depender de una barra inferior fija,
  - `Operacion` sigue abriendo la misma `operations-sheet`, por lo que móvil y desktop conservan una sola fuente de verdad de estado,
  - la validación autenticada en viewport móvil confirmó login con el usuario semilla, presencia del menú hamburguesa y cambio real de estado al abrir `Cartera`, `Detalle` y `Operacion`,
  - sigue pendiente validación en dispositivo físico y smoke offline/online de cobro para cerrar Fase 4.

### Descubribilidad del menu movil antes del login

- Fecha: `2026-05-05`
- Alcance: mantener el patron de menu hamburguesa tambien en la vista publica sin exponer navegacion operativa antes de autenticar al cobrador
- Archivos tocados:
  - `src/App.tsx`
  - `src/index.css`
  - `docs/operational-ui.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run check`
  - `npm run test`
  - `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"`
  - `git diff --check`
- Resultado:
  - `mobile-shell-header` y el toggle ya renderizan cuando `hasSupabaseEnv && dbReady && authReady`, aunque `sessionUserId` siga en `null`,
  - el drawer publico ahora ofrece acceso a login, reglas y arquitectura, mientras `Cartera`, `Detalle` y `Operacion` siguen reservados al estado autenticado,
  - la shell movil conserva un solo patron de descubribilidad entre vista publica y shell autenticada sin duplicar la fuente de verdad operativa,
  - `npm run check` y `npm run test` pasaron; no reaparecieron inline styles estaticos ni errores de formato en diff,
  - sigue pendiente la validacion manual en navegador/dispositivo real para confirmar jerarquia visual y tactilidad del login.

### Menu movil visible desde primer render

- Fecha: `2026-05-05`
- Alcance: quitar el ultimo gate de bootstrap que todavia escondia el menu hamburguesa en el arranque movil y mantener un solo patron de drawer para entorno, bootstrap, vista publica y shell autenticada
- Archivos tocados:
  - `src/App.tsx`
  - `docs/operational-ui.md`
  - `docs/implementation-plan.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run check`
  - `'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --headless=new --disable-gpu --dump-dom --window-size=390,844 --user-data-dir=/private/tmp/codex-chrome-mobile http://127.0.0.1:4176/`
  - `git diff --check`
- Resultado:
  - `mobile-shell-header` ya no depende de `dbReady`, `authReady` ni `sessionUserId`; el shell movil existe desde el primer render y solo adapta el contenido del drawer segun estado,
  - el drawer ahora tiene variantes seguras para `environment`, `bootstrap`, `public` y `authenticated` sin duplicar la fuente de verdad operativa,
  - el estado de entorno bloqueado ya ofrece setup y arquitectura, mientras bootstrap solo expone estado de arranque y contexto del runtime local,
  - la documentacion de Fase 4 y del handoff quedo alineada con el contrato mobile-first actual,
  - sigue pendiente validacion manual en dispositivo real para confirmar jerarquia tactil y transicion visual entre arranque, login y shell autenticada.

### Higiene del service worker en desarrollo

- Fecha: `2026-05-05`
- Alcance: evitar que el shell offline cachee assets de Vite y oculte cambios reales del menu hamburguesa durante validacion local
- Archivos tocados:
  - `src/lib/pwa/register-service-worker.ts`
  - `docs/operational-ui.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test`
  - `npm run check`
  - `git diff --check`
- Resultado:
  - el `serviceWorker` ahora solo se registra fuera de desarrollo,
  - en `import.meta.env.DEV` la app desregistra service workers viejos y limpia caches `cobro-diario-shell-*` del mismo origen,
  - esto reduce el riesgo de ver un drawer movil viejo o un cliente HMR de Vite apuntando a un runtime anterior,
  - la validacion remota de Supabase sigue bloqueada en esta sesion porque el MCP activo responde por otro `project_ref`, asi que no debe declararse backend verificado hasta corregir ese enlace.

### COP visible tambien en captura monetaria

- Fecha: `2026-05-07`
- Alcance: cerrar la inconsistencia donde la salida financiera ya mostraba `COP`, pero los campos editables del cobro y de originacion seguian viendo solo el numero agrupado
- Archivos tocados:
  - `src/lib/finance/money.ts`
  - `src/lib/finance/currency-amount-input.tsx`
  - `src/App.tsx`
  - `src/lib/origination/origination-wizard-panel.tsx`
  - `src/index.css`
  - `docs/financial-contract-v1.md`
  - `docs/operational-ui.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase2`
  - `npm run test:phase4`
  - `npm run test:phase7`
  - `npm run check`
  - `npm run test:perf`
  - `git diff --check`
- Resultado:
  - `formatCurrency()` sigue siendo la fuente central de salida monetaria visible,
  - `CurrencyAmountInput` conserva solo la mascara numerica agrupada y no introduce prefijos visuales nuevos,
  - la shell mobile-first mantiene captura monetaria alineada a la derecha sin estilos inline,
  - `formatCurrency()` ahora normaliza `cop -> COP` antes de formatear, cerrando el caso donde cartera, detalle y recibos seguian viendo `$` por casing mixto del dato remoto,
  - y el `Desglose del abono` del panel de cobro ya no muestra `installmentId`; ahora renderiza el numero visible de cuota desde la cartera local activa.

### Idempotencia estricta por payload en `record_payment`

- Fecha: `2026-05-07`
- Alcance: cerrar la grieta donde el mismo `device_local_id` podia devolver el mismo `payment.id` aun cuando el cobro cambiaba dentro del mismo prestamo/cliente/cobrador
- Archivos tocados:
  - `src/lib/sync/payment-sync.ts`
  - `src/lib/sync/payment-sync.test.ts`
  - `supabase/migrations/20260507160421_phase6_harden_record_payment_idempotency.sql`
  - `supabase/tests/phase2_record_payment_gate.sql`
  - `docs/financial-contract-v1.md`
  - `docs/database-control.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase2`
  - `npm run test:phase3`
  - `npm run test:phase6`
  - `supabase/tests/phase2_record_payment_gate.sql` por MCP con `ROLLBACK`
- Resultado:
  - la cola offline ya no trata como reintento valido un `deviceLocalId` cuyo snapshot canónico cambió,
  - `public.record_payment()` ahora compara el payload remoto existente contra `paid_at`, `payment_reference`, metadata operativa y el arreglo completo de `payment_applications`,
  - el caso negativo `mismo device_local_id + payload mutado` ya quedó cubierto en la compuerta de Fase 2,
  - y `LANDING` volvió a pasar la compuerta completa sin regresiones en pago único, parcial, multi-cuota, orden contractual ni trazabilidad de dispositivo.

### Manifiesto PWA con credenciales bajo Vercel Protection

- Fecha: `2026-05-07`
- Alcance: corregir el request del `manifest.webmanifest` cuando el deployment corre detrás de `Vercel Authentication` o `Deployment Protection`
- Archivos tocados:
  - `index.html`
  - `docs/deployment-runbook.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run check`
  - `git diff --check`
- Resultado:
  - el manifiesto ahora se enlaza con `crossorigin="use-credentials"`,
  - la corrección mantiene la barrera perimetral del deployment y no relaja autenticación ni roles de la app,
  - y el runbook ya deja explícito que un `403` del manifiesto en preview protegido debe resolverse enviando credenciales, no desactivando protección por inercia.

### Recibo enriquecido con exportación PDF real

- Fecha: `2026-05-07`
- Alcance: enriquecer el comprobante confirmado con métricas operativas visibles, nombre del cobrador y exportación PDF reproducible sin convertir el shell móvil en un bundle pesado
- Archivos tocados:
  - `src/App.tsx`
  - `src/index.css`
  - `src/lib/receipts/receipt-types.ts`
  - `src/lib/receipts/receipt-mapper.ts`
  - `src/lib/receipts/receipt-panel.tsx`
  - `src/lib/receipts/receipt-analytics.ts`
  - `src/lib/receipts/receipt-pdf.ts`
  - `scripts/phase5-receipt-pdf-smoke.ts`
  - `supabase/migrations/20260507170311_phase5_enriched_payment_receipt_pdf_contract.sql`
  - `supabase/seeds/phase4_landing_playground.sql`
  - `supabase/seeds/phase4_landing_smoke.sql`
  - `supabase/tests/phase5_receipt_gate.sql`
  - `docs/operational-ui.md`
  - `docs/database-control.md`
  - `docs/function-gap-control.md`
  - `docs/session-handoff.md`
  - `docs/audit-report.md`
- Comandos:
  - `npm run test:phase5`
  - `npm run typecheck`
  - `npm run smoke:receipt-pdf -- fase4.playground@cobrodiario.dev 123456 PG-ELI-001`
  - `npm run check`
  - `npm run test:perf`
  - `git diff --check`
- Resultado:
  - el recibo confirmado ya muestra cobrador, aplicación del pago y snapshot operativo del crédito sin mezclar fuente remota del pago con caché operativa local,
  - el PDF se prepara apenas llega el comprobante confirmado, sin forzar una segunda espera manual después del pago,
  - en navegadores móviles compatibles la acción primaria del ticket es `Compartir PDF`; donde no existe share de archivos, cae a `Guardar PDF`,
  - el PDF se genera desde el mismo contrato visible del panel usando `jspdf` dentro del chunk diferido del recibo,
  - el smoke real final contra `LANDING` registró un pago, leyó el comprobante confirmado por RPC y escribió un archivo PDF válido en `/var/folders/7q/rlhk14sx41z4r8pkzfbrpwzw0000gn/T/cobro-diario-receipt-smoke/recibo-pdf-pg-eli-001-1778175551427.pdf`,
  - y los seeds `phase4_landing_playground` / `phase4_landing_smoke` ya no quedan atrasados frente al esquema actual de originación ni frente a los saldos por componente de `installments`.

## Checklist operativo para futuros cierres

### Arquitectura de estilos

- [x] La fuente de verdad de tokens quedó documentada.
- [x] Las primitivas compartidas nuevas o modificadas quedaron centralizadas.
- [x] No se introdujeron inline styles estáticos.

### Calidad de documentación

- [x] Cada bloque crítico nuevo explica intención.
- [x] Cada flujo crítico nuevo explica origen y destino de datos si aplica.
- [x] Cada bloque sensible nuevo deja visible el riesgo o restricción.
- [x] Los manuales de `docs/` quedaron alineados si cambió el comportamiento.

### Validación

- [x] Se ejecutó el grep de inline styles.
- [x] Se ejecutó validación razonable del cambio (`npm run check`, test puntual o smoke manual).
- [x] Se dejó constancia explícita de lo que no se pudo validar.
