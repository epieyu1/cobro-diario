# Referentes de Producto

## Proposito

Este documento fija los referentes externos que deben guiar decisiones de flujo, UX y arquitectura
de `Cobro Diario`. Su objetivo no es copiar productos existentes, sino dejar claro que el proyecto
compite contra herramientas maduras y que cualquier asistente debe entender sus aciertos y fallas
antes de simplificar flujos criticos.

Estado de verificacion documental: 5 de mayo de 2026.

## Referentes verificados

### CobrApp

Fortalezas observadas en su ficha publica:

- rutas de cobro por zona,
- asignacion de clientes a cobradores,
- geolocalizacion opcional de pagos,
- multiples modos de interes,
- recibos e integracion con impresoras Bluetooth,
- gestion de cartera y reportes en tiempo real.

Debilidad operativa a superar en nuestro producto:

- cuando la cartera crece, la experiencia debe mantenerse rapida y legible; no se acepta un frontend
  que se degrade por volumen de clientes, cuotas o pagos.

### PrestaBIT

Fortalezas observadas en sus fichas publicas:

- interes compuesto y cuotas fijas,
- abonos al capital o al interes,
- organizacion por rutas, grupos y estados,
- impresion de recibos por Bluetooth,
- funcionamiento offline con sincronizacion al reconectarse,
- roles operativos diferenciados.

Debilidad operativa a superar en nuestro producto:

- la interfaz y el aprendizaje del sistema deben ser mas claros que en herramientas densas o cargadas.

## Fuentes consultadas

- CobrApp en App Store: `https://apps.apple.com/us/app/gestor-de-cobranza-cobrapp/id1620770032`
- PrestaBIT en App Store: `https://apps.apple.com/us/app/prestabit/id1671026232`
- PrestaBIT en Google Play: `https://play.google.com/store/apps/details?id=app.web.groons.prestabit`

## Requisitos derivados

### 1. Offline-first real

- La app debe seguir operando sin señal.
- IndexedDB es cache operativa y cola local; PostgreSQL sigue siendo la fuente de verdad.
- La sincronizacion debe ser transparente, idempotente y sin duplicar pagos al reconectar.

### 2. Auditoria de campo

- Los pagos deben poder conservar evidencia de ubicacion si el dispositivo la entrega.
- Las rutas y la asignacion de clientes a cobradores son un requerimiento de producto, no un extra.
- Cualquier simplificacion futura del flujo de GPS o rutas debe justificarse en `docs/`.

### 3. Motor financiero mas flexible

- El contrato actual ya soporta aplicaciones materializadas por cuota.
- Falta cerrar reglas finales para:
  - interes compuesto,
  - abonos libres,
  - mora separada de otros cargos,
  - reversos,
  - posibles carteras o inversionistas multiples.

### 4. Recibos y comprobantes

- La impresion termica Bluetooth debe quedar prevista como capacidad real.
- No basta con guardar el pago; el sistema debe poder producir comprobantes consistentes con la
  transaccion confirmada por servidor.

### 5. Rendimiento con cartera grande

- Las listas, filtros y busquedas deben diseñarse pensando en volumen.
- No se deben introducir componentes o consultas que recorran toda la cartera en cada render.
- El cache local y el contrato de sync deben poder escalar a muchos clientes y cuotas.

### 6. UX operativa simple

- La curva de aprendizaje del cobrador debe ser baja.
- La base tecnica puede ser sofisticada, pero la interfaz no debe sentirse densa ni confusa.

## Implicaciones tecnicas para este repo

### Frontend

- React + TypeScript siguen siendo base valida.
- El repo hoy usa CSS propio; si en el futuro se adopta Tailwind, debe ser una decision explicita y
  no una migracion improvisada a mitad de un flujo critico.

### Backend transaccional

- La logica critica de registrar pagos debe permanecer atomica en Supabase/PostgreSQL.
- No fragmentar el posteo de pagos entre navegador y un backend Node.js ad hoc, porque eso rompe
  atomicidad e incrementa riesgo de duplicados.
- Node.js puede tener sentido para reportes, procesos batch o integraciones externas, pero no debe
  desplazar el RPC transaccional como fuente final del cobro.

### Seguridad y roles

- Deben mantenerse roles separados para administrador y cobrador.
- No se debe debilitar RLS para “facilitar” rutas, reportes o sincronizacion.

## Regla para futuros asistentes

Si una decision de producto o arquitectura contradice este documento, el asistente debe:

1. explicitar la contradiccion,
2. documentar el motivo,
3. actualizar `docs/architecture.md` y `docs/implementation-plan.md` si el rumbo cambia.
