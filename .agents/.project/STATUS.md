# Status

- Repository: `marius-patrik/DarkFactory`
- Branch: `main`
- Product role: Separate GitHub-native autonomous engineering product
- Managed policy authority: the `managed-repository` child of canonical
  Andromeda-data at `$AGENTS_HOME`; current adapter migration is #255
- Managed executable source: this DarkFactory package; duplicate payloads in
  managed data fail closed
- Operational ledger source: `marius-patrik/darkfactory-data`
- Shared state authority: `$AGENTS_HOME`
- Local worker authority: canonical `agents` launcher
- Repository doctor: deterministic read-only diagnosis by default; explicit
  stable-finding issue reporting; no implicit repair
- CI reviewer: current isolated Codex migration gate; provider-agnostic
  DarkFactory Autoreview target is #36
- Worker claims remain `df:running` until verified against live GitHub state
- Validation gate: `npm run check`
