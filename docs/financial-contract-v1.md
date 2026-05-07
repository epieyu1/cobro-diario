# Financial Contract V1

## Proposito

Este documento fija la primera version operativa del contrato financiero de `Cobro Diario`.
Su objetivo es dejar decisiones ejecutables para backend, frontend, sync y reporting, evitando
que cada asistente interprete el cobro diario de forma distinta.

## Estado

- Version: `v1`
- Fecha base: `2026-05-05`
- Alcance: cobro operativo para cartera diaria en Colombia
- Moneda base: `COP`
- Timezone de negocio V1: `America/Bogota`

## Principios

- PostgreSQL/Supabase es la fuente final de verdad del cobro.
- El frontend y la cola offline materializan el reparto del pago, pero no son la autoridad final.
- `record_payment` recibe aplicaciones ya construidas y valida coherencia, alcance, estados e idempotencia.
- Ningun pago entra al backend como “monto libre sin destino”; todo pago debe llegar distribuido por cuota.

## Modelo financiero V1

### Tipo de interes soportado

- V1 soporta interes simple ya materializado en la cuota.
- `interest_rate_daily` describe la configuracion del prestamo y sirve para originacion/reportes.
- V1 no recalcula interes compuesto en `record_payment`.
- Si una cartera requiere interes compuesto real, se considera alcance de V2 y exige cambio de contrato.

### Moneda y redondeo

- Todas las operaciones monetarias usan 2 decimales.
- Regla de redondeo oficial: `HALF_UP`.
- Toda suma o normalizacion monetaria debe pasar por helpers comunes de `money.ts`.
- La UI puede ocultar visualmente `,00` en COP cuando los centavos son exactamente cero, pero almacenamiento, calculo y RPC siguen operando con 2 decimales.
- La UI debe mostrar `COP` como codigo visible y no solo como simbolo `$`, para evitar ambiguedad en reportes, recibos y cartera operativa.
- Si un transporte o cache entrega `cop` o variantes de casing, la capa de formato visible debe normalizarlo a `COP` antes de resolver la politica visual.

### Contrato de originacion V1

- V1 de originacion usa `installment_amount` como dato de entrada; no deriva una cuota nueva desde `principal_amount`.
- `total_scheduled_amount = installment_amount * total_installments`.
- Si `total_scheduled_amount < principal_amount`, la originacion debe rechazarse.
- `total_interest_amount = total_scheduled_amount - principal_amount`.
- El interes materializado se reparte de forma uniforme entre cuotas y cualquier residuo por redondeo queda en la ultima cuota.
- Cada cuota nace con:
  - `scheduled_amount = installment_amount`
  - `fee_amount = 0`
  - `outstanding_amount = scheduled_amount`
  - `status = pending`
- El prestamo confirmado por `originate_loan` nace en `active`.
- `first_due_date` no puede ser anterior a `disbursement_date`.
- El calculo de fechas usa reglas calendario fijas:
  - `daily`: `1` dia por cuota
  - `weekly`: `7` dias por cuota
  - `biweekly`: `15` dias por cuota
  - `monthly`: `1` mes conservando el dia ancla y ajustando al ultimo dia valido del mes si hace falta
- Fuente de verdad del cronograma:
  - `private.build_origination_schedule()` en PostgreSQL genera la version canonica,
  - `src/lib/finance/origination-schedule.ts` solo puede previsualizar esa misma regla,
  - y `public.originate_loan()` rechaza cualquier preview materializada que no coincida exactamente.

### Abonos libres

- V1 soporta abonos libres.
- Un abono libre significa que el operador puede ingresar un monto menor, igual o mayor al valor de una cuota.
- Ese monto debe transformarse antes del RPC en una o varias `payment_applications`.
- El backend no decide a qué cuotas aplicar “sobrantes”; rechaza pagos sin distribución materializada.

### Orden de aplicación del pago

#### Entre cuotas

- El flujo recomendado V1 aplica primero a cuotas vencidas.
- Entre cuotas vencidas, se aplica por `due_date` ascendente.
- Si no hay cuotas vencidas pendientes, se aplica por `due_date` ascendente sobre cuotas futuras/pendientes.
- V1 no soporta saltar una cuota más antigua para abonar una más nueva dentro del flujo normal.

#### Dentro de una cuota

El orden obligatorio de aplicación es:

1. `fee_component`
2. `interest_component`
3. `principal_component`

Implicaciones:

- No se puede aplicar capital mientras exista interés pendiente en esa cuota.
- No se puede aplicar interés mientras exista `fee_component` pendiente en esa cuota.
- `fee_component` es el bucket temporal de mora y otros cargos no separados todavía.

### Mora

- V1 considera mora dentro de `fee_component`.
- No existe todavía una tabla separada de mora ni una columna diferenciada por tipo de cargo.
- Una cuota se considera vencida si:
  - `due_date < business_date`
  - y `outstanding_amount > 0`
- `business_date` se calcula con timezone `America/Bogota` a partir de `paid_at`.

### Estados de cuota

Una cuota queda:

- `paid` si `outstanding_amount = 0`
- `overdue` si `outstanding_amount > 0` y `due_date < business_date`
- `partial` si `outstanding_amount > 0`, `due_date >= business_date` y ya recibió abono
- `pending` si conserva su valor completo y no está vencida
- `canceled` queda fuera de cobro

### Estados de préstamo

Un préstamo queda:

- `settled` si no tiene cuotas con saldo
- `delinquent` si tiene al menos una cuota vencida con saldo
- `active` si aún tiene saldo pero ninguna cuota vencida
- `draft`, `written_off` y `canceled` no son estados pagables por V1

### Idempotencia

