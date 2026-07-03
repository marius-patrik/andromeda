# darkfactory-templates

Bun and TypeScript templates monorepo for DarkFactory-managed repositories.

## Bun Workspaces

- `packages/cli` - command-line package template.
- `packages/web` - web package template served by Bun.

## Template Submodules

- `templates/template-bot`
- `templates/template-cli`
- `templates/template-repo`
- `templates/template-web`

## Setup

```powershell
bun install
bun run sync:submodules
bun run typecheck
bun run build
```

Run package scripts from the root:

```powershell
bun run dev:cli
bun run dev:web
```
