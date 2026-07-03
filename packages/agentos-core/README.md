# Agentos Core

Shared Agentos contracts and generated client packages.

## Contents

- `proto/` holds the canonical Rommie/Agentos protobuf wire contract.
- `contracts-go/` holds generated Go protobuf and Connect stubs.
- `clients/shared-ts/` holds generated TypeScript protobuf descriptors and shared client exports.
- `docs/contracts/` holds protocol, engine, execution-lane, and worker lifecycle contracts.
- `buf.gen.yaml` regenerates Go, TypeScript, and Python stubs from this package boundary.

Run codegen from this directory:

```sh
buf generate proto
```