- `device_local_id` identifica un intento de cobro único.
- Reintentar exactamente el mismo cobro debe devolver el mismo `payment.id`.
- "Exactamente el mismo cobro" incluye el mismo `loan_id`, `customer_id`, `collector_id`, `paid_at`, `payment_reference`, metadata operativa y el mismo arreglo de `applications` con sus componentes.
- Reutilizar el mismo `device_local_id` para otro préstamo, cliente o payload debe fallar.

### Reversos

- V1 no permite borrar pagos.
- El reverso debe ser trazable y operar como compensación explícita.
- `public.reverse_payment(payment_id, reversal_reason)` ya implementa el contrato base de `BR-5`.
- Reglas activas del reverso V1:
  - solo un `admin` activo puede reversar un pago confirmado;
  - el motivo del reverso es obligatorio mientras el pago siga `posted`;
  - el reverso marca `payments.status = reversed` y conserva `reversed_at`, `reversed_by` y `reversal_reason`;
  - el backend restaura saldos de cuotas desde `payment_applications` en la misma transacción;
  - el backend recalcula estado de cuota y préstamo con `America/Bogota` como fecha de negocio;
  - el evento compensatorio queda trazado en `payment_events` como `payment_reversed`;
  - reintentar el mismo reverso sobre un pago ya `reversed` devuelve el mismo comprobante autoritativo y no duplica eventos.
- Restricción de alcance:
  - el reverso es `online-only`; no existe cola offline para compensaciones.

### Segmentacion por cartera o inversionista

- V1 procesa cada prestamo dentro de una sola cartera operativa.
- No existe reparto activo de un mismo pago entre multiples inversionistas.
- Si el negocio necesita multipropiedad o participaciones por inversionista:
  - debe modelarse una entidad dedicada,
  - debe redefinirse el contrato de originacion y cobro,
  - y no puede introducirse como cambio silencioso sobre `record_payment`.

### GPS y evidencia operativa

- `latitude` y `longitude` son opcionales a nivel técnico.
- Si el dispositivo entrega ubicación y el flujo de producto la exige, deben conservarse en el pago.
- La ausencia de GPS no debe romper la atomicidad del cobro.

### Metadatos operativos obligatorios

Campos obligatorios del contrato de cobro:

- `device_local_id`
- `collector_id`
- `customer_id`
- `loan_id`
- `paid_at`
- `applications`

Campos recomendados pero no bloqueantes en V1:

- `device_id`
- `payment_method`
- `notes`

Campos opcionales o diferidos por producto:

- GPS: capturar si el dispositivo lo entrega; su ausencia no invalida el RPC.
- ruta: V1 no persiste una entidad de ruta dedicada dentro del pago.
- `payment_reference`: opcional, util para correlacion operativa o recibos.
- recibo: V1 no exige comprobante digital o Bluetooth para aceptar el cobro.

## Ejemplos canónicos

### Caso 1: pago parcial de una cuota no vencida

Cuota:

- `fee = 0`
- `interest = 10_000`
- `principal = 40_000`
- `outstanding = 50_000`

Pago libre: `15_000`

Distribución válida:

- `fee_component = 0`
- `interest_component = 10_000`
- `principal_component = 5_000`

### Caso 2: cuota vencida con mora

Cuota:

- `fee = 8_000`
- `interest = 12_000`
- `principal = 30_000`
- `outstanding = 50_000`

Pago libre: `20_000`

Distribución válida:

- `fee_component = 8_000`
- `interest_component = 12_000`
- `principal_component = 0`

Distribución inválida:

- `fee_component = 0`
- `interest_component = 12_000`
- `principal_component = 8_000`

Motivo: se intentó saltar mora.

### Caso 3: pago que cubre varias cuotas

Pago libre: `90_000`

Resultado esperado:

- agota primero la cuota vencida más antigua,
- luego continúa con la siguiente cuota por orden de vencimiento,
- cada cuota viaja como una aplicación separada.

## Implicaciones técnicas

### Frontend

- La UI debe poder mostrar al operador cómo se distribuyó el abono.
- La generación automática de aplicaciones debe obedecer el orden definido aquí.
- Si existe edición manual de componentes, debe validarse contra el mismo contrato.

### Sync offline

- La cola local debe persistir `applications` completas, no solo `totalAmount`.
- Los reintentos deben reutilizar el mismo `deviceLocalId`.

### Backend

- `record_payment` debe validar:
  - obligatoriedad de `paid_at`,
  - estado pagable del préstamo,
  - unicidad y conflicto de `device_local_id`,
  - ausencia de cuotas duplicadas en el mismo pago,
  - suma de componentes,
  - orden de cuota más antigua primero,
  - orden de aplicación por componente,
  - estado final de cuota y préstamo.
- Si una cuota llega parcialmente pagada pero solo conserva `outstanding_amount` y no todo su histórico,
  `record_payment` debe reconstruir `fee`, `interest` y `principal` pendientes desde el saldo actual
  siguiendo el orden `fee -> interest -> principal`; no debe rechazar una cuota válida solo por no tener
  `payment_applications` históricas materializadas en la misma base.

## Fuera de alcance de V1

- interés compuesto ejecutado en tiempo real al cobrar,
- múltiples reglas por cartera/inversionista ya implementadas en el motor,
- impresión Bluetooth ya implementada end-to-end.

## Regla de mantenimiento

Si cambia una de estas decisiones, deben actualizarse en el mismo cambio:

1. `docs/financial-contract-v1.md`
2. `src/lib/finance/payment-contract.ts`
3. `src/lib/finance/money.ts` si cambia redondeo/moneda
4. `record_payment` y sus migraciones SQL
5. `docs/implementation-plan.md`
