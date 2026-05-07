# Offline Sync

## Proposito

Este documento fija la estrategia operativa de sincronizacion offline de `Cobro Diario`
despues del cierre del contrato financiero V1. Su objetivo es evitar que futuros asistentes
reconstruyan la cola local con semanticas distintas a las del RPC `record_payment`.

## Principios

- IndexedDB es cache operativa y bitacora de reintentos; PostgreSQL sigue siendo la fuente final de verdad.
- La cola persiste el contrato completo del pago, no una cabecera resumida.
- `deviceLocalId` es la llave idempotente remota del pago.
- `clientEventId` es la llave estable del evento local dentro de la cola.
- La capa local aplica el efecto optimista del pago usando la misma semantica de negocio que el RPC.

## Componentes

### `payments`

La tabla local `payments` guarda:

- cabecera del cobro,
- `syncStatus`,
- `remotePaymentId` cuando el servidor confirma,
- ultimo error de sync cuando existe.

No reemplaza `payment_applications` remotas ni el historial transaccional del backend.

### `syncQueue`

La cola local `syncQueue` guarda:

- `clientEventId`
- `entityName = payment`
- `entityId = deviceLocalId`
- `payload` completo del `PaymentDraft` ya normalizado
- estado de sync
- contadores y metadatos de intento/error

## Estados de cola

- `pending`: listo para enviar.
- `processing`: intento en curso.
- `failed`: hubo error; requiere reintento automatico o manual segun clasificacion.
- `synced`: confirmado por remoto.

## Flujo operativo

1. La UI construye un `PaymentDraft`.
2. `enqueueOfflinePayment` normaliza el payload.
3. La misma operacion aplica el pago sobre cuotas y prestamo locales en IndexedDB.
4. La cola persiste el mismo payload para replay posterior.
5. `flushPaymentSyncQueue` envia los items `pending` al adaptador remoto.
6. Si `record_payment` confirma:
   - el item pasa a `synced`
   - `payments.remotePaymentId` queda registrado
   - `payments.syncedAt` queda sellado
7. Si falla:
   - el item pasa a `failed`
   - se guarda `lastErrorCode`, `lastErrorKind` y `lastErrorMessage`
   - el estado local optimista no se borra en silencio

## Reglas de reconciliacion

- La reconciliacion local se hace al registrar el pago offline, no despues.
- Esto es valido porque la cola usa el mismo contrato V1 que `record_payment`.
- Un sync exitoso confirma metadata remota; no vuelve a recalcular saldos locales.
- Si hay conflicto de negocio remoto, la app debe mostrar divergencia y ofrecer reintento o revision operativa.

## Clasificacion de errores

### `retryable`

Errores de red, sesion o transporte. El pago puede reintentarse sin cambiar payload.

### `conflict`

Errores de contrato o alcance como:

- `loan_status_not_payable`
- `device_local_id_conflict`
- `application_order_violation`
- `installment_order_violation`

Estos casos no deben ocultarse bajo reintentos automáticos ciegos.

## GPS y evidencia

- GPS viaja dentro del payload local cuando existe.
- La ausencia de GPS no bloquea enqueue ni sync.
- `paymentReference`, `notes` y `deviceId` se conservan para correlacion operativa.

## Tests de compuerta actuales

- enqueue offline deja `payments` y `syncQueue` consistentes
- cerrar y reabrir conserva la cola
- sync exitoso confirma exactamente un pago remoto por `deviceLocalId`
- reintento despues de fallo retryable no duplica el remoto
- conflicto remoto mueve el item a `failed`
- reconciliacion local de cuotas/prestamo queda estable despues del ack remoto

## Archivos fuente de verdad

1. `docs/financial-contract-v1.md`
2. `src/lib/sync/payment-sync.ts`
3. `src/lib/db/local-db.ts`
4. `src/lib/finance/payment-contract.ts`
5. `supabase/tests/phase2_record_payment_gate.sql`
