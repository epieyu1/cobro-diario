# Control de Brechas Funcionales

Este archivo no reemplaza `docs/implementation-plan.md`.

- Fuente de verdad de roadmap y compuertas: `docs/implementation-plan.md`
- Fuente de verdad funcional complementaria: `docs/phase-control.md`
- Fuente de verdad UI operativa: `docs/operational-ui.md`
- Fuente de verdad de seguridad y ACID: `docs/database-control.md`
- Fuente de verdad de terminología visible: `docs/terminology-guide.md`

## Objetivo

Controlar la implementacion de funciones faltantes sin abrir un plan paralelo ni perder el orden
del roadmap maestro.

Este control existe para responder una necesidad operativa puntual del repositorio:

- dejar visible que brecha estamos atacando ahora,
- separar lo ya implementado de lo que sigue pendiente,
- congelar decisiones de alcance para no mezclar BRs en la misma entrega,
- y mantener foco mobile-first en cada cambio de frontend.

## Regla de uso

- Este archivo es complementario.
- No autoriza cerrar Fase 4 ni Fase 5 por fuera de sus gates oficiales.
- Si un punto contradice `docs/implementation-plan.md`, manda el tablero maestro.

## Estado operativo actual

- `BR-1` queda diferido como procedimiento manual.
  La validación móvil real no forma parte del cierre activo por decisión explícita de producto y ya no bloquea Fase 4 ni Fase 5.
- Decisión vigente para esta línea de trabajo:
  GPS queda diferido por instrucción explícita del usuario y no forma parte del cierre activo de esta línea.
- La primera implementación activa sobre funciones faltantes arrancó en `BR-2`, comenzando por la formalización remota de rutas.
- Primer corte ya implementado y revalidado en `LANDING`:
  `customers.route_label` y `collection_actions` ya quedaron aplicados en remoto con compuertas SQL verdes.
- Segundo corte ya implementado y revalidado en `LANDING`:
  `public.get_payment_receipt()` ya quedó aplicado con compuerta SQL verde, la UI ya distingue recibo local vs confirmado y Bluetooth quedó documentado como decisión diferida.
- Tercer corte ya implementado y revalidado en `LANDING`:
  `public.get_operational_report()` ya quedó aplicado con compuertas SQL verdes, la shell ya resuelve capacidades por rol y el panel de reportes quedó visible solo para el rol `admin` (administrador).
- Cuarto corte ya implementado y revalidado en `LANDING`:
  `public.reverse_payment()` ya quedó aplicado con compuerta SQL verde, smoke concurrente real `admin -> reverse_payment x2` en verde y la UI ya distingue comprobante confirmado vs reversado.
- Quinto corte ya implementado y revalidado en `LANDING`:
  `docs/financial-contract-v2.md`, `compound-interest.ts`, `payment-contract-v2.ts`, `payment-planning-v2.ts`, `public.originate_loan()`, `public.record_payment()` y `public.reverse_payment()` ya sostienen coexistencia V1/V2 con `phase6_financial_v2_gate.sql`, `phase2_record_payment_gate.sql`, `phase6_reverse_payment_gate.sql` y `phase7_origination_security_gate.sql` en verde.
- No queda una nueva brecha de código prioritaria dentro de este subplan:
  Fase 4 ya puede tratarse como cerrada para el alcance activo; fuera del repo solo persiste el `WARN` externo de Auth por `Leaked Password Protection`.

## Orden vigente de ejecución

1. `BR-1` Validación móvil real y rendimiento percibido.
   Estado: diferido por decisión de producto; `test:perf`, `check` y los smokes automatizados ya cubren el cierre activo.
2. `BR-2` Rutas formales y gestión de visita remota.
   Estado: completo para el contrato base actual.
3. `BR-3` Recibo autoritativo y preparación de impresión Bluetooth.
   Estado: completo para el contrato base; impresión física sigue diferida como integración dedicada.
4. `BR-4` Roles end-to-end y reportes operativos.
   Estado: completo para el contrato base actual.
5. `BR-5` Reverso transaccional y pruebas negativas de concurrencia.
   Estado: completo para el contrato base actual.
6. `BR-6` Motor financiero V2.
   Estado: completo para el contrato base actual; la habilitación comercial en UI puede dosificarse por alcance de producto sin reabrir SQL ni ACID.

## Corte cerrado de BR-2

### Subbrechas

| Subbrecha | Estado | Criterio de salida |
| --- | --- | --- |
| `route_label` remoto para clientes | Completo | bootstrap, originación y tablero de ruta leen la misma fuente remota |
| compuerta SQL de rutas formales | Completo | `supabase/tests/phase4_routes_gate.sql` ya pasó contra `LANDING` con `ROLLBACK` |
| sync remoto de `collection_actions` | Completo | la gestión ya encola, reintenta y rehidrata remoto sin perder continuidad offline |
| compuerta SQL de gestiones remotas | Completo | `supabase/tests/phase4_collection_actions_gate.sql` ya pasó contra `LANDING` con `ROLLBACK` |

### Decisiones congeladas

