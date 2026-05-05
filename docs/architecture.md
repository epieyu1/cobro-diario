# Arquitectura

## Objetivo

Construir una WebApp de cobro diario con:

- consistencia transaccional en backend,
- operacion offline en campo,
- sincronizacion idempotente,
- trazabilidad financiera,
- despliegue simple sobre GitHub + Vercel + Supabase.

## Decisiones base

### 1. Integridad financiera

- PostgreSQL en Supabase es la fuente de verdad.
- Los movimientos de pago se registran por RPC transaccional, no por varias escrituras sueltas desde frontend.
- La consistencia ACID aplica en servidor.
- La sincronizacion offline usa consistencia eventual con identificadores idempotentes.

### 2. Offline-first

- Dexie administra la base local en IndexedDB.
- La cola de sincronizacion se modela explicitamente.
- Cada pago debe portar `device_local_id` para evitar duplicados en reintentos.
- El Service Worker se dejo manual para la base inicial.

### 3. Seguridad

- Todas las tablas expuestas en `public` quedan con RLS habilitado.
- Las politicas usan `app_metadata.role`, no `user_metadata`.
- Las funciones auxiliares sensibles viven en esquema `private`.

### 4. Despliegue

- Git local y GitHub como fuente de cambios.
- Vercel para previews y produccion del frontend.
- Supabase para Auth, Postgres y funciones RPC.

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

- orden de aplicacion del pago: interes, capital, mora, otros cargos;
- pagos que cubren varias cuotas;
- reestructuracion y reversos;
- reglas de mora y redondeo por pais;
- impresion o recibo digital definitivo.
