# Operational UI

## Objetivo

Dejar una UI minima de cobrador que ya use los contratos reales del proyecto:

- sesion Supabase en navegador,
- bootstrap remoto hacia IndexedDB,
- cartera por asignacion del cobrador,
- cobro oldest-first materializado por cuota,
- cola offline visible con reintentos,
- recibo local pendiente y comprobante remoto confirmado por `remotePaymentId`,
- separación visible entre roles de administrador y cobrador,
- reportes operativos mínimos visibles solo para administrador,
- y originacion mobile-first gobernada por rol y RPC transaccional.

## Archivos fuente de verdad

- `src/App.tsx`
- `src/index.css`
- `src/lib/collector/collection-actions.ts`
- `src/lib/collector/collector-workspace.ts`
- `src/lib/auth/role-guards.ts`
- `src/lib/collector/collector-route-board.ts`
- `src/lib/finance/payment-planning.ts`
- `src/lib/origination/origination-validation.ts`
- `src/lib/origination/origination-wizard.ts`
- `src/lib/origination/origination-transport.ts`
- `src/lib/origination/origination-wizard-panel.tsx`
- `src/lib/reports/report-panel.tsx`
- `src/lib/reports/report-queries.ts`
- `src/lib/runtime/operational-runtime.ts`
- `src/lib/supabase/auth-session.ts`
- `src/lib/device/geolocation.ts`
- `src/lib/sync/payment-sync.ts`
- `docs/terminology-guide.md`

## Regla terminológica visible

- La UI visible debe usar `administrador`, `cobrador`, `recibo`, `ruta`, `sin conexión` y
  `sincronización` como términos preferidos.
- `admin`, `collector`, `receipt`, `sync`, `offline` y `online` quedan reservados para ids, tipos,
  RPC o referencias técnicas en código.
- Cuando este documento cite un identificador interno, debe priorizar primero el término de
  producto y dejar el código entre backticks solo si aporta precisión.

## Flujo operativo establecido

### 1. Reingreso

- La app abre IndexedDB primero.
- `localDb` se trata como singleton del runtime del navegador; no debe cerrarse en el cleanup del montaje base.
- La sesion se restaura con `supabase.auth.getSession()` via `readPersistedBrowserSession()`.
- Si hay cache local, la vista puede mostrar cartera offline antes del refresh remoto.

Riesgo:
en desarrollo con React `StrictMode`, cerrar Dexie en el cleanup del efecto base dispara el error `Database has been closed` durante el remount y deja la shell congelada antes del login.

### 2. Refresh seguro

- Si no hay sesion, la app no intenta bootstrap remoto.
- Si hay sesion pero la red esta caida, se mantiene solo la vista local.
- Si el `profiles.role` remoto no coincide con el claim `app_metadata.role` del JWT persistido, la app fuerza `refreshSession()` antes de leer cartera para que RLS y shell local usen el mismo rol efectivo.
- Si hay items pendientes en la cola, primero se ejecutan `flushPaymentSyncQueue()` y `flushCollectionActionSyncQueue()`.
- Si despues del flush quedan pendientes o fallidos, la app bloquea el bootstrap remoto y conserva el estado local.

Razon:
el cache local ya puede contener efectos optimistas de pagos o gestiones no confirmadas. Refrescar desde servidor antes de limpiar la cola pisaria esas divergencias y haria ilegible la reconciliacion.

Riesgo adicional:
cuando `admin` cambia de privilegio o reingresa con un token viejo, el shell local puede recordar `admin` por `profiles`, pero Supabase seguir filtrando como `collector` si el JWT no se renovó. El refresh preventivo evita esa falsa cartera vacía sin exigir logout manual ni sacrificar reingreso offline cuando no hay red.

### 2.1. Ruta y prioridad operativa

- La UI ahora construye un tablero provisional de trabajo diario con `buildCollectorRouteBoard()`.
- La fuente de datos sigue siendo `CollectorWorkspaceSnapshot`, pero la agrupación ya no inventa la ruta desde cero: primero lee `customer.routeLabel`, que llega del bootstrap remoto alineado con `public.customers.route_label`.
- La ruta visible se toma primero desde `customer.routeLabel`. Si no existe por compatibilidad o datos heredados, la UI cae a `customer.neighborhood`; si tampoco existe, usa el tramo final de `customer.address` y luego `Ruta sin zona`.
- La lista queda ordenada por prioridad operativa: `sync-failed`, `overdue`, `due-today`, `scheduled`, `settled`.
- La franja de filtros, el bloque de métricas de ruta y la fila `buscar + casos` ya fueron movidos hacia composición más intrínseca (`auto-fit`, `minmax(...)`, `min-width: 0` y wrap móvil), pero el cierre visual del desborde horizontal sigue pendiente de verificación manual en dispositivo real.

