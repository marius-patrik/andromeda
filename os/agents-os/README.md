# Agents OS Base Image

This directory defines the `agents-os` container distribution base image and
local build/smoke commands. It implements agents-mono #9.

## Files

- `Dockerfile` — minimal distro image with Bun, Node.js, Python/uv, Go, git, and
the `agents` CLI.
- `image-metadata.json` — image name, registry, channels, and supported manager
version range.
- `bin/filter-gitmodules.ts` — build-time helper that removes submodule entries
whose checkouts are not baked into the image.
- `bin/smoke.ts` — local smoke test that runs `agents state init` and
`agents doctor` inside a throwaway container.

## Local Build

```sh
bun run image:build
```

Or directly with Docker:

```sh
docker build -f os/agents-os/Dockerfile -t agents-os:dev --build-arg AGENTS_OS_CHANNEL=dev .
```

## Local Smoke Test

The smoke test requires Docker and creates a temporary shared-state directory.
It does not mutate the host `.agents` directory.

```sh
bun run image:smoke
```

Or with a specific image:

```sh
AGENTS_OS_IMAGE=agents-os:dev bun run image:smoke
```

## Image Contract

The image follows the contracts in `docs/agents-os/ARCHITECTURE.md` and
`docs/agents-os/DATA-CONTRACTS.md`:

- `AGENTS_ROOT=/opt/agents-os` — read-only distro root.
- `AGENTS_HOME=/agents/state` — shared manager state mount.
- `AGENTS_DATA=/agents/data` — data repo parent mount.
- `AGENTS_WORKSPACE=/workspace/agents` — global workspace mount.
- Secrets and mutable operational data are mounted, never baked in.

## Release

Releases are published by `.github/workflows/release-agents-os.yml` to
`ghcr.io/marius-patrik/agents-os:<version>` with moving channel tags.
