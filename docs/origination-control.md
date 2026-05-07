# Control de Originacion: Alta de Deudor y Prestamo

Este archivo no reemplaza `docs/implementation-plan.md`.

- Fuente de verdad de avance general: `docs/implementation-plan.md`
- Fuente de verdad funcional complementaria: `docs/phase-control.md`
- Fuente de verdad de arquitectura: `docs/architecture.md`
- Fuente de verdad del contrato financiero vigente: `docs/financial-contract-v1.md`
- Fuente de verdad de seguridad y ACID: `docs/database-control.md`

## Objetivo

Controlar la incorporacion profesional de la funcion `nuevo deudor + nuevo prestamo`
sin romper seguridad, consistencia financiera, UX movil ni trazabilidad documental.

El objetivo no es agregar solo un formulario. El objetivo es abrir un flujo de
originacion profesional:

- crear deudor nuevo o reutilizar uno existente,
- crear prestamo con cronograma valido,
- asignarlo al cobrador correcto,
- dejarlo visible en cartera,
- y mantener el mismo nivel de rigor que hoy tiene `record_payment()`.

## Estado del subplan

- `OR-0` cerrado el `2026-05-06`.
- `OR-1` cerrado en `LANDING` el `2026-05-06`.
- `OR-2` cerrado en `LANDING` el `2026-05-06`.
- `OR-3` cerrado localmente el `2026-05-06`.
- `OR-4` cerrado el `2026-05-06`.
- `OR-5` cerrado en `LANDING` el `2026-05-06`.

## Verificacion contra estandares globales

| Regla global | Como aplica a originacion | Estado requerido |
| --- | --- | --- |
| No crear planes paralelos | Este archivo depende de `docs/implementation-plan.md` y no autoriza cerrar fases por fuera del roadmap maestro | Obligatorio |
| Skill `supabase` obligatorio | Toda fase que toque Auth, RLS, SQL, RPC, grants o despliegue remoto debe ejecutarse bajo ese skill | Obligatorio |
| PostgreSQL es fuente de verdad | La originacion debe escribir primero en Supabase; IndexedDB solo puede reflejar el resultado remoto confirmado | Obligatorio |
| No abrir DML directo inseguro | `customers`, `loans` e `installments` no deben quedar insertables desde browser client por conveniencia | Obligatorio |
| Documentar intencion, flujo, riesgo y fuente de verdad | Cada RPC, helper financiero, mapper y pantalla nueva debe dejar comentario inline y actualizacion en `docs/` | Obligatorio |
| Mobile-first real | El flujo debe entrar comodo en telefono; no se acepta un formulario largo desktop-first parcheado | Obligatorio |
| No romper logica financiera | El cronograma debe respetar moneda, redondeo, fechas y modo financiero documentado | Obligatorio |
| No cerrar fases sin compuertas | Cada fase de este archivo exige test o gate antes de pasar a la siguiente | Obligatorio |
| No improvisar offline | V1 de originacion no debe nacer offline si eso compromete identidad, cronograma o idempotencia | Obligatorio |

## Diagnostico actual

Estado real del repo despues del cierre remoto de `OR-2`:

- `customers`, `loans` e `installments` existen en el esquema remoto.
- la UI ya expone un wizard mobile-first de originacion dentro de la misma `operations-sheet`, con pasos `Deudor -> Prestamo -> Confirmacion`.
- el mismo paso `Deudor` ya puede crear un cobrador nuevo si no existe uno activo disponible para asignar el caso.
- `public.customers` y `public.loans` quedaron en lectura para `authenticated` bajo el hardening vigente.
- `public.originate_loan()` ya existe como write path transaccional y sigue siendo la unica via autorizada para crear `customers`, `loans` e `installments`.
- `private.next_origination_due_date()` y `private.build_origination_schedule()` ya versionan el cronograma canonico V1 y el RPC rechaza previews que no coincidan con esa regla.
- el corte de roles ya quedó saneado de punta a punta: solo sobreviven `admin` y `collector`, el enum remoto ya no conserva valores legacy y `public.originate_loan()` ya fue revalidado después de recompilarse contra `private.is_admin()`.
- `collector-workspace.ts` ya hidrata solo las cuotas de los loans visibles y conserva `external_loan_number`, fechas y frecuencia para que el cobrador pueda identificar el caso nuevo sin una segunda fuente local del prestamo.
- `origination-transport.ts` ya puede crear un `collector` desde UI sin `service_role`: usa `public.provision_collector_account()` para provisionar `auth.users`, `auth.identities` y `public.profiles` del lado del servidor sin abrir un segundo cliente Auth en browser.
- la compuerta remota `supabase/tests/phase7_collector_provisioning_gate.sql` ya deja reproducible el alta segura de cobradores sin relajar grants sobre `public.profiles`.
- el write path tambien ya recupera cuentas Auth huerfanas sin `public.profiles`, para que un correo atrapado por el flujo roto anterior pueda volver a aparecer como cobrador activo al reintentar el alta.

