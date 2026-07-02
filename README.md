# agents

Bun TypeScript CLI for managing agent packages, shared skills/plugins, CLI data,
and a common credit store.

## Usage

```sh
bun install
bun link
agents list
agents state init
agents state env
agents doctor
```

## Commands

- `agents list [--json]` lists registered packages from `.gitmodules`.
- `agents info <name-or-path> [--json]` shows package metadata.
- `agents add <name> <git-url> [--kind agent|cli|private] [--branch main]` adds a git-backed package.
- `agents remove <name-or-path>` removes a package submodule.
- `agents sync` syncs and initializes submodules.
- `agents state init` initializes shared runtime state.
- `agents install <skill|plugin|cli> <name> <source-path-or-url>` installs shared capabilities.
- `agents credits` shows the shared credit store.
- `agents doctor` checks package registration and shared state.

## Shared State

All managed CLIs must use the root `.agents` directory as the single source of
runtime state:

- `.agents/clis/` stores CLI-specific data and adapter metadata.
- `.agents/skills/` stores user-installed shared skills.
- `.agents/plugins/` stores user-installed shared plugins.
- `.agents/credits.json` stores the shared credit ledger.
- `.agents/env` exports the paths every CLI should consume.

See [PRD.md](PRD.md).

