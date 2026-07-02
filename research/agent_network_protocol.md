# QFT Agent Network Protocol v0

QFT-ANP v0 is a reliability and guardrail layer for the agents working on this
repository. It does not change the science, the proof ledger, or the current
finite-evidence route. Its job is to keep the live work aligned with the
K8/N4 gate, make finite claims explicit, and prevent false completion when a
tool or runner succeeds but no useful K8 artifact exists.

The protocol is intentionally small and file-backed. Agents can inspect it,
validate it, and hand work to another session without mutating another live
Codex session.

## Purpose

The current scientific goal is not complete. K8/N4 is the live gate. Finite
evidence remains finite-regulator evidence until it is validated and classified
against `research/proof_ledger.md`.

QFT-ANP v0 protects that state by enforcing:

- step discipline around the K8/N4 state machine;
- parallel research lanes across available model families;
- cross-model evaluation before major scientific claims harden;
- finite TTLs for work claims;
- source-separated session summaries;
- explicit event/status vocabulary for unresolved or missing-evidence states;
- validation failures for exact-simulation claims that lack proof-ledger support;
- validation failures for evidence artifacts without a no-workaround status;
- warnings that nudge stale sessions and active unclaimed work back on track.

In QFT terms, this prevents false completion, silent K8 artifact absence,
K9 drift before K8 classification, threshold massaging, and accidental
`prepare.py` edits during evidence cycles.

## File Layout

- `.agents/comms/agents.json`: known agent identities, roles, capabilities, write scopes,
  runner preference, status, and `last_seen`.
- `.agents/comms/policy.json`: repository-specific guardrails, status vocabulary,
  redaction patterns, and claim TTL limits.
- `.agents/comms/tasks.jsonl`: append-only task records. The seeded task is
  `classify-k8-n4`.
- `.agents/comms/messages.jsonl`: append-only protocol messages and session-access
  events.
- `.agents/comms/artifacts.jsonl`: append-only artifact registrations. Raw artifacts are
  not evidence until validated.
- `.agents/comms/runners.json`: ranked compute runners, LLM-family lanes, Antigravity CLI
  configuration, and cross-model review requirements.
- `.agents/comms/claims/*.json`: finite work claims with write scopes and expiry.
- `.agents/comms/sessions.jsonl`: append-only discovered session records.
- `.agents/comms/session_access_policy.json`: rules for reading, tailing, summarizing,
  and handing off sessions.
- `.agents/comms/session_handoffs/*.json`: proposed or accepted handoff packets.
- `skills/comms/scripts/anp.py`: stdlib-only CLI for status, validation,
  session discovery, summaries, context packets, task/claim/message/artifact
  actions, and handoffs.
- `skills/network/scripts/workflow_dispatch.py`: plan-only workflow lane
  dispatcher for runner routing, compute readiness, cross-model review, and
  parallel research/system-evolution plans.

## Identities And Roles

The seeded agents are:

- `human-proxy`: human/operator gate for narrow intervention.
- `qft-overseer`: scientific gate overseer for K8/N4.
- `k-tail-runner`: finite K-tail execution runner.
- `evidence-classifier`: validates and classifies finite artifacts.
- `planner`: plans only proof-ledger-compatible next steps.

Each agent has `allowed_write_scopes`. During evidence cycles,
`prepare.py` is frozen by policy. Any claim or task that would require writing
outside its scope should be rejected before work starts.

## Runner Network

The protocol is not limited to one research agent. It should keep at least one
lane active per available model family when there is useful non-conflicting
work:

- Codex for session-aware repo work and evidence promotion.
- Claude for independent proof-ledger and failure-mode review.
- Gemini via Google Antigravity CLI for asynchronous multi-agent review.
- Kimi for independent numerical-method and regulator-assumption review.
- Cursor CLI, exposed by the official installer as `agent`, for an IDE-agent
  implementation and code-review lane.