Conclusion:

- el producto actual no cumple aun el baseline de `CobrApp` y `PrestaBIT` para altas de clientes y prestamos,
- pero el subplan de originacion V1 ya quedó cerrado con evidencia remota y local; el siguiente frente general del repo ya no es originacion sino validacion manual de Fase 4 y, mas adelante, roles/reportes de `BR-4`.

## Baseline derivado de los referentes

Lo minimo que la originacion debe cubrir para ser comparable con el baseline documentado:

- alta rapida de clientes y prestamos,
- calendario de cobro configurable al menos para `diario`, `semanal`, `quincenal` y `mensual`,
- asignacion explicita a cobrador,
- claridad del cronograma antes de confirmar,
- visibilidad inmediata del caso nuevo en cartera,
- seguridad por rol sin debilitar RLS.

## Alcance V1 profesional

La primera version profesional de esta funcion debe cubrir:

- crear un deudor nuevo,
- originar un prestamo para un deudor nuevo,
- originar un prestamo para un deudor existente,
- asignar cobrador responsable,
- generar cuotas materializadas en `installments`,
- soportar frecuencias `diario`, `semanal`, `quincenal` y `mensual`,
- soportar solo `simple_precomputed` en el motor financiero de originacion,
- dejar el prestamo visible en la cartera del cobrador asignado despues de confirmar.

## Decisiones cerradas en OR-0

Las siguientes decisiones ya no deben reabrirse por intuicion en fases posteriores.
Si alguna cambia, se debe documentar el motivo y actualizar este archivo.

### 1. Roles autorizados

- `admin` puede originar.
- `collector` no puede originar en V1; solo opera cartera, cobro y gestion.
- cualquier rol con `profiles.active = false` queda bloqueado para originacion aunque tenga sesion valida.

### 2. Conectividad y fuente de verdad

- La originacion V1 es `online-required`.
- No existira cola offline de originacion en esta primera version.
- El prestamo solo existe para la app cuando el RPC remoto confirma la transaccion.
- IndexedDB no podra inventar ni persistir una version local provisional del prestamo.

### 3. Modos de entrada

- El flujo V1 soporta:
  - `nuevo deudor + nuevo prestamo`
  - `deudor existente + nuevo prestamo`
- No soporta en V1:
  - mover un deudor entre cobradores desde el mismo wizard,
  - fusionar deudores,
  - editar un cronograma ya confirmado,
  - refinanciar o reestructurar desde el mismo flujo.

### 4. Politica de alcance por cobrador

- Todo deudor nuevo debe nacer con `assigned_collector_id` explicito.
- Todo prestamo nuevo debe nacer con `collector_id` igual al `assigned_collector_id` del deudor.
- Si se selecciona un deudor existente, el nuevo prestamo debe respetar el mismo cobrador ya asignado.
- Reasignar deudor o prestamo a otro cobrador queda fuera de V1 y requiere flujo dedicado posterior.

### 5. Campos obligatorios del deudor

Para `nuevo deudor` se congelan como obligatorios en V1:

- `full_name`
- `government_id`
- `phone`
- `address_line`
- `route_label`
- `neighborhood`
- `assigned_collector_id`

Quedan opcionales en V1:

- `notes`
- `latitude`
- `longitude`

Razon:

- `route_label` materializa la ruta operativa remota actual del cobrador,
- `neighborhood` y `address_line` conservan contexto geografico y fallback de compatibilidad,
- `government_id` y `phone` reducen duplicados operativos,
- y el cobrador asignado debe quedar definido desde el alta.

