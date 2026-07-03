# Agentos Inferer

Inference and runtime execution package migrated from Andromeda.

## Contents

- `python-agent/` contains the Python agent loop, engine contracts, capability execution, status machine, and tests.
- `engine-go/` contains the Go runtime engine, manager, daemon, queue, dispatch, GitHub, and store work.
- `services/` contains the Go coordination, daemon, db, inferctl, manager, and statesync modules.
- `deploy/` and `deploy-package/` contain deployment and cluster assets.
- `docs/` and `scripts/` carry the migrated inference architecture, acceptance, benchmark, and validation material.
- `legacy/src-root/` preserves the remaining Andromeda `src` root material that was not already promoted into a package.
