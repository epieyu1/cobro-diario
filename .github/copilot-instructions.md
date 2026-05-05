# GitHub Copilot Instructions

Antes de editar este repositorio:

1. Lee `AGENTS.md`.
2. Lee `docs/engineering-standards.md`.
3. Lee `docs/commenting-standard.md`.
4. Lee los comentarios del archivo objetivo antes de cambiar la lógica.

Reglas críticas:

- No rompas flujos financieros, de sincronización ni de seguridad sin actualizar primero la documentación inline y la documentación en `docs/`.
- Si agregas lógica nueva, comenta intención, restricciones y dependencias externas.
- Si tocas Supabase, respeta RLS, RPC transaccional y la separación entre caché local y fuente de verdad.
- No modifiques credenciales ni despliegues sin autorización explícita del usuario.
