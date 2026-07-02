# agent-os

Agent OS workspace with the `agents` CLI for managing agent
packages, shared skills/plugins, CLI data, and a common credit store.

## Usage

```sh
bun install
bun link
agents list
agents state init
agents state env
agents cli doctor
agents packages register packages/agent-harness
agents harness doctor agent-harness
agents doctor
```

## Layout

- `packages/agent-package-manager` contains the `agents` CLI source and tests.
- `packages/agent-harness`, `packages/agi`, `packages/skyblock-agent`, and
  `packages/vibe-bot` are managed agent package submodules.
- `packages/templates/*` contains managed repository templates.

## Commands

- `agents list [--json]` lists registered packages from `.gitmodules`.
- `agents info <name-or-path> [--json]` shows package metadata.
- `agents add <name> <git-url> [--kind agent|cli|private] [--branch main]` adds a git-backed package.
- `agents remove <name-or-path>` removes a package submodule.
- `agents sync` syncs and initializes submodules.
- `agents state init` initializes shared runtime state.
- `agents cli list|doctor|env|exec|materialize-creds` manages Codex, Claude, Kimi, and Agy through one adapter layer.
- `agents packages register <path>` registers a local package manifest.
- `agents harness list|doctor|run` manages runtime harnesses such as Agent Harness.
- `agents install <skill|plugin|hook|template|cli|harness> <name> <source-path-or-url>` installs shared capabilities.
- `agents credits` shows the shared credit store.
- `agents doctor` checks package registration and shared state.

## Shared State

All managed CLIs must use the root `.agents` directory as the single source of
runtime state:

- `.agents/clis/` stores CLI-specific data and adapter metadata.
- `.agents/harnesses/` stores harness runtime roots.
- `.agents/skills/` stores user-installed shared skills.
- `.agents/plugins/` stores user-installed shared plugins.
- `.agents/hooks/` stores user-installed shared hooks.
- `.agents/templates/` stores templates.
- `.agents/credits.json` stores the shared credit ledger.
- `.agents/packages.json` stores registered package manifests.
- `.agents/env` exports the paths every CLI should consume.

See [PRD.md](PRD.md).

