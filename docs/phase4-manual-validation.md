# Validación Manual de Fase 4 en Dispositivo Real

Este documento no reemplaza `docs/implementation-plan.md`.

- Fuente de verdad de avance: `docs/implementation-plan.md`
- Control complementario funcional: `docs/phase-control.md`
- Fuente de verdad UX y restricciones operativas: `docs/operational-ui.md`
- Evidencia de cierre: `docs/audit-report.md` y `docs/session-handoff.md`

## Objetivo

Dejar un procedimiento único para la brecha real que sigue abierta en Fase 4:

- tactilidad real en teléfono,
- gestión de visita con uso manual,
- percepción visual final del flujo operativo,
- confirmación de que la shell sigue siendo usable fuera del entorno headless.

## Restricciones operativas

- PostgreSQL/Supabase sigue siendo la fuente de verdad del cobro confirmado.
- IndexedDB sigue siendo caché operativa y cola local; no debe confundirse con confirmación remota.
- La gestión de visita sigue siendo `local-only`; esta validación confirma continuidad táctica, no auditoría remota.
- Este checklist no autoriza cerrar Fase 4 si aparece un bloqueo táctil, visual o de continuidad que el smoke automatizado no cubre.

## Prerrequisitos

- Tener `npm run check` en verde en la misma rama o sesión donde se va a ejecutar la validación manual.
- Tener `npm run test:phase4` en verde para la compuerta automatizada de UI, bootstrap y cartera simulada grande.
- Tener `npm run test:perf` en verde para confirmar que el bundle inicial y la ruta grande siguen dentro del presupuesto local de `BR-1`.
- Tener evidencia vigente de `scripts/phase4-auth-user.mjs` y `scripts/phase4-mobile-smoke.mjs` en la misma rama o en la evidencia inmediata del cierre.
- Usar un teléfono o dispositivo físico real con navegador móvil real.
- Exponer la app al dispositivo desde la misma rama validada.

Opciones aceptables para exponer la app al teléfono:

1. `npm run dev -- --host 0.0.0.0 --port 4174`
2. `npm run build`
3. `npm run preview -- --host 0.0.0.0 --port 4174`

Credenciales:

- usar el usuario y la clave de smoke ya documentados en `docs/session-handoff.md`,
- no duplicar credenciales en evidencia nueva si no hace falta.

## Datos mínimos a registrar antes de empezar

- Fecha y hora
- Rama o commit probado
- Dispositivo real usado
- Sistema operativo y navegador
- Modo de acceso: `dev` o `preview`
- Red usada: Wi-Fi, datos, hotspot u otra

## Procedimiento de ejecución

### 1. Arranque y descubribilidad

- Abrir la app desde el teléfono con el shell recién cargado.
- Confirmar que el patrón móvil de navegación es visible desde el primer render.
- Abrir y cerrar el menú principal sin autenticar.
- Confirmar que el drawer no ofrece acciones operativas falsas antes del login.

Aprobar solo si:

- el header móvil es visible sin taps extra,
- el drawer abre y cierra sin congelarse,
- no hay contenido cortado por notch, barras del navegador o teclado.

### 2. Login y bootstrap real

- Iniciar sesión con el usuario de smoke documentado.
- Esperar bootstrap completo de cartera.
- Confirmar que la cartera visible coincide con el flujo autenticado esperado.
- Entrar a `Cartera`, `Detalle` y `Operacion` desde el mismo menú móvil.

Aprobar solo si:

- login y bootstrap terminan sin bucles, pantallas vacías o bloqueo perceptible,
- el cambio entre paneles no exige precisión fina ni taps repetidos,
- el estado autenticado conserva navegación descubierta y consistente.

### 3. Cartera, detalle y legibilidad táctica

- Abrir al menos un préstamo desde la cartera.
- Confirmar que el detalle muestra cliente, saldo, estado y cuotas con lectura clara.
- Volver a cartera y repetir la selección al menos una vez.
- Confirmar que búsqueda, scroll y selección no generan saltos visuales serios.

