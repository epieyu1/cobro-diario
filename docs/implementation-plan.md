# Implementation Plan

## Objetivo

Tener una base profesional para evolucionar `Cobro Diario` desde bootstrap técnico a un producto operable con frontend, backend transaccional, sincronización offline y despliegue controlado, sin perder control del avance ni permitir que una fase avance con validación incompleta.

## Cómo usar este documento

- Este archivo es el tablero de control principal del proyecto.
- El desglose funcional y la comparacion `referente -> estado actual -> faltante` vive en `docs/phase-control.md`.
- El control especifico de base de datos, seguridad y ACID vive en `docs/database-control.md`.
- El control especifico de alta de deudor y prestamo vive en `docs/origination-control.md`.
- `docs/phase-control.md` es complementario; no reemplaza este tablero maestro ni autoriza cerrar fases sin sus gates.
- El circuito activo de planificación del repo es:
  - `docs/implementation-plan.md` como roadmap maestro,
  - `docs/phase-control.md` como tablero funcional complementario.
- Los documentos archivados en `docs/archive/` no deben seguirse como plan activo; solo conservan contexto histórico.
- `docs/origination-control.md` es un subplan permitido porque depende de este tablero maestro y no lo reemplaza.
- Cada fase solo puede marcarse como completada cuando:
  - todas sus tareas estén tachadas,
  - sus artefactos obligatorios existan,
  - sus tests de compuerta pasen,
  - el resultado quede documentado en `docs/session-handoff.md`.
- Si una fase descubre trabajo extra para una fase anterior, no se “parchea” en silencio:
  - se reabre la fase afectada,
  - se documenta el motivo,
  - se vuelven a correr sus tests de compuerta.
- Si una fase no tiene test suficiente, crear ese test es parte de la fase.

## Tablero Maestro

- [x] Fase 0. Reingreso y validación de entorno
  Gate aprobado en sesión del 5 de mayo de 2026.
- [x] Fase 1. Asegurar la capa de datos remota
  Cerrada el 6 de mayo de 2026: el hardening remoto quedó aplicado en `LANDING`, la compuerta negativa de seguridad pasó y `record_payment` quedó revalidado contra bypass por DML directo.
- [x] Fase 2. Modelo de negocio detallado
  Gate transaccional aprobado en sesión del 5 de mayo de 2026 y revalidado en `LANDING` el 6 de mayo de 2026 después del cierre real de la Fase 1.
- [x] Fase 3. Sincronización offline real
  Gate aprobado en sesión del 5 de mayo de 2026.
- [x] Fase 4. UI operativa
  Cerrada para el alcance activo el 7 de mayo de 2026: offline/online, cartera grande, roles, reportes, recibos, rutas, gestiones y rendimiento local ya quedaron cubiertos por compuertas reproducibles; la validación manual en dispositivo real queda diferida por decisión de producto y no bloquea este cierre.
- [/] Fase 5. Despliegue y operación
  Habilitada desde el 7 de mayo de 2026; plan de despliegue en ejecución para configurar Vercel y generar el primer preview.

## Regla de avance

No se puede pasar a la siguiente fase si:

- queda una tarea crítica sin tachar,
- falta evidencia del resultado,
- un test de compuerta falla,
- el comportamiento cambió pero no quedó explicado inline o en `docs/`,
- el handoff no refleja el estado real.

## Fase 0: Reingreso y validación de entorno

### Resultado esperado

Confirmar que la sesión nueva realmente puede operar sobre `LANDING` antes de cambiar código o base de datos.

### Dependencias

- [x] `AGENTS.md` leído.
- [x] `docs/session-handoff.md` leído.
- [x] `docs/reference-benchmarks.md` leído o revisado antes de recortar alcance.

### Checklist de ejecución

- [x] Verificar MCP de Supabase.
- [x] Verificar que el repo sigue enlazado con `supabase link`.
- [x] Verificar que `.env.local` sigue apuntando al proyecto correcto.
- [x] Verificar `npm run check`.
- [x] Confirmar que el `project_ref` del repo y el de `~/.codex/config.toml` coinciden.

### Evidencia obligatoria

- [x] Resultado de `codex mcp get supabase`.
- [x] Resultado de `codex mcp list`.
- [x] Prueba MCP real (`get_project_url`, `get_publishable_keys`, `list_tables`).
- [x] Validación local `npm run check`.

