# Cobro Diario

Base profesional para una WebApp de cobro diario con arquitectura offline-first, frontend en React y backend transaccional en Supabase.

## Stack inicial

- React 19 + Vite 8 + TypeScript
- Supabase CLI para desarrollo local y migraciones versionadas
- Supabase JS para acceso al backend
- Dexie sobre IndexedDB para almacenamiento local
- TanStack Query para estado remoto
- `decimal.js` y `date-fns` para reglas financieras

## Comandos

```bash
npm install
npm run dev
npm run lint
npm run build
npm run db:start
npm run db:reset
```

## Documentacion operativa

- [Arquitectura](./docs/architecture.md)
- [MCP y servicios externos](./docs/mcp-setup.md)
- [Estándares de ingeniería](./docs/engineering-standards.md)
- [Estándar de comentarios](./docs/commenting-standard.md)
- [Contrato para asistentes](./AGENTS.md)

## Notas de bootstrap

- El repo ya incluye `.mcp.json` para Vercel, Supabase y GitHub.
- GitHub puede requerir autenticacion global adicional en Codex, documentada en `docs/mcp-setup.md`.
- La migracion inicial crea el dominio base, RLS y un RPC transaccional para registrar pagos por aplicaciones.
- El Service Worker es manual. No se agrego `vite-plugin-pwa` porque su peer dependency actual no resuelve con Vite 8 en este entorno.