Riesgo:
esta vista de rutas ya no debe contradecir PostgreSQL: `routeLabel` vigente llega desde remoto, pero la composición diaria todavía no equivale a una entidad dedicada de rutas. Si el backend introduce ese modelo formal, este derivado debe alinearse o retirarse para no mostrar una organización distinta.

### 2.2. Navegacion mobile-first

- La shell ya nace mobile-first desde `src/index.css`; desktop se expande con `@media (min-width: ...)`.
- En móvil la shell ya no obliga a recorrer una columna larga con cartera, detalle y cobro mezclados.
- `src/App.tsx` usa `activeMobilePane` para alternar las vistas base `portfolio` y `detail`.
- La navegación principal móvil ahora vive en `mobile-shell-header` y se abre desde `mobile-navigation-drawer` como menú hamburguesa visible desde el primer render, incluso durante bootstrap o bloqueo de entorno.
- El header móvil ya no depende de `dbReady`, `authReady` o `sessionUserId`; solo cambia el contenido del drawer según el estado actual del runtime.
- Sin entorno listo, el drawer solo expone configuración y arquitectura; no debe fingir login, cartera ni acciones de cobro.
- Durante bootstrap, el drawer solo expone estado y contexto del arranque local; no debe insinuar que la shell operativa ya está lista.
- Sin sesión, el drawer público solo ofrece acceso al login, reglas operativas y arquitectura; no debe fingir cartera ni acciones de cobro.
- Con sesión activa, el mismo menú hamburguesa expone `Cartera`, `Detalle` y `Operacion` sin depender de una barra inferior fija.
- La opción `Operacion` del drawer ya no depende de entrar primero a otro panel: abre una `operations-sheet` role-aware.
- El rol `collector` (cobrador) ve `Cobro`, `Gestion`, `Recibo`, `Cola` y `Reglas`.
- El rol `admin` (administrador) añade `Originacion` y `Reportes` sobre ese mismo menú, sin romper el mismo shell mobile-first.
- Para `admin`, la pestaña `Gestion` ya no se limita a novedades de visita: ahora expone una vista separada de cobradores activos y su alta rápida sin depender del wizard de originación.
- Esa vista `Gestion -> Cobradores activos` y el selector `Originacion -> Deudor -> Cobrador asignado` comparten la misma fuente de verdad: `public.profiles` filtrado por `role = collector` y `active = true`.
- La selección de un préstamo desde cartera mueve al panel `detail` para reducir pasos táctiles.
- La cartera ahora expone un selector desplegable de salto rápido por cliente/préstamo, acotado a la ruta visible y con búsqueda interna por nombre, documento, consecutivo o ruta.
- Ese selector no reemplaza el filtro libre principal: el `input` sigue siendo la fuente de búsqueda textual de la lista, mientras el selector sirve para abrir un expediente puntual sin barrer toda la cartera a mano.
- Ese salto rápido vive en un chunk diferido para no reabrir el presupuesto del shell inicial; la mejora de navegación no debe volver a empujar el `entry bundle` fuera de presupuesto.
- Con ese selector activo, la cartera ya no renderiza debajo una lista duplicada de usuarios/clientes; la selección primaria del expediente vive en el desplegable y el detalle se resuelve en el pane `detail`.
- El filtro de zonas ahora reutiliza el mismo patrón de selector buscable que el salto por cliente, pero sigue leyendo cada opción y su conteo desde `routeBoard.routes`.
- Ese selector de zonas queda como control único del filtro, para que el conteo por zona no se duplique en dos UIs distintas ni vuelva a castigar el presupuesto del shell.
- El detalle ofrece saltos directos a cobro y gestión.
- El encabezado operativo ya no promete acciones que el rol no puede ejecutar: el CTA `Originar prestamo` solo se muestra a `admin`.
- `collector` ya no ve accesos visibles de originación o reportes; el backend sigue siendo la autoridad final, pero la UI no debe insinuar permisos inexistentes.
- En el menú operativo, la entrada `management` ahora cambia su copy por rol: `collector` ve `Visita de Campo`, mientras `admin` ve `Cobradores`, porque ese pane ya materializa altas de cobradores y la misma bitácora de visita.
- `collector` sigue viendo solo su propia cartera operativa.
- `admin` reutiliza la misma shell, pero ahora con una cartera operativa agregada sobre los rows que RLS ya le permite leer; el hero, la lista y la ruta sí pueden incluir préstamos de otros cobradores.
- El panel `Reportes` se carga de forma diferida para no reabrir el presupuesto del shell inicial y usa la misma gramática responsive del resto de la hoja operativa.
- En desktop la misma fuente de verdad se expande a grilla y la hoja operativa deja de ser overlay para mostrarse como panel persistente.