### Tests de compuerta

- [x] `codex mcp get supabase` muestra `project_ref=vmlxfbqezgjivesxahfe`.
- [x] `codex mcp list` muestra el servidor `supabase` habilitado.
- [x] `get_project_url` devuelve `https://vmlxfbqezgjivesxahfe.supabase.co`.
- [x] `npm run check` pasa.

### Criterio de salida

- [x] La sesión puede operar sobre `LANDING`, o
- [x] el bloqueo queda documentado antes de continuar.

## Fase 1: Asegurar la capa de datos remota

### Resultado esperado

Validar el esquema inicial, cerrar la superficie remota de escritura y preparar la primera iteración real de dominio sobre `LANDING`.

### Dependencias

- [x] Fase 0 completada.

### Checklist de ejecución

- [x] Inspeccionar tablas remotas reales en Supabase.
- [x] Comparar el esquema local de migraciones con el remoto.
- [x] Ejecutar revisión de seguridad y RLS.
- [x] Ajustar migraciones si hace falta antes de introducir datos productivos.
- [x] Cuarentenar la tabla demo heredada sin destruir datos ajenos.
- [x] Endurecer `record_payment` y funciones base según linter y contrato actual.
- [x] Reemplazar policies `FOR ALL` en tablas críticas por policies por operación donde aplique.
- [x] Revisar grants de Data API para impedir DML directo sobre tablas que deben escribirse solo por RPC o backend controlado.
- [x] Incorporar `profiles.active` al control efectivo de acceso.
- [x] Crear compuerta negativa de seguridad y RLS para el dominio operativo.

### Evidencia obligatoria

- [x] `list_migrations` alineado con migraciones esperadas.
- [x] `list_tables` con dominio base visible en `public`.
- [x] `supabase db lint --linked --level warning` en verde.
- [x] Security Advisor y Performance Advisor revisados.
- [x] Comentarios SQL aplicados en objetos críticos.
- [x] Documento de control de base de datos actualizado en `docs/database-control.md`.
- [x] Resultado de la nueva compuerta `supabase/tests/phase1_security_gate.sql`.

### Tests de compuerta

- [x] `list_migrations` muestra:
  - `20260505063813_foundational_schema`
  - `20260505135552_quarantine_demo_table_access`
  - `20260505135842_harden_function_search_path_and_fk_indexes`
  - `20260505141438_tighten_record_payment_contract`
- [x] `list_migrations` también muestra:
  - `20260505145152_finalize_payment_allocation_v1`
  - `20260505172157_grant_private_schema_usage_for_rls_helpers`
  - `20260506163855_phase1_security_hardening`
  - `20260506171708_phase1_fix_record_payment_write_context_order`
- [x] `supabase db lint --linked --level warning` pasa sin errores.
- [x] Security Advisor no deja `WARN` o `ERROR` nuevos sobre el dominio operativo; el único `WARN` vigente es de Auth por `Leaked Password Protection` deshabilitado.
- [x] Performance Advisor no deja hallazgos bloqueantes nuevos sobre el dominio operativo.
- [x] `record_payment` quedó documentado e idempotente por `device_local_id`.
- [x] `supabase/tests/phase1_security_gate.sql` demuestra que un collector no puede leer ni mutar cartera ajena.
- [x] `supabase/tests/phase1_security_gate.sql` demuestra que `authenticated` no puede insertar o actualizar `payments` directamente si el flujo oficial es `record_payment`.
- [x] El hardening de grants deja explícito qué tablas solo aceptan `SELECT` y cuáles aceptan DML directo.
- [x] Un perfil con `active = false` queda bloqueado en lecturas y RPC críticos.

### Criterio de salida

- [x] Esquema validado con hardening de privilegios.
- [x] Políticas RLS revisadas con evidencia negativa de denegación.
- [x] RPC base `record_payment` revisado contra necesidades reales y sin bypass abierto por DML directo.

## Fase 2: Modelo de negocio detallado

### Resultado esperado

Cerrar reglas financieras antes de expandir sync o UI operativa.

### Dependencias

- [x] Fase 1 completada.
- [x] Revisar `docs/reference-benchmarks.md` antes de simplificar flujos financieros.

### Checklist de ejecución

