# MCP y servicios externos

## Estado del repo

El proyecto ya incluye `.mcp.json` con servidores remotos para:

- GitHub
- Vercel
- Supabase

Despues de autenticar cada servicio, reinicia Codex para que la sesion vuelva a detectar los MCP servers.

## GitHub

Fuente oficial consultada: repositorio `github/github-mcp-server`.

### Opcion recomendada para Codex

Agregar GitHub MCP a nivel global si la autenticacion remota del `.mcp.json` no es suficiente:

```toml
[mcp_servers.github]
url = "https://api.githubcopilot.com/mcp/"
bearer_token_env_var = "GITHUB_PAT_TOKEN"
```

Variables recomendadas:

```bash
export GITHUB_PAT_TOKEN=tu_pat
```

El PAT debe incluir como minimo los permisos necesarios para repos, PRs y checks del flujo que vayas a usar.

## Vercel

Fuente oficial consultada: documentacion MCP de Vercel.

Servidor remoto:

```text
https://mcp.vercel.com
```

Comando equivalente si prefieres alta global:

```bash
codex mcp add vercel --url https://mcp.vercel.com
```

## Supabase

Fuente oficial consultada: guia MCP de Supabase.

Servidor remoto:

```text
https://mcp.supabase.com/mcp
```

Comando equivalente:

```bash
codex mcp add supabase --url https://mcp.supabase.com/mcp
```

Si quieres fijar el proyecto remoto directamente, puedes pasar `project_ref` en la URL una vez exista el proyecto final.

## Flujo recomendado

1. Crear o vincular repo en GitHub.
2. Conectar ese repo en Vercel para despliegues por rama.
3. Crear proyecto en Supabase y enlazarlo con `supabase link`.
4. Autenticar MCPs.
5. Reiniciar Codex y verificar disponibilidad de herramientas MCP antes de continuar con cambios de infraestructura.
