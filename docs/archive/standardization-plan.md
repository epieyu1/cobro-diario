# Subplan de Estandarización de UI

Estado documental:

- Subplan cerrado y archivado.
- No debe seguirse como plan activo del proyecto.
- Su evidencia viva quedó en `docs/audit-report.md`.
- El roadmap activo sigue en `docs/implementation-plan.md`.

Este documento no reemplaza el roadmap maestro del proyecto.

- La fuente de verdad de fases sigue siendo `docs/implementation-plan.md`.
- Este subplan solo organiza el trabajo de diseño compartido dentro de la Fase 4.
- Todo cambio que cierre un bloque de este documento debe actualizar `docs/audit-report.md`.

## Regla transversal

- Toda UI nueva o modificada debe diseñarse `mobile-first`.
- El teléfono es el caso primario de uso; tablet y desktop son expansiones del mismo flujo, no el punto de partida.
- No se deben introducir layouts o interacciones que requieran hover, ancho amplio o precisión de mouse como vía principal sin una excepción documentada.
- Cualquier decisión visual que sacrifique legibilidad, velocidad o alcance táctil en móvil debe justificarse explícitamente.

## Estado base verificado

Situación real del repo al 5 de mayo de 2026:

- Ya existen tokens visuales globales en `src/index.css`.
- Ya existen primitivas compartidas como `.panel`, `.button` y `.status-card`.
- No se encontraron `style={{...}}` en `src/**/*.tsx` o `src/**/*.jsx` durante la auditoría base.
- Sigue faltando estandarizar mejor formularios, variantes semánticas y evidencia formal de responsive/rendimiento.

## Subfase 4.1: Consolidación de Tokens

Objetivo:
dejar una única fuente de verdad para colores, radios, sombras, espaciados y tipografía base.

Tareas:

- decidir si los tokens viven definitivamente en `src/index.css` o se extraen a `src/styles/tokens.css`,
- evitar duplicar valores visuales en múltiples archivos sin justificación,
- documentar explícitamente el archivo fuente de verdad elegido.

Test de verificación:

- modificar un token global como `--accent` y comprobar que el cambio impacta las superficies y botones que dependen de él,
- registrar en `docs/audit-report.md` qué archivo quedó como fuente final.

## Subfase 4.2: Primitivas Compartidas

Objetivo:
normalizar las clases base que sostienen la UI operativa para que futuras pantallas no reinventen estilos.

Tareas:

- consolidar primitivas como `.panel`, `.button`, `.status-card` e `.input`,
- reducir variantes improvisadas cuando una primitiva compartida pueda resolverlas,
- documentar excepciones cuando un componente deba romper el sistema base.

Test de verificación:

- reemplazar al menos un fragmento repetido por una primitiva compartida sin degradar UX,
- comprobar que la UI mantiene consistencia visual entre login, cartera y detalle de préstamo.

## Subfase 4.3: Política de Inline Styles

Objetivo:
prohibir estilos inline estáticos y dejar solo excepciones realmente dinámicas o técnicas.

Tareas:

- impedir `style={{...}}` para diseño estático en JSX/TSX,
- permitir inline styles solo cuando el valor sea dinámico y no tenga sentido llevarlo a clases,
- documentar la excepción inline si toca geometría dinámica, canvas o cálculo por runtime.

Test de verificación:

- ejecutar:

```bash
rg -n "style=\\{\\{" src --glob "*.tsx" --glob "*.jsx"
```

- el resultado esperado es vacío o limitado a excepciones justificadas en comentario inline.

## Subfase 4.4: Documentación de Fragmentos Críticos

Objetivo:
hacer que otro asistente pueda tocar UI, auth o sync sin romper el flujo por falta de contexto.

Tareas:

- documentar intención del bloque,
- documentar flujo de comunicación o de datos cuando aplique,
- documentar riesgo o restricción si tocar ese bloque puede romper consistencia operativa.

Test de verificación:

- revisar archivos tocados y confirmar que un lector puede responder:
  - por qué existe el bloque,
  - de dónde vienen los datos y a dónde van,
  - qué se rompe si se altera sin cuidado.

## Subfase 4.5: Integración con Estándares del Repo

Objetivo:
evitar que este subplan quede aislado o compita con los documentos ya vigentes.

Tareas:

- alinear `AGENTS.md`, `docs/engineering-standards.md` y `docs/commenting-standard.md`,
- enlazar este subplan desde la Fase 4 cuando corresponda,
- mantener `docs/audit-report.md` como evidencia operativa de cumplimiento.

Test de verificación:

- confirmar que los estándares permanentes ya contienen:
  - prohibición de inline styles estáticos,
  - exigencia de comentarios con intención + flujo + riesgo,
  - obligación de actualizar auditoría en tareas de UI compartida.
