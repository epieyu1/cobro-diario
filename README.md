# Cobro Diario

Base profesional para una WebApp de cobro diario con arquitectura offline-first, frontend en React y backend transaccional en Supabase.

## Stack inicial

- React 19 + Vite 8 + TypeScript
- Supabase CLI para desarrollo local y migraciones versionadas
- Supabase JS para acceso al backend
- Dexie sobre IndexedDB para almacenamiento local
- `decimal.js` para reglas financieras

## Comandos

```bash
npm install
npm run dev
npm run lint
npm run build
npm run test:perf
npm run db:playground:reset
npm run playground -- status fase4.playground@cobrodiario.dev 123456
npm run db:start
npm run db:reset
```

## Documentacion operativa

- [Handoff de sesión](./docs/session-handoff.md)
- [Plan de implementación](./docs/implementation-plan.md)
- [Arquitectura](./docs/architecture.md)
- [Contrato financiero V1](./docs/financial-contract-v1.md)
- [Sync offline](./docs/offline-sync.md)
- [UI operativa](./docs/operational-ui.md)
- [Runbook de despliegue y operación](./docs/deployment-runbook.md)
- [Checklist de release](./docs/release-checklist.md)
- [Referentes de producto](./docs/reference-benchmarks.md)
- [MCP y servicios externos](./docs/mcp-setup.md)
- [Estándares de ingeniería](./docs/engineering-standards.md)
- [Estándar de comentarios](./docs/commenting-standard.md)
- [Contrato para asistentes](./AGENTS.md)

## Notas de bootstrap

- El repo ya incluye `.mcp.json` para Vercel, Supabase y GitHub.
- GitHub puede requerir autenticacion global adicional en Codex, documentada en `docs/mcp-setup.md`.
- La migracion inicial crea el dominio base, RLS y un RPC transaccional para registrar pagos por aplicaciones.
- El contrato financiero temporal vive documentado inline en `src/lib/finance/payment-contract.ts` y en `record_payment`.
- La UI operativa minima ya vive en `src/App.tsx` y usa `src/lib/collector/collector-workspace.ts` + `src/lib/finance/payment-planning.ts`.
- `LANDING` ya tiene un dataset operativo reiniciable de Fase 4 en `supabase/seeds/phase4_landing_smoke.sql` y un smoke remoto en `scripts/phase4-auth-user.mjs`.
- `LANDING` tambien tiene un playground remoto editable en `supabase/seeds/phase4_landing_playground.sql` con operaciones reales via `scripts/phase4-playground.mjs` para consultar cartera, registrar pagos y liquidar prestamos.
- Fase 4 ya quedó cerrada para el alcance activo; la validación manual en dispositivo real quedó diferida por decisión de producto y no bloquea Fase 5.
- El Service Worker es manual. No se agrego `vite-plugin-pwa` porque su peer dependency actual no resuelve con Vite 8 en este entorno.
