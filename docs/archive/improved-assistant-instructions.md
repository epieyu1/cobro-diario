# Addenda de UI y Documentación para Asistentes

Estado documental:

- Documento archivado.
- Su contenido útil ya fue absorbido por `AGENTS.md`, `docs/engineering-standards.md` y `docs/commenting-standard.md`.
- No debe usarse como estándar activo ni como plan del proyecto.

Este archivo no sustituye `AGENTS.md`, `docs/engineering-standards.md` ni
`docs/commenting-standard.md`.

Su propósito es dejar claro qué deltas conviene aplicar al estándar permanente del repo
cuando el trabajo toque UI compartida, diseño o flujos operativos visibles.

## Deltas válidos para integrar

### 1. Inline styles

- Prohibir `style={{...}}` para diseño estático en JSX/TSX.
- Permitirlo solo cuando el valor sea verdaderamente dinámico y no tenga mejor traducción a clases o variables CSS.

### 2. Documentación de fragmentos críticos

Cuando un bloque toque UI operativa, auth, sync o integraciones externas, debe dejar:

- intención,
- flujo de datos o comunicación si aplica,
- riesgo o restricción si tocarlo rompe el contrato existente.

### 3. Auditoría obligatoria de UI

- Antes de cerrar una tarea que cambie diseño compartido o UX operativa, actualizar `docs/audit-report.md`.
- La auditoría debe dejar evidencia verificable, no solo una marca visual.

### 4. No crear estándares paralelos

- `docs/implementation-plan.md` sigue siendo el roadmap maestro.
- `docs/archive/standardization-plan.md` solo conserva el subplan histórico de Fase 4.
- Si aparece conflicto entre documentos, prevalecen `AGENTS.md` y los estándares permanentes del repo.

## Reglas descartadas a propósito

Este addendum no fija una estética obligatoria como “glassmorphism” ni impone reglas
de assets que no sean estables o auditables. Las decisiones visuales deben responder al
producto y a `docs/reference-benchmarks.md`, no a gustos arbitrarios del asistente.