`.agents/comms/runners.json` ranks compute runners separately from LLM runners. The
compute ranking is used for expensive finite jobs; the LLM ranking is used for
review, planning, critique, and handoff generation. A runner can be registered
as desired but unavailable; unavailable runners must not receive active claims.

Compute runners also carry GPU capability metadata for the real production
hardware: `s001-true-qft` is the primary RTX 3090 lane and `dekstop-true-qft`
is the secondary RTX 3070 Ti lane. GPU enablement is containerized. ANP requires
`Dockerfile.gpu`, Docker's NVIDIA runtime, `--gpus all`, and a successful
`skills/gpu-qft-runner/scripts/gpu_container_probe.py` report before assigning a GPU claim.

A host GPU is not enough for a research run. The governed CUDA container must
see `nvidia-smi` and a usable Python CUDA backend, and GPU output must agree
with CPU smoke cases before it can be used as evidence. GPU routing is
acceleration infrastructure only; it does not change the K/N regulator-removal
proof obligations.

`.agents/comms/gpu_backends.json` records backend options and container commands, and
`pyproject.toml` exposes the `gpu-torch` optional extra used by
`Dockerfile.gpu`. Agents should run the container probe and record the result
before assigning or dispatching a GPU research run.

Antigravity CLI is the Gemini-family runner. If Antigravity CLI is not
installed, the Gemini-family lane is recorded as unavailable rather than
silently downgraded.

Cursor CLI is a separate runner. The official installer from
`https://cursor.com/cli` exposes it as `agent`; ANP records that command as the
Cursor runner. The VS Code `code` CLI is not a Cursor substitute.

Parallelism does not weaken the science gate. During the K8/N4 cycle, parallel
lanes may inspect sessions, review methods, reproduce failures, critique the
proof ledger, or prepare handoffs. They may not launch K9, edit `prepare.py`,
change thresholds, or promote evidence without the relevant claim.

## Task And Claim Lifecycle

Tasks are append-only JSONL records. A task should record:

- `task_id`, `title`, and `description`;
- `state`, `status`, and `event_status`;
- timing fields such as `created_at`, `started_at`, `last_seen`, `expires_at`;
- an optional `estimated_time_to_resolution`;
- required write scopes;
- recovery guidance;
- proof-ledger and no-workaround fields when science-facing.

Claims are finite write locks under `.agents/comms/claims/`. They require:

- `claim_id`, `agent_id`, and `task_id`;
- `write_scopes`;
- `created_at`, `started_at`, `last_seen`, `expires_at`;
- `status: active` until released.

Validation fails if active claims overlap the same write scope or if an active
claim expires. Validation warns when active work lacks an active claim.

## Cross-Model Evaluation

Major scientific classifications should be reviewed by more than one available
model family before they become settled ANP state. A cross-model review packet
should record:

- `review_id`;
- `runner_id`;
- `model_family`;
- `input_artifact`;
- `proof_ledger_ref`;
- `claim_reviewed`;
- `finding`;
- `confidence`;
- `created_at`.

Allowed findings are `supports_classification`,
`disagrees_with_classification`, `finds_missing_evidence`, and
`blocked_by_tool_or_context`. Disagreement is a result to preserve, not a reason
to hide or massage the classification.

## Event And Status Vocabulary

QFT-ANP v0 distinguishes command completion from useful scientific result.
Allowed vocabulary includes:

- `proposed`;
- `active`;
- `completed_useful_result`;
- `completed_unresolved`;
- `completed_no_artifact`;
- `completed_missing_evidence`;
- `blocked`;
- `failed`;
- `released`;
- `expired`.

For example, a `gh run view`, `docker run`, or `uv run` command can succeed
while the K8/N4 task remains `completed_no_artifact` or
`completed_missing_evidence`. That is not failure hiding; it is the protocol
recording that tool success did not yet produce useful evidence.

## Retry And Recovery

A failed or blocked task must preserve exact failure details: command, runner,
path checked, missing file, exit code, or validation error. Recovery is narrow:
retry only the direct blocker.