- [x] Definir orden exacto de aplicación del pago.
- [x] Definir redondeo y moneda oficial por cartera o por país si aplica.
- [x] Definir si el sistema soporta interés simple, interés compuesto o ambos.
- [x] Definir política de abonos libres y cómo se distribuyen.
- [x] Definir si `fee_component` sigue agrupando mora/otros cargos o se separa.
- [x] Definir cuándo un préstamo pasa a `delinquent`.
- [x] Definir reglas de reversos y su trazabilidad.
- [x] Definir si existe segmentación por carteras o inversionistas.
- [x] Definir qué datos operativos son obligatorios en cada cobro:
  - GPS,
  - ruta,
  - referencia,
  - recibo,
  - dispositivo.
- [x] Documentar ejemplos numéricos canónicos de cobro.
- [x] Actualizar TypeScript, SQL y `docs/` para reflejar la decisión final.

### Artefactos obligatorios

- [x] Documento financiero canónico en `docs/`.
- [x] Helpers de dinero alineados con la especificación final.
- [x] Contrato `PaymentDraft` y `payment-contract.ts` alineados con la regla final.
- [x] `record_payment` alineado con la misma semántica.
- [x] Compuerta SQL transaccional versionada en `supabase/tests/phase2_record_payment_gate.sql`.

### Tests de compuerta

- [x] Casos unitarios para `money.ts`:
  - redondeo,
  - suma monetaria,
  - formateo base.
- [x] Casos unitarios para `payment-contract.ts`:
  - duplicado de cuota,
  - componentes que no suman el aplicado,
  - componentes negativos,
  - total derivado correcto,
  - orden `fee -> interest -> principal`,
  - rechazo por exceso de saldo.
- [x] Casos de base de datos para `record_payment`:
  - pago válido de una sola cuota,
  - pago parcial,
  - pago distribuido en varias cuotas,
  - rechazo por `loan_status_not_payable`,
  - rechazo por `duplicate_installment_application`,
  - rechazo por `application_components_mismatch`,
  - idempotencia por `device_local_id`,
  - conflicto por reutilizar `device_local_id` para otro pago,
  - rechazo por `installment_order_violation`,
  - rechazo por `application_order_violation`.
- [x] `npm run test:phase2` pasa.
- [x] `supabase db query --linked --file supabase/tests/phase2_record_payment_gate.sql` pasa con `ROLLBACK`.
- [x] `npm run check` pasa.
- [x] `supabase db lint --linked --level warning` pasa.
- [x] No aparecen nuevos `WARN` o `ERROR` en Security Advisor por cambios de esta fase.

### Criterio de salida

- [x] Contrato financiero definitivo documentado.
- [x] Helpers monetarios y RPC alineados.
- [x] Tests financieros y transaccionales aprobados.

## Fase 3: Sincronización offline real

### Resultado esperado

Pasar de estructura base a un flujo offline confiable, trazable e idempotente.

### Dependencias

- [x] Fase 2 completada.

### Checklist de ejecución

- [x] Modelar la cola de sync con estados (`pending`, `processing`, `failed`, `synced`).
- [x] Persistir el contrato completo de pago en `syncQueue.payload`.
- [x] Definir identificadores idempotentes por evento local.
- [x] Implementar reintentos seguros sin duplicar efectos remotos.
- [x] Implementar reconciliación de pagos, cuotas y préstamo después del sync.
- [x] Definir cómo se conserva GPS y demás evidencia de campo.
- [x] Definir estrategia de conflictos y errores recuperables.
- [x] Documentar cuándo un dato sigue local y cuándo ya es remoto.

### Artefactos obligatorios

- [x] Cola offline funcional en IndexedDB.
- [x] Adaptadores de sync documentados inline.
- [x] Estrategia de errores y reconciliación documentada en `docs/`.
- [x] Documento operativo de sync en `docs/offline-sync.md`.

### Tests de compuerta

- [x] Registrar un pago offline y comprobar que queda en cola local.
- [x] Cerrar y reabrir la app sin perder la cola pendiente.
- [x] Recuperar conectividad y sincronizar exactamente un pago remoto.
- [x] Reintentar el mismo payload y comprobar que no duplica pago remoto usando el mismo `deviceLocalId`.
- [x] Forzar error remoto y verificar transición a `failed` con opción de reintento.
- [x] Confirmar reconciliación local de saldo/estado después de sync exitoso.
- [x] `npm run test:phase3` pasa.
- [x] `npm run check` pasa.