Nota de UX:

- la UI mobile-first permite personalizar `route_label`,
- pero si el usuario no cambia esa etiqueta dedicada, el payload final reutiliza `neighborhood` para no romper el contrato V1 mientras `public.customers` no tenga una entidad separada de rutas.

### 6. Campos obligatorios del prestamo

Para `nuevo prestamo` se congelan como obligatorios en V1:

- `principal_amount`
- `installment_amount`
- `total_installments`
- `payment_frequency`
- `disbursement_date`
- `first_due_date`
- `collector_id` derivado del deudor asignado

Quedan opcionales en V1:

- `notes`

Quedan fijos por contrato V1:

- `currency_code = COP`
- `interest_mode = simple_precomputed`
- `fee_amount` inicial por cuota = `0`

### 7. Politica de cronograma V1

- El wizard V1 no pedira interes compuesto ni abonos dirigidos.
- La captura principal del operador sera:
  - capital,
  - valor de cuota,
  - numero de cuotas,
  - frecuencia,
  - fecha de desembolso,
  - primera fecha de cobro.
- `OR-2` materializa el cronograma desde esos datos con redondeo oficial `HALF_UP`.
- Cada cuota nacerá con:
  - `scheduled_amount` materializado,
  - `outstanding_amount = scheduled_amount`,
  - `fee_amount = 0`,
  - `status = pending`.

### 8. Frecuencias permitidas en V1

V1 solo permitira:

- `daily`
- `weekly`
- `biweekly`
- `monthly`

Regla congelada para OR-2:

- `daily`: avance de `1` dia calendario por cuota,
- `weekly`: avance de `7` dias calendario por cuota,
- `biweekly`: avance de `15` dias calendario por cuota,
- `monthly`: avance de `1` mes calendario por cuota, ajustando al ultimo dia valido si el dia original no existe.

### 9. Estado inicial del prestamo

- El alta confirmada por RPC deja el prestamo en `active`.
- `draft` no se expondra en la UX V1 como “guardar y seguir despues”.
- Si el negocio necesita borrador real, se diseña como flujo posterior y no como atajo silencioso.

### 10. Politica de unicidad operativa

- V1 permitira un solo prestamo abierto por deudor.
- Se considera abierto cualquier prestamo en `draft`, `active` o `delinquent`.
- Si el deudor ya tiene un prestamo abierto, el RPC debe rechazar la nueva originacion.

Razon:

- evita ambiguedad en cartera, rutas y cobro mientras no exista una politica formal de multiprestamo por cliente.

### 11. Numero de prestamo

- `external_loan_number` no sera editable en el wizard V1.
- El identificador externo del prestamo debe generarse en servidor para evitar colisiones manuales.

### 12. Politica de duplicados de deudor

- El wizard debe buscar primero por `government_id`.
- Si no existe coincidencia por `government_id`, puede usarse combinacion de `full_name + phone` para advertencia.
- La prevencion fuerte de duplicados se implementara en backend y no solo en UI.

## Fuera de alcance inicial

No mezclar en V1 de originacion:

- interes compuesto real,
- cuotas fijas fuera del contrato `simple_precomputed`,
- abonos dirigidos a capital o interes desde originacion,
- fotos del cliente,
- grupos de clientes,
- rol adicional de secretaria,
- originacion offline,
- refinanciacion, reestructuracion o edicion compleja del cronograma,
- impresion Bluetooth del desembolso.

Estas piezas pueden entrar despues, pero no deben contaminar la primera version segura.

## Regla de documentacion obligatoria

Toda fase que agregue logica nueva de originacion debe dejar:

- comentario de intencion,
- comentario de flujo u origen/destino de datos,
- comentario de riesgo si se altera,
- referencia explicita a la fuente de verdad,
- actualizacion en `docs/` si cambia arquitectura, seguridad, proceso o contrato financiero.

Archivos que deben revisarse cada vez que esta funcion cambie:

- `docs/implementation-plan.md`
- `docs/phase-control.md`
- `docs/architecture.md`
- `docs/financial-contract-v1.md` o su sucesor si el contrato cambia
- `docs/session-handoff.md`
- `docs/audit-report.md` si la UI compartida cambia

## Regla de avance

No se puede pasar a la fase siguiente si:

- falla su compuerta,
- la documentacion no refleja el comportamiento real,
- se agrego logica sin comentarios obligatorios,
- se abrio un write path sin control de rol o RLS,
- o el comportamiento nuevo no quedo cubierto por test local o gate remoto.

## Fases de implementacion y control

### OR-0. Cierre de contrato y cumplimiento de estandares

#### Resultado esperado

Congelar el alcance funcional y el write path autorizado antes de escribir UI o SQL final.

#### Funciones incluidas

- definir quien puede originar (`admin`),
- decidir si `collector` puede originar o solo consultar,
- fijar frecuencias y campos obligatorios,
- fijar que V1 usa solo `simple_precomputed`,
- decidir si el flujo soporta deudor nuevo, deudor existente o ambos desde el arranque.

#### Implementacion minima

- versionar este archivo,
- referenciarlo desde `docs/implementation-plan.md`,
- reflejar la brecha en `docs/phase-control.md`,
- dejar constancia de que V1 no usara DML directo desde browser client,
- cerrar decisiones exactas de roles, campos, frecuencias, conectividad y alcance.

#### Compuertas y tests obligatorios

- `git diff --check`
- revision documental de:
  - `docs/origination-control.md`
  - `docs/implementation-plan.md`
  - `docs/phase-control.md`

#### Criterio de salida

- alcance congelado,
- restricciones de seguridad congeladas,
- decisiones funcionales de originacion congeladas,
- y plan de fases aceptado sin contradiccion con `AGENTS.md`.

### OR-1. RPC transaccional de originacion y hardening RLS

#### Resultado esperado

Abrir un write path profesional para originacion sin debilitar el hardening actual.

#### Funciones incluidas

- RPC transaccional `originate_loan` o equivalente,
- opcion de crear deudor nuevo o usar uno existente,
- insercion atomica de `customers`, `loans` e `installments`,
- trazabilidad de origen por actor y fecha,
- control de permisos por rol y alcance.

#### Implementacion minima

- crear migracion con el RPC y helpers privados necesarios,
- agregar columnas de trazabilidad si faltan, por ejemplo:
  - `loans.created_by`
  - `loans.originated_at`
  - `loans.payment_frequency`
  - `loans.interest_mode`
- evaluar si hace falta una tabla de eventos de originacion o si basta con trazabilidad en tablas existentes,
- mantener `customers`, `loans` e `installments` sin `INSERT` directo abierto al browser client.

#### Documentacion obligatoria

- comentario SQL de intencion y riesgo sobre el nuevo RPC,
- actualizacion de `docs/architecture.md`,
- actualizacion de `docs/database-control.md`.

#### Compuertas y tests obligatorios

- `supabase/tests/phase7_origination_security_gate.sql`
- `supabase db lint --linked --level warning`
- `supabase db advisors --linked`

#### Estado de implementacion local

- La migracion `20260506205243_phase7_origination_rpc_and_rls.sql` ya versiona:
  - `public.originate_loan(...)`,
  - `private.origination_write_context_enabled()`,
  - `private.can_originate_for_collector(uuid)`,
  - columnas `loans.created_by`, `loans.originated_at`, `loans.payment_frequency` y `loans.interest_mode`,
  - y las policies/grants de `INSERT` controlado para `customers`, `loans` e `installments`.
- La compuerta `supabase/tests/phase7_origination_security_gate.sql` ya cubre:
  - alta por `admin`,
  - alta por `admin` sobre deudor existente,
  - denegacion a `collector`,
  - denegacion a perfil inactivo,
  - rollback sin huerfanos,
  - y bloqueo de `INSERT` directo.
- El ajuste `20260506212001_phase7_optimize_origination_rls_initplan.sql` removio los `WARN` nuevos del advisor sin cambiar permisos ni contrato.
- Validacion remota ejecutada en `LANDING`:
  - `supabase db push --linked`
  - `supabase db lint --linked --level warning`
  - `supabase db advisors --linked`
  - `supabase db query --linked --file supabase/tests/phase7_origination_security_gate.sql`
- OR-1 ya puede considerarse cerrado porque el write path autorizado existe y sus compuertas remotas pasaron; el unico `WARN` remanente de advisors sigue siendo el heredado de Auth por `Leaked Password Protection`.

#### Casos minimos a cubrir