- La UI móvil sigue siendo el caso principal; cualquier campo nuevo debe entrar cómodo en teléfono.
- `route_label` se implementa como fuente remota vigente dentro de `public.customers` mientras no exista una tabla dedicada de rutas.
- `neighborhood` no desaparece: queda como contexto geográfico y fallback de compatibilidad.
- `collection_actions` usa `device_local_id` como llave de idempotencia y mantiene el write path cerrado a un RPC dedicado.

## Corte cerrado de BR-3

### Subbrechas

| Subbrecha | Estado | Criterio de salida |
| --- | --- | --- |
| recibo remoto por `remotePaymentId` | Completo | la UI ya consulta `public.get_payment_receipt()` y no trata el pago local como comprobante final |
| estado visible `local vs confirmado` | Completo | el panel `Recibo` ya diferencia pendiente, en envío, con error, sync incompleto y confirmado |
| compuerta SQL de recibo autoritativo | Completo | `supabase/tests/phase5_receipt_gate.sql` ya pasó contra `LANDING` con `ROLLBACK` |
| exportación PDF del recibo confirmado | Completo | `receipt-pdf.ts` genera bytes PDF reales desde el contrato confirmado y `scripts/phase5-receipt-pdf-smoke.ts` ya lo revalidó con pago real en `LANDING` |
| preparación Bluetooth con decisión explícita | Completo | `src/lib/receipts/bluetooth-printer.ts` deja Web Bluetooth documentado como gate manual futuro, sin fingir adapter productivo |

### Decisiones congeladas

- `remotePaymentId` es la llave de lectura del comprobante confirmado; no reconstruir recibos desde `totalAmount` local.
- El backend devuelve el desglose por cuota como fuente de verdad del comprobante; IndexedDB sigue siendo caché operativa.
- El snapshot operativo enriquecido del recibo puede leerse del `loanCard` activo, pero debe presentarse separado del comprobante confirmado para no confundir fuente de verdad del pago con estado actual de cartera.
- Bluetooth no se marca implementado: queda documentado como decisión técnica diferida hasta validar hardware real.

## Corte cerrado de BR-4

### Subbrechas

| Subbrecha | Estado | Criterio de salida |
| --- | --- | --- |
| guards visibles por rol en frontend | Completo | el rol `collector` (cobrador) no ve panes administrativos/reportes y `admin` (administrador) conserva las vistas operativas ampliadas sin duplicar shell |
| RPC seguro de reportes operativos | Completo | `public.get_operational_report()` ya corre con `SECURITY INVOKER`, filtros controlados y alcance alineado a RLS |
| compuerta SQL de roles end-to-end | Completo | `supabase/tests/phase5_roles_gate.sql` ya pasó contra `LANDING` con `ROLLBACK` |
| compuerta SQL de reportes operativos | Completo | `supabase/tests/phase5_reports_gate.sql` ya pasó contra `LANDING` con `ROLLBACK` |
| panel de reportes mobile-first | Completo | la UI ya expone métricas, filtros y salud de sincronización local sin romper el presupuesto del shell inicial |

### Decisiones congeladas

- `src/lib/auth/role-guards.ts` es la capa visible de permisos del shell; no repartir comparaciones de `profile.role` por la UI.
- El reporte remoto se consume por RPC y no por vistas SQL abiertas, para no introducir bypass de RLS.
- La tarjeta de salud de sync sigue leyendo IndexedDB porque la cola local es caché operativa del dispositivo; no fingirla como dato remoto autoritativo.
- El rol `admin` (administrador) ve `Originacion` y `Reportes`; `collector` (cobrador) no debe ver entradas que el backend le negaría de todos modos.

## Corte cerrado de BR-5

### Subbrechas

| Subbrecha | Estado | Criterio de salida |
| --- | --- | --- |
| RPC transaccional de reverso | Completo | `public.reverse_payment()` restaura saldos, recalcula préstamo y deja trazabilidad en la misma transacción |
| recibo autoritativo con estado `reversed` | Completo | `public.get_payment_receipt()` y la UI ya exponen metadatos de reverso sin fingir reconstrucción local |
| compuerta SQL de reverso | Completo | `supabase/tests/phase6_reverse_payment_gate.sql` ya pasó contra `LANDING` con `ROLLBACK` |
| smoke real de concurrencia multi-sesión | Completo | `scripts/phase6-reversal-concurrency-smoke.mjs` ya pasó con dos sesiones `admin` y un solo `payment_reversed` |

### Decisiones congeladas

- El reverso es solo con conexión; no abrir cola offline para compensaciones mientras PostgreSQL siga siendo la única fuente de verdad del saldo restaurado.
- El comprobante reversado sigue leyéndose por `remotePaymentId`; no reconstruir estados de reverso desde IndexedDB.
- La UI solo expone reverso sobre recibos remotos confirmados y para sesiones `admin` activas.
- La idempotencia del reverso vive en el estado remoto del pago y en el evento compensatorio único; no inventar una segunda llave local paralela.

## Evidencia mínima que debe quedar por cada brecha

- cambios de código con comentarios alineados al comportamiento real,
- actualización de `docs/` si cambia flujo, fuente de verdad o contrato,
- validación local razonable,
- y registro del estado real en `docs/session-handoff.md`.