### Criterio de salida

- [x] Cola de sync funcional.
- [x] Estrategia de idempotencia validada.
- [x] Conflictos y reintentos documentados y probados.

## Fase 4: UI operativa

### Resultado esperado

Construir pantallas mínimas para operar en campo con claridad y velocidad.

### Estado de cierre activo

- Implementacion base completada el 5 de mayo de 2026.
- `LANDING` ya tiene un cobrador semilla y cartera operativa reiniciable para smoke real.
- `LANDING` ahora tambien tiene un playground remoto separado y editable para negocio real en `supabase/seeds/phase4_landing_playground.sql`.
- Ya paso el smoke remoto `login -> profile -> customers -> loans -> installments` con `scripts/phase4-auth-user.mjs`, ahora endurecido para validar estados y volumen minimo del dataset de regresion.
- `scripts/phase4-playground.mjs` ya permite `status -> pay -> settle` sobre esa cartera playground usando el mismo login real, RLS real y `record_payment` real del cobrador.
- La shell operativa ya prioriza cartera por ruta provisional y comparte primitivas visuales reales desde `src/index.css`.
- La shell operativa ya resuelve teléfono con menu hamburguesa visible desde el primer render y hoja de operaciones en vez de una sola columna larga o un panel oculto.
- La shell ya soporta gestión de visita local para promesas, novedades y revisitas, todavía sin sync remoto.
- La shell ya separa `Cobro`, `Gestion`, `Recibo`, `Cola` y `Reglas` con un menu operativo dedicado accesible a un toque desde `Operacion`.
- La base visual del frontend ya fue invertida a mobile-first puro; desktop ahora es una expansión por `min-width`.
- `scripts/phase4-mobile-smoke.mjs` ya valida login, navegación móvil, cobro offline, cola local y resync online sobre `LANDING` sin errores de runtime en ese recorrido.
- `npm run test:phase4` ya cubre `collector-route-board.test.ts`, `collector-operational-flow.test.ts` y cartera simulada grande, incluyendo `bootstrap -> ruta -> gestion -> cobro -> cola -> sync`.
- La validación manual en dispositivo real quedó diferida por decisión de producto.
- El procedimiento sigue versionado en `docs/phase4-manual-validation.md`, pero ya no es compuerta bloqueante del cierre activo de la fase.

### Dependencias

- [x] Fase 2 completada.
- [x] Fase 3 completada.

### Checklist de ejecución

- [x] Login y manejo de sesión.
- [x] Sembrar usuario/perfil/cartera operativa reiniciable en `LANDING`.
- [x] Exponer un playground remoto editable para consultar cartera, cobrar y liquidar sin contaminar el smoke mínimo.
- [x] Listado de clientes por ruta o asignación.
- [x] Vista de préstamo y cuotas.
- [x] Registro de pago con desglose comprensible.
- [x] Estado visible de sincronización.
- [x] Vista o flujo de recibo digital/físico.
- [x] Mantener alineados el subplan histórico archivado en `docs/archive/standardization-plan.md` y `docs/audit-report.md` cuando cambie la UI compartida.
- [x] Diseñar para cartera grande sin degradación notable.
- [x] Asegurar legibilidad móvil y baja curva de aprendizaje.

### Artefactos obligatorios

- [x] Flujo mínimo de cobrador completo.
- [x] Estados de error, offline y reintento visibles.
- [x] Decisiones UX documentadas cuando haya tradeoffs.
- [x] Subplan y auditoría de UI alineados con el estado real del frontend.
- [x] Procedimiento manual de cierre móvil versionado en `docs/phase4-manual-validation.md`.

### Tests de compuerta

- [x] Smoke remoto Auth/RLS contra `LANDING` para `login -> profile -> customers -> loans -> installments`.
- [x] Workflow remoto de negocio para `reset -> status -> pay -> settle` sobre cartera playground editable.
- [x] Smoke móvil headless reproducible para `login -> navegación -> cobro offline -> resync online`.
- [x] Recorrido automatizado del cobrador para `bootstrap -> ruta -> gestion local -> cobro oldest-first -> cola -> sync`.
- [x] Procedimiento manual en móvil documentado y diferido por decisión de producto.
- [x] Smoke test offline: entrar, revisar cartera descargada, registrar cobro, ver cola.
- [x] Smoke test online: sincronizar y ver confirmación.
- [x] Validación de lista/cartera con dataset grande o simulado sin bloqueo serio de UI.
- [x] Presupuesto local de runtime y bundle inicial versionado en `npm run test:perf`.
- [x] Verificar navegación y estados principales sin errores de consola.
- [x] `npm run check` pasa.