- `admin` puede originar dentro de su alcance permitido,
- `collector` queda denegado si ese es el contrato elegido,
- una corrida fallida no deja cliente huerfano ni prestamo a medio crear,
- no se puede originar un prestamo sobre un cliente fuera del alcance permitido,
- no se puede abrir un write path alterno por DML directo.

#### Criterio de salida

- existe un solo write path autorizado para originacion,
- RLS y grants siguen cerrados,
- y la atomicidad queda probada en gate remoto.

### OR-2. Motor de cronograma y validacion financiera de originacion

#### Resultado esperado

Generar cuotas consistentes con el contrato financiero vigente antes de abrir el formulario final.

#### Funciones incluidas

- generador de cronograma,
- calculo de fechas por frecuencia,
- redondeo monetario,
- asignacion de `scheduled_amount`, `principal_amount`, `interest_amount`, `fee_amount` y `outstanding_amount`,
- numeracion de cuotas y primera fecha de cobro.

#### Implementacion minima

- crear helpers compartidos para originacion,
- documentar el contrato de originacion dentro del contrato financiero vigente o en un anexo versionado,
- definir si `installment_amount` es dato de entrada o derivado del cronograma en V1,
- mantener alineacion estricta entre backend y cualquier preview de frontend.

#### Documentacion obligatoria

- actualizar `docs/financial-contract-v1.md` o publicar un anexo V1 de originacion,
- comentar helpers de cronograma con intencion, flujo, riesgo y fuente de verdad.

#### Compuertas y tests obligatorios

- `src/lib/finance/origination-schedule.test.ts`
- `supabase/tests/phase7_origination_schedule_gate.sql`

#### Estado de implementacion y validacion remota

- La migracion `20260506212651_phase7_origination_schedule_v1.sql` ya versiona:
  - `private.next_origination_due_date(date, loan_payment_frequency, integer)`,
  - `private.build_origination_schedule(numeric, numeric, integer, loan_payment_frequency, date, date)`,
  - y la revalidacion canonica del preview dentro de `public.originate_loan(...)`.
- Las migraciones `20260506213204_phase7_clean_origination_schedule_lint.sql` y `20260506213302_phase7_fix_schedule_out_variable_shadow.sql` limpiaron los warnings de PL/pgSQL sin cambiar la formula del cronograma.
- `src/lib/finance/origination-schedule.ts` y `src/lib/finance/origination-schedule.test.ts` ya dejan alineado el preview TypeScript con la regla remota.
- Validacion ejecutada con evidencia real:
  - `npm run test:phase7`
  - `list_migrations` mostrando `20260506212651`, `20260506213204` y `20260506213302` en `LANDING`
  - `execute_sql` por MCP sobre `supabase/tests/phase7_origination_security_gate.sql`
  - `execute_sql` por MCP sobre `supabase/tests/phase7_origination_schedule_gate.sql`
  - `get_advisors(security)` y `get_advisors(performance)` sin `WARN` o `ERROR` nuevos del dominio de originacion
- OR-2 ya puede considerarse cerrado porque el cronograma es determinista, el RPC rechaza desalineaciones y la persistencia remota quedó revalidada en `LANDING`.

#### Casos minimos a cubrir

- frecuencia diaria,
- frecuencia semanal,
- frecuencia quincenal,
- frecuencia mensual,
- rechazo por valores negativos o cuotas invalidas,
- suma total del cronograma consistente con el modo financiero V1,
- `draft` o `active` segun la politica final elegida para el alta.

#### Criterio de salida

- el cronograma queda determinista,
- backend y tests coinciden,
- y no se necesita UI para descubrir reglas ocultas.

### OR-3. Wizard mobile-first de deudor y prestamo

#### Resultado esperado

Tener una UX clara y rapida en telefono para originar sin volver densa la app.

#### Funciones incluidas

- entrada a la funcion por rol,
- wizard `Deudor -> Prestamo -> Confirmacion`,
- modo `nuevo deudor` y `deudor existente`,
- validaciones de campos antes de tocar el RPC,
- preview del cronograma,
- mensaje explicito de `requiere conexion`.

#### Implementacion minima

- no agregar un formulario plano largo dentro del panel de cobro actual,
- crear una entrada visible y separada para originacion,
- mostrar feedback claro de validacion y de error remoto,
- impedir envio duplicado.