Riesgo:
el menú hamburguesa móvil, la hoja de operaciones y la grilla desktop comparten exactamente los mismos componentes y el mismo estado. No se debe duplicar lógica por viewport ni volver a ocultar el header detrás del bootstrap o la sesión porque se rompería la consistencia entre descubribilidad móvil, selección, preview del cobro, cola offline y vistas por rol.

### 2.3. Service worker y entorno de desarrollo

- `registerServiceWorker()` solo registra `public/sw.js` fuera de desarrollo.
- Cuando la app corre con Vite en `import.meta.env.DEV`, la capa PWA desregistra service workers viejos del mismo origen y limpia caches `cobro-diario-shell-*`.
- La validación visual del menú móvil en desarrollo debe leer siempre el runtime Vite actual, no un shell offline cacheado.

Riesgo:
si se vuelve a registrar `sw.js` durante desarrollo, el navegador puede servir módulos viejos del mismo origen, ocultar cambios reales del drawer móvil y producir errores de HMR contra un runtime anterior.

### 3. Cobro

- La UI no envia un total libre a Supabase.
- El monto digitado se convierte en `applications` usando `buildOldestFirstPaymentApplications()`.
- El reparto sigue exactamente `fee -> interest -> principal` y cuota mas antigua primero.
- GPS se captura con `readBestEffortCoordinates()` solo si el navegador lo permite.
- El pago entra a `enqueueOfflinePayment()` y luego, si hay conectividad, intenta sincronizar.

### 3.2. Originacion V1 local

- La shell ya incorpora un wizard separado de `Cobro` para no mezclar originacion con cobranza diaria.
- El paso `Deudor` soporta:
  - `nuevo deudor`, con asignacion explicita de cobrador activo,
  - alta rápida de cobrador si no existe uno activo disponible,
  - y `deudor existente`, con busqueda remota por documento, nombre o telefono.
- El paso `Prestamo` captura capital, cuota, numero de cuotas, frecuencia, fechas y tasa diaria informativa.
- Los campos monetarios visibles del wizard y del cobro usan mascara COP mobile-first:
  - muestran separador de miles mientras el operador escribe,
  - ocultan `,00` solo cuando el valor redondeado realmente no tiene centavos,
  - pero conservan internamente el valor canonico con `.` decimal para no romper calculo ni RPC.
- El paso `Confirmacion` siempre muestra el cronograma canonico antes del submit.
- La UI nunca inventa un cronograma paralelo: usa el mismo contrato local de `origination-schedule.ts` y envia la preview serializada al RPC `originate_loan`.
- `collector` no puede originar: la UI lo deja visible como flujo bloqueado para no fingir permisos que el backend niega.
- La originacion V1 exige conexion y lo declara explicitamente antes de confirmar.
- Mientras el submit esta en curso, el boton de confirmacion queda deshabilitado para no duplicar altas.
- `interest_rate_daily` sigue persistiendo con 6 decimales, pero la UI ya lo presenta como campo referencial opcional; V1 no recalcula la cuota desde ese dato.
- Cuando la originacion termina bien en móvil, la `operations-sheet` se cierra para liberar el viewport táctil.
- En desktop, ese mismo éxito no oculta el panel persistente: lo devuelve a la operación base (`Cobro`) para desmontar el estado de éxito del wizard sin romper la gramática de tres columnas.
- El enfoque automatico al detalle del préstamo sigue siendo condicional: solo ocurre si el préstamo nuevo entra en la cartera local del usuario que está operando en ese dispositivo.
- Si `admin` origina para otro cobrador, el refresh posterior ya incorpora ese préstamo en la vista de administración y puede enfocarlo por `external_loan_number` sin exigir cambio de sesión.
- Cuando `admin` cobra o registra una gestión sobre un préstamo visible de otro cobrador, la operación se materializa usando el `collectorId` dueño del préstamo para no romper `record_payment()` ni la trazabilidad del caso.
- La semántica accesible del panel (`aria-hidden` / `inert`) sigue el mismo breakpoint de 60rem que usa CSS para no dejar contenido visible marcado como oculto ni contenido oculto todavía enfocable desde teclado.
- El alta rápida de cobrador usa la RPC `public.provision_collector_account()` para materializar `auth.users`, `auth.identities` y `public.profiles` del lado del servidor, sin abrir un segundo cliente GoTrue en el navegador ni depender de `INSERT` directo sobre `public.profiles`.
- Si el correo ya existe en `auth.users` pero quedó sin `public.profiles` por el flujo roto anterior, el mismo RPC lo reconcilia y lo devuelve a la lista de cobradores activos en vez de dejarlo atrapado como duplicado invisible.