### Criterio de salida

- [x] Flujo mínimo de cobrador operable.
- [x] Estados críticos visibles.
- [x] UI preparada para uso móvil real con evidencia automatizada suficiente para el cierre activo; la validación manual queda diferida y documentada.

## Fase 5: Despliegue y operación

### Resultado esperado

Dejar el circuito GitHub -> Vercel -> Supabase controlado y repetible.

### Dependencias

- [x] Fase 4 completada para el alcance activo.

### Checklist de ejecución

- [ ] Configurar variables de entorno en Vercel.
- [ ] Validar build y preview por rama.
- [ ] Confirmar políticas de despliegue y rollback.
- [x] Documentar operación y debugging básico en `docs/deployment-runbook.md`.
- [ ] Definir ruta de impresión Bluetooth o integraciones equivalentes si entra en alcance.
- [x] Preparar checklist de release en `docs/release-checklist.md`.

### Artefactos obligatorios

- [ ] Deploy reproducible.
- [x] Checklist de release.
- [x] Guía operativa básica para incidentes comunes.

### Tests de compuerta

- [ ] `npm run build` pasa en entorno de CI o equivalente.
- [ ] Preview deployment funcional por rama.
- [ ] Smoke test en preview:
  - login,
  - lectura de datos,
  - registro de pago controlado,
  - estado de sync.
- [ ] Variables de entorno auditadas sin exponer secretos en cliente.
- [ ] Rollback documentado y probado al menos a nivel de procedimiento.

### Criterio de salida

- [ ] Pipeline de deploy controlado.
- [ ] Operación básica documentada.
- [ ] Release repetible sin improvisación.

## Subplan de cierre contra referentes

### Propósito

Este subplan depende del tablero maestro y no lo reemplaza.

- Su objetivo es cerrar las brechas identificadas frente a `CobrApp` y `PrestaBIT`.
- No autoriza cerrar Fase 4 o Fase 5 sin sus compuertas oficiales.
- El detalle funcional de estado actual sigue viviendo en `docs/phase-control.md`.
- Si una subfase toca Auth, RLS, SQL, RPC, Storage o sync remoto, debe ejecutarse usando el skill `supabase`.

### Orden recomendado de implementación

1. `BR-1` Validación móvil real y rendimiento percibido.
2. `BR-2` Rutas formales y gestión de visita remota.
3. `BR-3` Recibo autoritativo y preparación de impresión Bluetooth.
4. `BR-4` Roles end-to-end y reportes operativos.
5. `BR-5` Reverso transaccional y pruebas negativas de concurrencia.
6. `BR-6` Motor financiero V2: abonos dirigidos e interés compuesto.

### BR-1. Validación móvil real y rendimiento percibido

#### Resultado esperado

Dejar una compuerta reproducible de rendimiento móvil y un procedimiento manual versionado sin bloquear el cierre activo cuando producto decida diferir la validación física.

Nota de alcance vigente:

- La validación manual en dispositivo real queda diferida por decisión de producto y no bloquea el cierre activo del roadmap mientras esa decisión siga vigente.
- GPS queda diferido por decisión de producto y no bloquea el cierre activo de esta línea mientras esa decisión siga vigente.

#### Funciones incluidas

- login persistido en móvil,
- bootstrap de cartera real comparable,
- navegación táctil cartera -> detalle -> operación,
- cobro offline y resync online,
- percepción de velocidad con cartera real,
- reducción del riesgo del chunk principal actual.

#### Implementación mínima

- mantener versionado el procedimiento manual para futura ejecución en dispositivo físico,
- registrar en `docs/audit-report.md` y `docs/session-handoff.md` que la validación manual quedó diferida,
- medir tiempos de bootstrap, búsqueda y apertura de detalle con cartera real,
- dividir o diferir carga del frontend si el bundle sigue penalizando móvil,
- dejar presupuesto inicial de bundle y criterio de regresión documentado.

#### Tests y compuertas requeridas