Aprobar solo si:

- la lectura principal es clara con uso de una mano,
- no hay scroll horizontal accidental,
- el panel activo y el préstamo seleccionado siguen siendo entendibles después de navegar.

### 4. Cobro offline y cola local

- Con sesión ya iniciada, poner el teléfono offline.
- Abrir `Operacion`.
- Usar `Cuota actual` y confirmar un cobro.
- Verificar que la cola y el recibo local cambian a estado pendiente.

Aprobar solo si:

- la UI muestra el estado offline de forma evidente,
- el cobro queda registrado en cola sin romper la pantalla,
- el recibo local deja claro que aún no existe confirmación remota.

### 5. Re-sync online

- Restaurar conectividad en el teléfono.
- Esperar el flush automático de la cola.
- Confirmar que la cola queda sin pendientes y que el recibo pasa a sincronizado.
- Verificar que la cartera y el detalle siguen siendo coherentes después del re-sync.

Aprobar solo si:

- la transición `offline -> online` no obliga a recargar manualmente,
- la cola drena sin duplicados visibles ni estados inconsistentes,
- el cobro confirmado sigue legible desde la UI.

### 6. Gestión de visita local

- Abrir `Gestion` desde `Operacion`.
- Registrar al menos una gestión con seguimiento (`promise_to_pay` o `return_visit`).
- Registrar al menos una gestión sin seguimiento (`not_found` o `visited_no_payment`).
- Confirmar que la gestión queda visible al volver a cartera y detalle dentro del mismo dispositivo.

Aprobar solo si:

- las gestiones con seguimiento exigen fecha de forma clara,
- la navegación no pierde la gestión recién registrada,
- la UI deja claro que la gestión sigue siendo local y no remota.

### 7. Percepción visual y tactilidad final

- Repetir el recorrido `menú -> detalle -> operación -> cartera` con uso normal de pulgar.
- Abrir teclado en login o cobro y confirmar que no hay zoom intrusivo ni campos tapados.
- Confirmar que botones críticos, filas seleccionables y cierres de sheet responden sin frustración táctil.
- Confirmar que no aparecen estados visuales rotos al alternar orientación o al volver desde background si el teléfono lo permite.

Aprobar solo si:

- no hay targets táctiles demasiado pequeños para operación continua,
- no aparecen overlays atascados ni sheets imposibles de cerrar,
- la sensación general permite operar sin fricción seria.

## Registro de resultado

Nota vigente al `2026-05-07`:

- este procedimiento queda archivado como validación manual diferida por decisión de producto,
- no bloquea el cierre activo de Fase 4,
- y debe ejecutarse solo si en una sesión futura se vuelve a exigir evidencia física/táctil.

Copiar este bloque y completarlo en `docs/audit-report.md` cuando se ejecute la validación real:

```md
### Validación manual en dispositivo real de Fase 4

- Fecha:
- Alcance: cierre operativo/manual de Fase 4 en teléfono real
- Dispositivo:
- SO / Navegador:
- Rama o commit:
- Modo de acceso:
- Red usada:
- Comandos previos:
  - `npm run test:phase4`
  - `npm run test:perf`
  - `npm run check`
- Resultado general: `aprobado` | `bloqueado`
- Resultado por tramo:
  - Arranque y descubribilidad:
  - Login y bootstrap:
  - Cartera y detalle:
  - Cobro offline:
  - Re-sync online:
  - Gestión de visita:
  - Tactilidad y percepción final:
- Hallazgos:
  - ...
- Riesgo remanente:
  - ...
```

## Criterio de cierre de Fase 4

Fase 4 solo puede cerrarse si:

- `npm run test:phase4` sigue en verde,
- `npm run check` sigue en verde,
- este procedimiento se ejecutó en dispositivo físico real,
- el resultado quedó registrado en `docs/audit-report.md`,
- `docs/session-handoff.md` refleja si la fase quedó cerrada o sigue bloqueada,
- no quedó un hallazgo táctil, visual o de continuidad que invalide la operación móvil real.