For K8/N4, narrow recovery can mean rerunning the same K8/N4 command after
fixing the direct execution problem. It cannot mean launching K9, broad
infrastructure work, changing thresholds, changing the target theory, or
treating partial command success as classification.

## Evidence And Artifact Promotion

`.agents/comms/artifacts.jsonl` can record raw artifacts, but raw artifacts are not
evidence. An evidence artifact must include a `no_workaround_status` and should
reference the proof ledger.

Validation fails if an evidence artifact lacks `no_workaround_status`.
Validation also fails if a message claims exact or true QFT simulation success
without a proof-ledger reference.

The project may have useful finite-regulator artifacts. They remain finite
until a proof-ledger-backed argument removes or accounts for the relevant
regulators.

The current route is a spectral/Fock finite-volume scalar-QFT route. It is not
currently a lattice gauge theory route. A lattice gauge formulation may be
opened only as a separately named research lane with its own target theory,
evidence contract, and no use as a rescue for the current K8/N4 classification.

## Session Discovery

`skills/comms/scripts/anp.py discover-sessions` scans:

```bash
/Users/user/.codex/sessions/**/rollout-*.jsonl
```

It parses session metadata, goal updates, recent user/assistant messages,
tool calls, and file modification time. Relevant sessions are recorded in
`.agents/comms/sessions.jsonl`, including the overseer session:

```text
019e45ac-88cb-75d1-97c8-95d3a65b1415
```

Discovery is read-only with respect to Codex session files.

## Session Tail, Summary, And Context

Session commands avoid noisy raw JSON:

- `session-tail --session-id <id> --lines N` prints recent meaningful messages
  and tool calls.
- `session-summary --session-id <id>` prints source-separated sections.
- `session-context --session-id <id>` emits a concise JSON packet another agent
  can use.

The source-separated sections are:

- `verified_repo_run_state`;
- `agent_claims`;
- `inferred_state`;
- `missing_evidence`.

This keeps context and token use bounded. It also prevents agent claims from
being confused with verified repo/run state.

## Handoff Lifecycle

Handoffs live in `.agents/comms/session_handoffs/`. A handoff packet includes:

- `handoff_id`;
- `from_agent_id`;
- `to_agent_id` or `target_role`;
- `target_session_id`;
- `reason`;
- `current_state`;
- `requested_action`;
- `constraints`;
- `evidence_links`;
- `prompt_text`;
- `status`;
- timing fields such as `started_at`, `last_seen`, `expires_at`;
- optional `estimated_time_to_resolution`.

The seeded human-proxy handoff says:

```text
Only intervene if K8 finishes, fails, or the overseer drifts away from K8 classification.
```

Handoff requests are allowed. Mutating another live session is not allowed in
v0. Prompt injection requires explicit human/operator approval or future
tooling.

## Redaction And Security

Session reads, summaries, context packets, and handoffs redact configured
secret patterns. Validation fails if a handoff contains an unredacted secret.

Every session access is recorded as an ANP event in `.agents/comms/messages.jsonl`.
Those events record the read command and session id, not raw hidden session
contents.

## K8/N4 Example Flow

1. `qft-overseer` checks open claims before work.
2. `qft-overseer` monitors only the K8/N4 gate.
3. If a runner command succeeds but no `k_tail_K8_N4.json` exists, record
   `completed_no_artifact` or `completed_missing_evidence`.
4. If K8/N4 fails operationally, preserve the exact failure details and retry
   only the direct blocker.
5. If a raw K8/N4 artifact appears, register it as raw until validation.
6. `evidence-classifier` validates metadata, Hermiticity/gap checks, and
   proof-ledger thresholds.
7. Available model-family lanes independently review the classification packet.
8. Classification is one of: supports current theorem route, falsifies current
   geometric route, or remains inconclusive.
9. The proof ledger is updated only with actual validated finite values.
10. No exact QFT success is claimed unless proof-ledger support exists.
11. K9 remains blocked until K8/N4 is classified.
