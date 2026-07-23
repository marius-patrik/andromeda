# Understory-derived memory engine

The canonical invariant is: validated Markdown in the `private-data` repository
is memory authority, and every other representation is a disposable derivative.

`src/engine/memory/understory` adapts the useful deterministic parts of
Understory — OKF parsing, validation, search, graph construction, query/update
semantics, and migration planning — behind `CanonicalMemoryAuthority`. Only the
Andromeda state service may implement that interface. Mutations carry an
optimistic base revision, exact expected content hashes, actor identity, and
evidence; the engine does not write files, Git refs, event logs, or audit data.

The SQLite database, FTS table, link graph, broken-link report, and projection
digest are rebuilt exclusively from one committed snapshot. A rejected or stale
transaction cannot advance those derivatives. If rebuilding fails after a
canonical commit, the next read retries from Markdown authority.

The following Understory surfaces are intentionally not imported:

- its direct filesystem and best-effort Git writer;
- its mutation queue and independent log/index authority;
- its API, MCP server, authentication, provider, fallback, and model state;
- its web application and agent orchestration loop.

The public Memory plugin manifest remains on the plugin-platform lane. That lane
should bind its agent tools, CLI commands, TUI panel, web panels, and server jobs
to the internal export at `src/engine/memory/index.ts`; it must not create a
second loader, database authority, or state writer.

Migration planning is read-only and deterministic. It records exact source byte
counts and SHA-256 hashes, folds explicitly overlapping topics while retaining
every evidence hash, and remaps reserved instruction/generated names to normal
non-authoritative concept paths. Publication of a reviewed plan is a state
service transaction and is not performed by the migration planner.