- mantener verdes:
  - `npm run test:phase4`
  - `npm run test:perf`
  - `scripts/phase4-auth-user.mjs`
  - `scripts/phase4-mobile-smoke.mjs`
  - `npm run check`
- conservar documentado:
  - `docs/phase4-manual-validation.md`
  - caso GPS con permiso aceptado,
  - caso GPS con permiso denegado,
  - cartera real comparable en dispositivo físico.
- compuerta versionada vigente:
  - `npm run test:perf` para presupuesto de bundle y guardas de rendimiento local.
- baseline inicial medido en esta sesión:
  - `javascript entry`: `372550` bytes raw / `116415` bytes gzip,
  - `css entry`: `23707` bytes raw / `5068` bytes gzip,
  - `entry total`: `396257` bytes raw / `121483` bytes gzip,
  - `operational runtime async`: `207610` bytes raw / `53530` bytes gzip.

#### Criterio de salida

- Rendimiento local medible y reproducible.
- Procedimiento manual versionado y diferido sin abrir una deuda ambigua de proceso.
- Warning de rendimiento convertido en compuerta medible y chunk inicial por debajo del warning anterior de `500 kB`.

### BR-2. Rutas formales y gestión de visita remota

#### Resultado esperado

Dejar de depender de derivaciones locales temporales para rutas y de gestión solo local de visitas.

#### Funciones incluidas

- entidad remota de rutas o equivalente persistido,
- asignación formal de cliente a ruta/cobrador,
- sincronización remota de `collection_actions`,
- lectura operativa de rutas desde backend,
- continuidad offline para gestión de visita.

#### Implementación mínima

- definir modelo remoto de rutas y su fuente de verdad,
- decidir si la ruta vive en `customers`, en una tabla `routes`, o en una relación dedicada,
- crear write path controlado para gestión de visita con trazabilidad,
- extender IndexedDB y sync solo después de fijar el contrato remoto,
- actualizar `collector-workspace.ts` para hidratar rutas y últimas gestiones remotas.

#### Tests y compuertas requeridas

- crear SQL gates:
  - `supabase/tests/phase4_routes_gate.sql`
  - `supabase/tests/phase4_collection_actions_gate.sql`
- cubrir casos:
  - un cobrador solo lee rutas y gestiones dentro de su alcance,
  - un admin puede ver alcance permitido sin debilitar RLS,
  - una gestión remota no duplica evento al reintentar,
  - una gestión offline pendiente reconcilia correctamente al sincronizar.
- crear o ampliar tests frontend/sync:
  - `src/lib/collector/collector-workspace.test.ts`
  - `src/lib/collector/collector-route-board.test.ts`
  - nuevo `src/lib/sync/collection-action-sync.test.ts`
- ampliar smoke móvil para incluir:
  - filtro por ruta formal,
  - creación de gestión,
  - resync de gestión pendiente.

#### Criterio de salida

- La ruta deja de ser provisional local.
- Gestión de visita deja de ser memoria exclusiva del dispositivo.
- RLS y sync de rutas/gestiones quedan probados.

### BR-3. Recibo autoritativo y preparación de impresión Bluetooth

#### Resultado esperado

El recibo visible por UI debe representar un pago confirmado por servidor y no solo un estado local optimista.

#### Funciones incluidas

- recibo autoritativo ligado a `remotePaymentId`,
- detalle de aplicaciones por cuota en el comprobante,
- estado de sincronización claro entre recibo local y recibo confirmado,
- estrategia de impresión Bluetooth o integración equivalente.

#### Implementación mínima

- definir contrato de recibo remoto,
- exponer consulta o vista segura para renderizar comprobante confirmado,
- separar `recibo local pendiente` de `recibo confirmado`,
- evaluar integración Bluetooth objetivo antes de escribir adapter definitivo,
- documentar si la impresión se resuelve por Web Bluetooth, bridge nativo o flujo externo.

#### Tests y compuertas requeridas

- crear SQL gate:
  - `supabase/tests/phase5_receipt_gate.sql`
- crear tests frontend:
  - `src/lib/receipts/receipt-mapper.test.ts`
  - `src/lib/receipts/receipt-status.test.ts`
- si entra Bluetooth:
  - `src/lib/receipts/bluetooth-printer.test.ts`
  - smoke manual con impresora real soportada.