#### Documentacion obligatoria

- comentarios de UI no obvia,
- actualizacion de `docs/operational-ui.md`,
- actualizacion de `docs/audit-report.md` por tratarse de UI compartida.

#### Compuertas y tests obligatorios

- `src/lib/origination/origination-validation.test.ts`
- `src/lib/origination/origination-wizard.test.ts`
- `npm run check`
- `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"`

#### Estado de implementacion local

- `src/lib/origination/origination-validation.ts` ya centraliza:
  - validacion local de `nuevo deudor` y `deudor existente`,
  - armado del payload del RPC,
  - serializacion del cronograma canonico,
  - y traduccion de errores locales/remotos a mensajes operativos.
- `src/lib/origination/origination-wizard.ts` ya versiona el modelo puro del wizard:
  - acceso por rol,
  - bloqueo por falta de conexion,
  - y habilitacion de pasos `Deudor -> Prestamo -> Confirmacion`.
- `src/lib/origination/origination-transport.ts` ya encapsula:
  - carga de cobradores activos,
  - busqueda remota de deudores existentes,
  - alta segura de cobradores por `public.provision_collector_account(...)`,
  - y submit a `public.originate_loan(...)` via `supabase-js`.
- `src/lib/origination/origination-wizard-panel.tsx`, `src/App.tsx` y `src/index.css` ya integran la UX mobile-first sin mezclar originacion dentro del panel de cobro ni reintroducir `style={{...}}`.
- Validacion local ejecutada:
  - `npm run test:phase7`
  - `npm run check`
  - `rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"`
- OR-3 puede considerarse cerrado localmente porque la entrada por rol existe, el wizard materializa preview canonico antes del RPC, la UI bloquea `collector` y el submit duplicado queda deshabilitado mientras la originacion esta en curso.

#### Casos minimos a cubrir

- crear deudor nuevo con datos minimos validos,
- buscar y seleccionar deudor existente,
- rechazo por campos obligatorios faltantes,
- rechazo por monto o frecuencia invalidos,
- preview visible del cronograma antes de confirmar,
- denegacion de acceso por rol no permitido en UI.

#### Criterio de salida

- UX usable en movil,
- validacion local razonable,
- y cero regresion visual contra las reglas globales del repo.

### OR-4. Integracion end-to-end: originacion -> cartera -> cobro

#### Resultado esperado

El caso creado debe aparecer en cartera y poder entrar al flujo operativo real del cobrador.

#### Funciones incluidas

- refresco de workspace despues de originar,
- visibilidad del nuevo deudor y prestamo en la cartera del cobrador asignado,
- detalle del cronograma en UI,
- continuidad con el cobro existente sobre la primera cuota.

#### Implementacion minima

- extender `collector-workspace.ts` si faltan campos para render o filtros,
- evitar divergencias entre datos de originacion y bootstrap remoto,
- no crear una segunda fuente de verdad local para el prestamo nuevo.

#### Documentacion obligatoria

- comentario en los mappers o selects que cambien,
- actualizacion de `docs/architecture.md` y `docs/phase-control.md` si cambia el flujo remoto -> cache local.

#### Compuertas y tests obligatorios

- ampliar `src/lib/collector/collector-workspace.test.ts`
- ampliar `src/lib/collector/collector-operational-flow.test.ts`
- `scripts/phase7-origination-smoke.mjs`

#### Casos minimos a cubrir

- login como rol originador,
- crear deudor y prestamo,
- login como cobrador asignado,
- ver el caso en cartera,
- abrir detalle,
- cobrar la primera cuota usando el flujo vigente.

#### Criterio de salida

- originacion y cobranza conviven sin costuras,
- el caso nuevo ya entra al flujo productivo real,
- y el bootstrap remoto sigue siendo la unica verdad de cartera.

#### Estado validado

Estado validado en `LANDING` al `2026-05-06`:

