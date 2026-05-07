# Financial Contract V2

## Proposito

Este documento fija el contrato vigente de `Cobro Diario` para `BR-6`.
Su objetivo es abrir abonos dirigidos e interes compuesto sin romper la V1 ya validada.

## Estado

- Version: `v2-remote-active`
- Fecha base: `2026-05-07`
- Alcance actual: contrato versionado localmente, aplicado en `LANDING` y revalidado con compuertas remotas
- Estado remoto actual: `LANDING` ya acepta `compound_fixed_installment`, `payment_application_mode` y saldos pendientes por componente mediante `public.originate_loan()`, `public.record_payment()` y `public.reverse_payment()`

## Principios

- PostgreSQL/Supabase sigue siendo la fuente final de verdad.
- V2 no reemplaza V1 por mutacion silenciosa; ambas versiones deben convivir con discriminacion explicita.
- Un prestamo V1 sigue usando `simple_precomputed` y reparto `oldest-first` con `fee -> interest -> principal`.
- Un prestamo V2 debe declarar su modo financiero y el tipo de abono permitido antes de aceptar pagos.

## Modos financieros

### 1. `simple_precomputed`

- Es la V1 ya activa.
- La cuota se materializa desde originacion y no recalcula interes compuesto al cobrar.

### 2. `compound_fixed_installment`

- Introduce interes compuesto por periodo.
- La cuota base se calcula por descuento de flujos desde `interest_rate_daily` y la secuencia real de vencimientos.
- Todas las cuotas intentan mantener el mismo valor visible.
- La ultima cuota puede absorber un residuo de redondeo para cerrar saldo exactamente.

## Modos de abono

### 1. `oldest_first`

- Mantiene la semantica V1.
- Dentro de cada cuota aplica `fee -> interest -> principal`.

### 2. `principal_only`

- Solo aplica capital.
- `interest_component` y `fee_component` deben quedar en `0.00`.
- La distribucion sigue siendo `oldest-first`, pero solo sobre saldo de capital pendiente.

### 3. `interest_only`

- Solo aplica interes.
- `principal_component` y `fee_component` deben quedar en `0.00`.
- La distribucion sigue siendo `oldest-first`, pero solo sobre saldo de interes pendiente.

## Reglas de coexistencia

- V1 y V2 no comparten el mismo contrato por inferencia.
- Una capa de negocio futura debe declarar al menos:
  - `interest_mode`
  - `payment_application_mode`
- `LANDING` ya persiste `outstanding_principal_amount`, `outstanding_interest_amount` y `outstanding_fee_amount` como fuente remota de verdad.
- La UI productiva puede seguir controlando la exposicion de V2 por flags o alcance comercial, pero el contrato remoto ya existe y no debe volver a inferirse desde `outstanding_amount`.

## Contrato implementado en este corte

- `src/lib/finance/compound-interest.ts`
  - calcula un cronograma `compound_fixed_installment` con residuo en la ultima cuota;
- `src/lib/finance/payment-contract-v2.ts`
  - valida que una aplicacion dirigida no mezcle componentes incompatibles;
- `src/lib/finance/payment-planning-v2.ts`
  - construye aplicaciones `principal_only` e `interest_only` sobre saldos locales por componente.

## Restriccion importante

- `BR-6` si amplía `public.loan_interest_mode`, `public.record_payment()` y `public.originate_loan()`, pero lo hace sin mutar silenciosamente la V1.
- El contrato V1 sigue cubierto por:
  - `supabase/tests/phase2_record_payment_gate.sql`,
  - `supabase/tests/phase6_reverse_payment_gate.sql`,
  - y `supabase/tests/phase7_origination_security_gate.sql`.
- Los ajustes `phase6_restore_reverse_payment_contract_compat` y `phase7_restore_origination_rls_initplan` forman parte del cierre real:
  - restauran el contrato visible heredado de `reverse_payment()`,
  - y mantienen limpio el advisor de performance sin relajar RLS.

## Evidencia de activacion remota actual

V2 ya quedó activado de forma remota porque existen y pasaron:

1. enum remoto ampliado con `compound_fixed_installment` y `loan_payment_application_mode`,
2. write paths remotos `originate_loan`, `record_payment` y `reverse_payment` republicados para V1/V2,
3. fuente de verdad remota de saldos pendientes por componente en `installments`,
4. gate SQL `supabase/tests/phase6_financial_v2_gate.sql`,
5. y cobertura de coexistencia V1 + V2 sin regresiones con `phase2_record_payment_gate.sql`, `phase6_reverse_payment_gate.sql` y `phase7_origination_security_gate.sql`.
