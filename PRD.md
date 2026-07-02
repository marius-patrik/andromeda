# Agent Package Manager PRD

## Overview

`agents` is a Bun TypeScript CLI and workspace for managing agent packages. It installs and tracks agent repos, CLI adapters, skills, plugins, and shared runtime state so every managed CLI sees the same installed capabilities and credit store.

## Goals

- Manage git-backed agent packages from one workspace.
- Keep CLI-specific metadata under `.agents/clis`.
- Keep user-installed skills and plugins under `.agents/skills` and `.agents/plugins`.
- Expose one shared state root to every CLI through `.agents/env`.
- Maintain a shared credit store at `.agents/credits.json`.
- Support CI for typecheck and tests.

## Non-Goals

- Replace package managers like npm, Bun, or uv.
- Implement billing provider integrations in the first version.
- Solve cross-machine state sync beyond git-backed packages and exportable state files.

## Users

- Agent developers who maintain several local agent repos.
- CLI users who want all agent CLIs to share skills, plugins, memory hooks, and credits.
- Automation that needs deterministic installation and environment discovery.

## Core Concepts

- Package: a git submodule or local package managed by `agents`.
- Shared state: the root `.agents` directory.
- CLI metadata: per-CLI data under `.agents/clis/<name>`.
- Skill install: files installed under `.agents/skills/<name>`.
- Plugin install: files installed under `.agents/plugins/<name>`.
- Credit store: shared JSON ledger under `.agents/credits.json`.

## Functional Requirements

- `agents list` lists registered git submodule packages.
- `agents add` adds a git-backed package.
- `agents remove` removes a package submodule.
- `agents sync` syncs and initializes submodules.
- `agents state init` creates shared directories and state files.
- `agents state env` prints environment variables every CLI should consume.
- `agents install skill|plugin|cli` installs shared capability files into `.agents`.
- `agents installs` lists shared installs.
- `agents credits` locates or prints the shared credit store.
- `agents doctor` validates package checkouts and shared state.

## State Layout

```text
.agents/
  clis/
  skills/
  plugins/
  credits.json
  installs.json
  env
```

Every managed CLI must read `AGENTS_HOME`, `AGENTS_CLIS`, `AGENTS_SKILLS`, `AGENTS_PLUGINS`, and `AGENTS_CREDITS` from `.agents/env` or equivalent environment exports.

## CI

CI runs on pushes and pull requests to `main`:

- install Bun
- `bun install --frozen-lockfile`
- `bun run check`
- `bun test`

## Milestones

1. Bun TypeScript CLI scaffold.
2. Shared state bootstrap and diagnostics.
3. Skill/plugin/CLI install tracking.
4. Credit store schema and update commands.
5. Per-CLI adapter contracts for consuming shared state.
