# Guía de Terminología Operativa

Este documento no reemplaza `docs/reference-benchmarks.md`.

- Fuente de verdad de referentes: `docs/reference-benchmarks.md`
- Fuente de verdad de UI operativa: `docs/operational-ui.md`
- Evidencia de cambios visibles: `docs/audit-report.md`

## Objetivo

Fijar la terminología visible del producto para que la app y la documentación operativa hablen con
las mismas palabras que usan los referentes del mercado.

Regla base:

- la UI y la documentación operativa deben usar términos de producto en español,
- los identificadores técnicos pueden seguir en inglés cuando formen parte de código, RPC, tipos o
  columnas,
- y cuando un documento cite un código interno, debe acompañarlo con su término visible si eso
  evita ambigüedad.

## Léxico preferido

| Código o anglicismo | Término visible obligatorio | Uso esperado |
| --- | --- | --- |
| `admin` | administrador | roles, permisos, vistas administrativas |
| `collector` | cobrador | trabajo de calle, asignación, cartera |
| `receipt` | recibo | evidencia visible del cobro |
| `confirmed receipt` | recibo confirmado | cobro ya confirmado por servidor |
| `report` | reporte | paneles e indicadores administrativos |
| `sync` | sincronización | cola local, reintentos y estado de envío |
| `offline` | sin conexión | operación sin red |
| `online` | con conexión | operación con red disponible |
| `route` / `routeLabel` | ruta | organización diaria de cobro |
| `setup` | configuración | preparación del entorno o la app |
| `runtime` | sistema | estado operativo de la aplicación |
| `bootstrap` | carga inicial | arranque operativo del shell |
| `workspace` | cartera operativa | vista de trabajo del cobrador o administrador |
| `pending` | pendiente | estado de cola o recibo local |
| `processing` | en envío | estado de cola en curso |
| `failed` | con error | estado de cola o sincronización fallida |
| `confirmed` | confirmado | estado visible del recibo |
| `posted` | confirmado | estado remoto ya aplicado |
| `reversed` | reversado | estado del cobro compensado |
| `COP` / `$` | `COP` | visualización monetaria oficial del proyecto |
| `oldest_first` | abono por antigüedad | modo V1 de aplicación |
| `principal_only` | abono solo a capital | modo dirigido V2 |
| `interest_only` | abono solo a interés | modo dirigido V2 |
| `compound_fixed_installment` | interés compuesto con cuota fija | contrato V2 visible |

## Léxico de benchmark que debe preservarse

Cuando exista duda entre dos palabras válidas, priorizar estas porque ya aparecen en los
referentes externos del producto:

- cartera,
- cobrador,
- ruta,
- recibo,
- impresión Bluetooth,
- reporte,
- interés compuesto,
- cuota fija,
- abono solo a capital,
- abono solo a interés,
- sin conexión,
- sincronización.

## Regla de redacción

- En UI visible: no dejar `admin`, `collector`, `setup`, `runtime`, `sync`, `receipt` o estados de
  cola en inglés.
- En documentación operativa: se permite citar el código interno entre backticks, pero la frase
  principal debe usar el término visible.
- En comentarios técnicos: mantener el identificador interno cuando describa contrato de código, no
  cuando describa copy de producto.
