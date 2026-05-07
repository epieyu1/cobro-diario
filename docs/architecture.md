# Arquitectura

## Objetivo

Construir una WebApp de cobro diario con:

- consistencia transaccional en backend,
- operacion offline en campo,
- sincronizacion idempotente,
- trazabilidad financiera,
- despliegue simple sobre GitHub + Vercel + Supabase.

## Referentes obligatorios

- Antes de simplificar rutas, GPS, recibos, offline o motor financiero, revisar [Referentes de Producto](./reference-benchmarks.md).
- Este repo compite contra herramientas que ya cubren rutas, geolocalizacion, impresion y sync offline; cualquier asistente debe tomar eso como baseline minimo y no como “nice to have”.

## Decisiones base

### 1. Integridad financiera

- PostgreSQL en Supabase es la fuente de verdad.
- Los movimientos de pago se registran por RPC transaccional, no por varias escrituras sueltas desde frontend.
- La originacion de deudor y prestamo sigue el mismo patron: `public.originate_loan()` es el write path autorizado y V1 sigue siendo `online-required`.
- La consistencia ACID aplica en servidor.
- La sincronizacion offline usa consistencia eventual con identificadores idempotentes.

### Contrato financiero V1

El contrato financiero operativo vigente vive en [Financial Contract V1](./financial-contract-v1.md).

### 2. Offline-first

- Dexie administra la base local en IndexedDB.
- La cola de sincronizacion se modela explicitamente.
- Cada pago debe portar `device_local_id` para evitar duplicados en reintentos.
- `src/lib/sync/payment-sync.ts` es la orquestacion autorizada para enqueue, replay y reconciliacion local.
- `src/lib/collector/collector-workspace.ts` es la capa autorizada para bootstrap remoto -> cache local y lectura de la vista operativa.
- Ese bootstrap ya solo hidrata las cuotas de los `loans` visibles para la cartera actual y conserva metadatos de originacion como `external_loan_number`, fechas y frecuencia para que la UI no invente una segunda fuente local del prestamo.
- `src/lib/finance/payment-planning.ts` materializa el cobro oldest-first antes de entrar a la cola.
- El Service Worker se dejo manual para la base inicial.
- La sincronizacion debe sentirse transparente al cobrador cuando vuelva la señal.
- La estrategia vigente vive en [Offline Sync](./offline-sync.md).

### 3. Seguridad

- Todas las tablas expuestas en `public` quedan con RLS habilitado.
- Las politicas usan `app_metadata.role`, no `user_metadata`.
- Las funciones auxiliares sensibles viven en esquema `private`.
- Las escrituras criticas no deben quedar abiertas como DML directo desde el browser client si el flujo oficial es RPC; RLS sin least privilege no basta para proteger integridad operacional.
- La autorizacion remota debe considerar estado operativo real del perfil; `profiles.active` no puede quedarse como dato decorativo si se espera desactivar cobradores sin cerrar toda la capa Auth.
- La UI no debe permitir cerrar sesion con cola local sin resolver; primero se sincroniza o se corrige la divergencia y luego se limpia el cache del dispositivo.

### 4. Despliegue

- Git local y GitHub como fuente de cambios.
- Vercel para previews y produccion del frontend.
- Supabase para Auth, Postgres y funciones RPC.

### 5. Decision de backend operativo

- La escritura financiera critica vive en PostgreSQL/Supabase por atomicidad e idempotencia.
- La escritura critica de originacion tambien vive en PostgreSQL/Supabase para no separar `customers`, `loans` e `installments` en multiples requests sin transaccion.
- Un backend Node.js podria servir para reportes o integraciones externas, pero no debe romper el contrato transaccional de `record_payment`.

## Dominio inicial del esquema

- `profiles`
- `devices`
- `customers`
- `loans`
- `installments`
- `payments`
- `payment_applications`
- `payment_events`
- `sync_events`

## Pendientes de producto antes de ampliar el motor financiero

- mantener el hardening de grants/RLS, la validación de `device_id` y el bloqueo por `profiles.active` cada vez que aparezca un nuevo write path crítico;
- interes compuesto y motor multiproducto por cartera o inversionista;
- reverso operativo expuesto por RPC con trazabilidad completa;
- siembra de usuario/perfil/cartera real en `LANDING` para validar la UI operativa;
- smoke test manual movil y dataset grande para validar la UI operativa ya implementada;
- impresion termica Bluetooth y comprobantes fisicos;
- rendimiento de frontend con carteras grandes y filtros operativos;
- reglas de mora y redondeo por pais cuando el producto salga de Colombia;
- politica final de recibo digital y evidencia entregada al cliente.