- `collector-workspace.ts` ya conserva `external_loan_number`, fechas contractuales y frecuencia para render, filtros y detalle del caso originado,
- el bootstrap remoto ya evita cachear cuotas fuera del portfolio del cobrador actual,
- `src/lib/collector/collector-workspace.test.ts` ya cubre metadatos de originacion y filtrado de cuotas huerfanas,
- `src/lib/collector/collector-operational-flow.test.ts` ya cubre un prestamo recien originado con primera cuota cobrable,
- `scripts/phase7-origination-smoke.mjs` ya pasó con el circuito real `admin -> originate_loan -> collector -> cartera visible -> record_payment`,
- y la UI ya permite encontrar el caso por `external_loan_number` y revisar su cronograma en el detalle del prestamo.

### OR-5. Hardening por rol, dataset de prueba y cierre documental

#### Resultado esperado

Dejar la funcion gobernable por rol, reproducible en `LANDING` y protegida para futuros asistentes.

#### Funciones incluidas

- smokes por rol,
- dataset remoto editable para originacion si hace falta,
- bloqueo por `profiles.active`,
- cierre documental y handoff.

#### Implementacion minima

- crear cuentas o seeds de prueba para rol originador si la validacion remota lo exige,
- documentar claramente quien puede crear y quien no,
- versionar el smoke remoto de originacion.

#### Documentacion obligatoria

- actualizar `docs/session-handoff.md`,
- actualizar `docs/implementation-plan.md`,
- actualizar `docs/database-control.md` si cambia seguridad o write path,
- actualizar `docs/audit-report.md` si cambia UI compartida.

#### Compuertas y tests obligatorios

- `supabase/tests/phase7_origination_roles_gate.sql`
- `scripts/phase7-origination-smoke.mjs`
- `node scripts/phase4-auth-user.mjs smoke ...` o su sucesor por rol si el flujo de auth cambia
- `git diff --check`

#### Casos minimos a cubrir

- un rol permitido puede originar,
- un rol no permitido no puede originar,
- un perfil inactivo no puede originar aunque tenga sesion,
- el smoke remoto deja evidencia de `nuevo deudor -> nuevo prestamo -> cartera visible`.

#### Criterio de salida

- la funcion queda cerrada con evidencia automatizada,
- los roles y bloqueos remotos quedan probados,
- y el siguiente asistente puede continuar sin reinterpretar el flujo.

#### Estado validado

- `supabase/tests/phase7_origination_roles_gate.sql` ya fija el corte final de roles con `ROLLBACK`: `admin` activo puede originar, un claim legacy inesperado se degrada a `collector`, `collector` no puede originar, un `admin` inactivo queda bloqueado y tampoco se puede asignar un prestamo a un `collector` inactivo.
- `scripts/phase7-origination-smoke.mjs` ya dejó evidencia real de `admin -> originate_loan -> collector -> record_payment` sobre `LANDING`.
- `scripts/phase4-auth-user.mjs` ahora acepta un `expected-role` opcional para cerrar el smoke de Auth/RLS con aserción explícita del rol operativo esperado.
- La originacion V1 puede tratarse como cerrada: cualquier trabajo futuro de roles ya pertenece al frente más amplio de `BR-4` y no a este subplan.

## Matriz resumida de fases y compuertas

| Fase | Objetivo | Compuertas minimas |
| --- | --- | --- |
| `OR-0` | Congelar alcance y cumplimiento | `git diff --check` |
| `OR-1` | Abrir RPC seguro de originacion | `phase7_origination_security_gate.sql` + `db lint` + advisors |
| `OR-2` | Validar cronograma y reglas financieras | `origination-schedule.test.ts` + `phase7_origination_schedule_gate.sql` |
| `OR-3` | Construir wizard movil y validaciones | `origination-validation.test.ts` + `origination-wizard.test.ts` + `npm run check` |
| `OR-4` | Probar flujo end-to-end con cartera real | `collector-workspace.test.ts` + `collector-operational-flow.test.ts` + `phase7-origination-smoke.mjs` |
| `OR-5` | Cerrar seguridad por rol y handoff | `phase7_origination_roles_gate.sql` + smoke remoto final + `git diff --check` |

## Regla final para futuros asistentes

Nadie debe:

- abrir `INSERT` directo sobre `customers`, `loans` o `installments` solo para acelerar UI,
- mezclar originacion offline en V1 sin un contrato nuevo,
- cambiar el cronograma sin actualizar tests y contrato financiero,
- mover la fuente de verdad fuera de Supabase,
- ni cerrar una fase de este archivo sin dejar evidencia en `docs/session-handoff.md`.
