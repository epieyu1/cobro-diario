# Checklist de Release

Este documento no reemplaza `docs/implementation-plan.md`.

- Fuente de verdad de fases: `docs/implementation-plan.md`
- Runbook operativo: `docs/deployment-runbook.md`
- Cierre manual de Fase 4: `docs/phase4-manual-validation.md`

## Objetivo

Evitar un release improvisado cuando Fase 5 se active de verdad.

## Checklist previo a preview

- [ ] Fase 4 cerrada para el alcance activo segun `docs/implementation-plan.md`.
- [ ] `npm run check` en verde en la rama candidata.
- [ ] `npm run test:perf` en verde en la rama candidata.
- [ ] Variables públicas auditadas contra `.env.example`.
- [ ] No existe secreto operativo expuesto en variables `VITE_*`.
- [ ] El estado local candidato ya está agrupado en commits coherentes.
- [ ] La rama/commit candidato ya existe en GitHub; no desplegar desde un worktree local suelto.
- [ ] `docs/session-handoff.md` refleja el estado real de la rama.

## Checklist de preview

- [ ] Preview desplegado desde la rama/commit correcto.
- [ ] El commit desplegado coincide con el commit registrado en GitHub.
- [ ] URL de preview registrada.
- [ ] Login funcional.
- [ ] Lectura de cartera funcional.
- [ ] Detalle y operación accesibles.
- [ ] Estados de sync visibles.
- [ ] Recibo confirmado y exportación PDF funcionales en el preview.
- [ ] Smoke de preview documentado.

## Checklist de rollback

- [ ] Existe commit previo conocido en verde.
- [ ] Existe procedimiento para re-desplegarlo como preview.
- [ ] El criterio para descartar un preview fallido quedó explícito.
- [ ] El rollback procedural quedó registrado en `docs/session-handoff.md` si se usa.

## Checklist de liberación posterior

- [ ] No quedan bloqueos abiertos de seguridad, sync o UX crítica.
- [ ] La estrategia de recibo físico/Bluetooth está definida si entra al release.
- [ ] La operación básica y debugging siguen vigentes frente al estado real del repo.
- [ ] La decisión de pasar de preview a release explícita quedó autorizada por el usuario.