Riesgo:
OR-4 ya cerró esa convergencia: el bootstrap remoto conserva el consecutivo y metadatos del préstamo originado, la búsqueda ya puede encontrarlo por `external_loan_number` y el detalle del expediente ya muestra cronograma/frecuencia sin inventar una segunda fuente local.

Riesgo adicional:
si cambia el shape requerido por GoTrue para usuarios creados por SQL, este RPC debe revisarse junto con los seeds `phase4_*` y `phase7_landing_roles.sql`; dejar tokens o strings criticos en `NULL` vuelve a romper el login antes de llegar al dominio operativo.

### 3.1. Gestion de visita con cola offline

- La shell ya permite registrar `promise_to_pay`, `not_found`, `return_visit` y `visited_no_payment`.
- La UI ya no se queda en un helper local aislado: `enqueueOfflineCollectionAction()` guarda la gestión en IndexedDB, la deja visible de inmediato y la mete en `syncQueue`.
- El resultado se refleja en cartera, detalle del préstamo, búsquedas del mismo dispositivo y en la sección `Gestion` del menú operativo.
- Si la gestión implica seguimiento (`promise_to_pay` o `return_visit`), la UI exige fecha.
- GPS y nota siguen siendo best-effort, igual que en pagos.
- Cuando la sesión es `admin`, esa misma sección `Gestion` añade un bloque estable de administración de cobradores para no obligar al operador a entrar a `Originacion` solo para crear el recurso que el deudor nuevo necesita.
- Cuando vuelve la conectividad, `flushCollectionActionSyncQueue()` reintenta el mismo payload contra `record_collection_action()` usando `deviceLocalId` como llave idempotente.

Riesgo:
la UI ya quedó alineada al contrato remoto, la revalidación en `LANDING` ya pasó con las compuertas de rutas y gestiones y el presupuesto inicial del bundle volvió a verde. El riesgo abierto de esta línea queda acotado a la validación manual móvil pendiente; GPS no forma parte del cierre activo por decisión del usuario.

### 4. Cierre de sesion

- No se permite cerrar sesion si la cola tiene `pending`, `processing` o `failed`.
- Si la cola esta limpia, se hace `signOut()` y luego se borra el cache operativo local.

Razon:
no se debe dejar cartera ni pagos pendientes de un cobrador visibles para otro usuario del mismo dispositivo.

## Tradeoffs UX documentados

### Lista grande

- Se usa `useDeferredValue()` en el buscador para no acoplar cada tecla al render de toda la cartera.
- La lista es compacta y sin anidaciones pesadas para no penalizar movil.
- La navegación por paneles evita que el cobrador tenga que atravesar secciones ajenas antes de llegar al cobro en pantalla pequeña.
- La compuerta automatizada ya cubre dataset simulado grande; Fase 4 sigue abierta solo por validacion manual y tactil en dispositivo fisico.

### Recibo