- ampliar smoke funcional:
  - registrar pago,
  - sincronizar,
  - abrir recibo confirmado,
  - verificar que el comprobante usa `remotePaymentId` y datos remotos coherentes.

#### Criterio de salida

- El usuario distingue recibo pendiente vs confirmado.
- Existe comprobante consistente con la transacción remota.
- La ruta Bluetooth queda implementada o descartada con decisión explícita documentada.

### BR-4. Roles end-to-end y reportes operativos

#### Resultado esperado

Completar la separación funcional entre `admin` y `collector`, y abrir la primera capa de reportes visibles.

#### Funciones incluidas

- vistas por rol,
- restricciones de UI alineadas con RLS,
- reportes operativos mínimos,
- métricas de cartera, cobro del día, mora y sync,
- filtros por cobrador, ruta y estado cuando aplique.

#### Implementación mínima

- definir navegación y permisos visibles por rol,
- crear consultas o vistas seguras para reportes,
- mantener la fuente de verdad remota en Supabase,
- evitar que reportes abran bypass de RLS o dependan de DML inseguro.

#### Tests y compuertas requeridas

- crear SQL gates:
  - `supabase/tests/phase5_roles_gate.sql`
  - `supabase/tests/phase5_reports_gate.sql`
- cubrir casos:
  - collector no ve reportes globales,
  - admin ve vista total autorizada,
  - un usuario inactivo no entra a vistas operativas ni reportes.
- crear tests UI:
  - `src/lib/auth/role-guards.test.ts`
  - `src/lib/reports/report-queries.test.ts`
  - `src/lib/reports/report-mappers.test.ts`
- crear smoke por rol:
  - login como collector,
  - login como admin,
  - validación de vistas permitidas y denegadas.

#### Criterio de salida

- Los dos roles operativos existen end-to-end en backend y frontend.
- Hay reportes mínimos comparables con el baseline actual.
- Ningún reporte debilita seguridad o alcance.

### BR-5. Reverso transaccional y concurrencia negativa

Estado actual:

- Contrato base cerrado en `LANDING` con `public.reverse_payment()`, `supabase/tests/phase6_reverse_payment_gate.sql` y `scripts/phase6-reversal-concurrency-smoke.mjs`.

#### Resultado esperado

Agregar capacidad profesional de reverso sin romper atomicidad, trazabilidad ni saldos.

#### Funciones incluidas

- RPC de reverso,
- evento de auditoría del reverso,
- recalculo de cuotas y préstamo,
- control por rol para reversar,
- pruebas negativas de concurrencia y repetición.

#### Implementación mínima

- diseñar contrato `reverse_payment`,
- decidir quién puede reversar y bajo qué condiciones,
- registrar evento compensatorio explícito,
- evitar reversos duplicados o parciales inconsistentes,
- extender la documentación financiera y de base de datos.

#### Tests y compuertas requeridas

- crear SQL gate:
  - `supabase/tests/phase6_reverse_payment_gate.sql`
- cubrir casos:
  - reverso válido,
  - reverso duplicado,
  - reverso sin permisos,
  - reverso sobre pago inexistente,
  - restauración correcta de saldos,
  - concurrencia de dos sesiones intentando operar el mismo pago.
- crear tests de dominio/UI:
  - `src/lib/finance/payment-reversal.test.ts`
  - `src/lib/sync/payment-reversal-sync.test.ts` si existe cola offline para reversos.

#### Criterio de salida

- Reverso trazable e idempotente.
- Saldos restaurados sin corrupción.
- Permisos y concurrencia cubiertos por compuertas negativas.

### BR-6. Motor financiero V2: abonos dirigidos e interés compuesto

Estado actual:

- Contrato V2 ya versionado en `docs/financial-contract-v2.md`, `payment-contract-v2.ts`, `payment-planning-v2.ts` y `compound-interest.ts`.
- `LANDING` ya opera coexistencia V1/V2 con `compound_fixed_installment`, `payment_application_mode` y saldos por componente materializados como fuente remota de verdad.
- Las compatibilidades críticas ya quedaron revalidadas con `supabase/tests/phase6_financial_v2_gate.sql`, `supabase/tests/phase2_record_payment_gate.sql`, `supabase/tests/phase6_reverse_payment_gate.sql` y `supabase/tests/phase7_origination_security_gate.sql`.
- Los ajustes `phase6_restore_reverse_payment_contract_compat` y `phase7_restore_origination_rls_initplan` cerraron la deriva de contrato visible y el `WARN` nuevo del advisor sin cambiar permisos.