- La UI ya no trata el recibo local como autoridad final.
- `src/App.tsx` abre el panel `Recibo`, conserva el último `LocalPayment` como evidencia operativa inmediata y, cuando existe `remotePaymentId`, rehidrata el comprobante confirmado desde `public.get_payment_receipt()`.
- La vista distingue explícitamente `pendiente en cola`, `enviando`, `fallido`, `sin id remoto`, `confirmado por servidor` y `reversado por servidor`.
- El desglose por cuota, capital, interés y mora del comprobante confirmado sale del backend y no se reconstruye desde `IndexedDB`.
- El panel separa `comprobante confirmado del pago` de `estado actual del crédito`: saldo actual, saldo en atraso, días de atraso, próxima cuota y conteos operativos salen del `loanCard` activo como snapshot local rehidratado, no del JSON autoritativo del pago.
- El PDF se prepara apenas llega el comprobante confirmado; el usuario no espera otra generación manual después de registrar el pago.
- En móvil, la acción principal del recibo prioriza `Compartir PDF` cuando el navegador soporta Web Share con archivos; si no, cae a `Guardar PDF` usando el mismo artefacto ya preparado.
- El recibo confirmado ahora expone un CTA único para compartir o guardar; el PDF se genera en browser con `jspdf` desde el mismo chunk diferido del recibo, sin inflar el shell inicial del teléfono.
- La exportación PDF mantiene el mismo contrato visible del panel: cobrador, referencia de recibo, aplicaciones por cuota y snapshot operativo del crédito al momento de la descarga.
- Si el recibo confirmado sigue vigente, una sesión `admin` online puede reversarlo desde el mismo panel con motivo obligatorio; la UI no expone ese CTA a `collector` ni offline.
- Cuando el pago ya fue compensado, el panel muestra `reversal.reason`, `reversal.reversedAt` y `reversal.reversedBy` devueltos por PostgreSQL.
- Impresión térmica Bluetooth no quedó fingida: `src/lib/receipts/bluetooth-printer.ts` documenta Web Bluetooth como objetivo diferido que solo puede avanzar con smoke manual y hardware soportado.

### Reportes operativos

- La UI ya no trata los reportes como una fase futura abstracta: `src/lib/reports/report-panel.tsx` abre un panel visible solo para `admin`.
- El backend devuelve métricas, breakdown por cobrador, rutas y estados desde `public.get_operational_report()`.
- Los filtros visibles del panel son `cobrador`, `ruta` y `estado del prestamo`; la UI no inventa agregados paralelos por fuera de esa RPC.
- La tarjeta de salud de sincronización sigue leyendo la cola local del dispositivo porque IndexedDB es caché operativa; no debe presentarse como agregado remoto de todos los equipos.
- El panel vive en un chunk diferido para no penalizar el primer render del teléfono.

### Primitivas compartidas

- `src/index.css` sigue siendo la fuente de verdad de tokens y primitivas visuales.
- `.input` ya es la primitiva unificada para login, búsqueda y registro de cobro.
- `.money-input` extiende esa primitiva para alinear montos a la derecha sin cambiar el contrato contable de 2 decimales.
- Las clases de shell operativa (`.ops-grid`, `.route-filter-select`, `.queue-row`, `.receipt-card`) viven en el mismo archivo para evitar estilos dispersos o inline.
- La gestión de visita usa `management-card`, `management-panel` y `management-actions` en la misma capa compartida.

### Perfil faltante

- Si la sesion existe pero `public.profiles` no tiene fila, la UI no finge operacion normal.
- Se muestra el bloqueo explicito porque sin perfil no hay alcance RLS interpretable para negocio.

## Dataset y smoke remoto

- El dataset operativo de Fase 4 vive en `supabase/seeds/phase4_landing_smoke.sql`.
- Ese seed ahora es reiniciable: limpia pagos previos sobre sus préstamos semilla y vuelve a dejar un cobrador, un dispositivo, cuatro clientes, cuatro préstamos y nueve cuotas en estados `due-today`, `delinquent`, `scheduled` y `settled`.
- El gate remoto reproducible vive en `scripts/phase4-auth-user.mjs` y valida `signInWithPassword` más lecturas RLS reales contra `profiles`, `customers`, `loans` e `installments`, además de confirmar que el dataset esperado quedó completo y con los estados mínimos de regresión.
- `npm run test:phase4` ya incluye un recorrido automatizado de jornada del cobrador (`bootstrap -> ruta -> gestion local -> cobro oldest-first -> cola -> sync`) para validar fórmulas y cambios de estado sin depender todavía de un dispositivo físico.
- El smoke móvil reproducible vive en `scripts/phase4-mobile-smoke.mjs` y valida login, drawer móvil, cobro offline, cola local y resync online en viewport `390x844` contra `LANDING`.

Riesgo conocido:
si se vuelve a crear un usuario de `auth.users` por SQL directo, no se pueden dejar columnas como `confirmation_token`, `recovery_token` o `email_change` en `NULL`. En este proyecto GoTrue las lee como strings durante `/token`, y ese detalle rompe el login antes de llegar a las tablas operativas.

## Estado actual de la fase

Implementacion base lista el 5 de mayo de 2026, pero Fase 4 no debe marcarse completada todavia.

Pendientes reales:

- ejecutar `docs/phase4-manual-validation.md` en dispositivo real,
- validar con uso tactil real la navegacion por rol, la gestion de visita y el panel de reportes en telefono,
- confirmar percepción final en dispositivo físico aun cuando el dataset grande simulado ya pasó por compuerta automatizada.