#### Resultado esperado

Extender el motor actual para competir con el baseline más flexible sin romper la V1 ya validada.

#### Funciones incluidas

- abonos dirigidos a capital,
- abonos dirigidos a interés,
- cuotas fijas cuando aplique,
- interés compuesto cuando la cartera lo requiera,
- coexistencia controlada entre V1 y V2.

#### Implementación mínima cerrada

- publicar `docs/financial-contract-v2.md`,
- definir `interest_mode` y `payment_application_mode` por préstamo,
- evitar mezclar reglas V1 y V2 en un mismo path sin discriminación explícita,
- ampliar preview, payload y RPC según el nuevo contrato manteniendo verde la coexistencia heredada.

#### Tests y compuertas ejecutadas

- unit tests:
  - `src/lib/finance/payment-contract-v2.test.ts`
  - `src/lib/finance/payment-planning-v2.test.ts`
  - `src/lib/finance/compound-interest.test.ts`
- SQL gates:
  - `supabase/tests/phase6_financial_v2_gate.sql`
  - `supabase/tests/phase2_record_payment_gate.sql`
  - `supabase/tests/phase6_reverse_payment_gate.sql`
  - `supabase/tests/phase7_origination_security_gate.sql`
- cobertura efectiva:
  - abono dirigido solo a capital,
  - abono dirigido solo a interés,
  - préstamo V1 sigue comportándose igual sobre el esquema ampliado,
  - interés compuesto calcula saldo esperado,
  - rechazo de payload que mezcla reglas incompatibles,
  - originación y reverso siguen operando sin romper RLS ni ACID.

#### Estado de cierre

- V2 convive con V1 sin regresiones.
- El backend valida de forma explícita el modo financiero activo.
- La UI puede exponer el tipo de abono permitido de forma gradual sin volver a tocar SQL ni contratos de base.

### Matriz resumida de brechas, fases y pruebas

| Brecha | Subfase dueña | Prueba mínima obligatoria |
| --- | --- | --- |
| Validación móvil real | `BR-1` | `docs/phase4-manual-validation.md` como procedimiento diferido por decisión de producto |
| GPS con degradación segura | `Diferido` | No bloquea el cierre actual mientras siga fuera de alcance |
| Rendimiento móvil / bundle | `BR-1` | `npm run test:perf` + `npm run check` |
| Rutas formales | `BR-2` | `supabase/tests/phase4_routes_gate.sql` + `collector-route-board.test.ts` |
| Gestión de visita remota | `BR-2` | `supabase/tests/phase4_collection_actions_gate.sql` + `collection-action-sync.test.ts` |
| Recibo autoritativo | `BR-3` | `supabase/tests/phase5_receipt_gate.sql` + `scripts/phase5-receipt-pdf-smoke.ts` |
| Impresión Bluetooth | `BR-3` | Test del adapter + smoke manual con impresora real si entra al alcance |
| Roles end-to-end | `BR-4` | `supabase/tests/phase5_roles_gate.sql` + smoke por rol |
| Reportes operativos | `BR-4` | `supabase/tests/phase5_reports_gate.sql` + tests de queries/mappers |
| Reverso de pagos | `BR-5` | `supabase/tests/phase6_reverse_payment_gate.sql` |
| Prueba negativa de concurrencia | `BR-5` | `supabase/tests/phase6_reverse_payment_gate.sql` + `scripts/phase6-reversal-concurrency-smoke.mjs` |
| Abonos dirigidos | `BR-6` | `payment-contract-v2.test.ts` + `phase6_financial_v2_gate.sql` |
| Interés compuesto | `BR-6` | `compound-interest.test.ts` + `phase6_financial_v2_gate.sql` |

## Registro mínimo por fase

Al cerrar cada fase debe quedar en `docs/session-handoff.md`:

- fase cerrada,
- fecha,
- tests ejecutados,
- tests no ejecutados,
- bloqueos remanentes,
- siguiente fase habilitada.

## Regla transversal

Ninguna fase se considera completa si:

- cambia lógica crítica sin comentarios,
- cambia arquitectura sin actualizar `docs/`,
- toca Supabase sin respetar los skills instalados,
- cierra con validación incompleta no documentada.
