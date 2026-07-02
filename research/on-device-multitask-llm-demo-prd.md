# On-device Multi-Task LLM Demo PRD

## Goal

Ship a runnable demo that serves a small base model on a mid-range device with a working set of 4 GB RAM or less and hot-swaps adapters instead of full models to support multiple tasks, such as summarization, code explanation, email tone fixing, and translation. The demo should feel fast, stable, and easy to extend.

## Target users and experience

**Primary users:** developers evaluating edge and latency-sensitive AI, plus product or research stakeholders benchmarking adapter-based deployment strategies.

**Core flow:** start the server, select one or more tasks, optionally compose tasks, run a prompt, then inspect latency, routing, adapter-cache, and token metrics.

**UI essentials:** prompt box, task picker, optional composition toggle, latency meter, token meter, adapter cache status, routing overhead, and live logs.

## Must-have scope

### 1. Baseline model

- Runtime must use a 4-bit quantized base LLM. Full fp16 base weights are not allowed at inference time.
- Finetuning path uses QLoRA to create per-task low-rank adapters.
- Inference path loads the quantized base once, then mounts adapters on demand.
- Adapter artifacts must be packed for predictable loading and hot reload.

### 2. Adapter composition

- Store adapters in a task-tagged adapter bank on disk.
- Support AdapterFusion-style inference-time weighted composition without destructive merges into the base model.
- Provide a primary task selector and optional secondary modifiers, for example `summarize + concise` or `email-tone + legal`.
- Start with static or heuristic fusion weights; leave room for learned weights later.

### 3. Routing

- Prefer a routing-minimizing deployment using a frozen or gated small router, or a routing-free MoE-like gate.
- Avoid per-token expert jitter and excessive branching.
- Report routing overhead as a percentage of base plus single-adapter compute.
- Report cache churn per request.

### 4. Edge and selective offload

- Run fully local when memory allows.
- Provide a one-flag mode switch between `local-only` and `edge+offload`.
- Under memory pressure, selectively offload cooler adapters or experts to a nearby accelerator or local GPU/IPC process.
- Use simple prefetch heuristics based on hotness, upcoming task composition, and memory pressure.

### 5. Fallback memory-aware eMoE path

- If adapter caching becomes the bottleneck, enable an eMoE fallback path.
- Use task-aware, memory-efficient experts with static assignment.
- Avoid heavy dynamic routing.
- Share KV/state where possible.

## Non-goals for v1

- Training UI.
- Dataset curation tooling.
- Cloud fleet scaling.
- Full-precision inference baselines.
- Complex autoscaling or dynamic routers.

## High-level architecture

### Core server

Use TypeScript/Node, Bun, or Python depending on the model runtime selected. Expose REST and/or WebSocket endpoints for prompt execution, streaming tokens, adapter management, and telemetry.

### Inference engine

- Load the 4-bit quantized base model once at startup.
- Manage adapter load, unload, warm cache, LRU eviction, and pinning for hot adapters.
- Compose adapters with AdapterFusion-style weighted per-layer combination.
- Route requests to either base plus one adapter or a fused adapter composition.
- Keep router behavior stable and low-branch to protect latency.
- Watch memory pressure and enqueue offload or prefetch actions.

### Telemetry

Track p50 and p95 latency, tokens per second, routing overhead percentage, adapter cache hit rate, cache churn, mounted adapter count, and working-set bytes.

## Deliverables

### CLI

```bash
demo serve --model <id> --adapters <dir> [--compose "taskA+taskB"] [--local-only]
demo bench --suite basic.json
```

### UI

A minimal single-page panel with:

- Prompt input.
- Task and composition picker.
- Streaming output.
- Live latency and token metrics.
- Adapter cache status.
- Routing and offload logs.

### Demo adapters

Ship three to five small adapters, such as:

- Summarization.
- Code explanation.
- Email tone fixing.
- Czech-to-English translation.
- Concise response modifier.

### Docs

- Quickstart.
- Adapter authoring guide with QLoRA recipe.
- Performance tuning guide.
- Benchmark report template.

## Acceptance criteria

| Area | Target |
| --- | --- |
| Latency | p95 <= 150 ms for typical 64-token requests, with prompt length and hardware noted in benchmark report |
| Routing overhead | <= 15% extra compute versus base plus single-adapter path |
| Adapter size | <= 50 MB per packed task adapter on disk |
| Working set | <= 4 GB RAM steady-state with two adapters mounted |
| Stability | 30-minute soak test with no OOM |
| Cache behavior | >= 60% adapter cache hit rate on repeated task workloads |
| Developer experience | Add a new adapter and see it live without restarting |

## Implementation plan

### Days 1-2: baseline and scaffolding

- Select the base model.
- Quantize to 4-bit.
- Scaffold server and UI.
- Implement streaming request/response path.

### Days 3-4: adapter pipeline

- Build QLoRA pipeline for three initial task adapters.
- Pack adapter artifacts.
- Add adapter load API.
- Add warm-cache path.

### Day 5: adapter composition

- Implement AdapterFusion-style combiner.
- Add static or heuristic fusion weights.
- Expose composition choices in CLI and UI.

### Day 6: routing and metrics

- Implement frozen gate or routing-free path.
- Expose routing decision and overhead metrics.
- Add cache churn tracking.

### Day 7: offload hooks

- Add memory pressure watcher.
- Add prefetch queue.
- Add `local-only` and `edge+offload` mode flags.

### Day 8: eMoE fallback

- Add static expert assignment.
- Share reusable KV/state where possible.
- Add benchmark switch for adapter path versus eMoE path.

### Day 9: performance pass

- Tune KV cache reuse.
- Trim prompts and cache templates.
- Pin high-reuse layers or adapters.
- Check fused kernels and quantized matmul paths.

### Days 10-11: polish

- Polish UI.
- Add docs.
- Add demo scripts and benchmark suite.

### Days 12-14: hardening

- Run soak tests.
- Cap working set.
- Finalize benchmark report.
- Verify KPI table.

## Performance levers

- 4-bit base quantization.
- 8-bit matmuls where useful.
- Fused kernels.
- KV cache reuse across adapter configurations.
- Pinned hot adapters and high-reuse layers.
- Prompt trimming and template caching.
- Static adapter ordering.
- Minimal router branching to stabilize CPU and GPU cache behavior.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Latency spikes from routing | Use routing-free or frozen-gate path; clamp branch count |
| Adapter cache churn | LRU with pinning; prefetch likely next adapters; enable eMoE fallback |
| Memory creep | Enforce hard working-set caps, backpressure, and offload cooler adapters |
| Composition quality regressions | Keep single-adapter baseline visible; compare fused versus non-fused outputs in bench suite |
| Demo hardware variance | Always report model, quantization config, device, prompt length, output length, and tokens/sec |

## Suggested repository structure

```text
research/
  on-device-multitask-llm-demo-prd.md
adapters/
  summarize/
  code-explain/
  email-tone/
  czech-en/
apps/
  server/
  web/
bench/
  basic.json
  soak.json
scripts/
  quantize.sh
  train_qlora.py
  pack_adapter.py
```

## Open decisions

- Exact base model and runtime backend.
- Whether the first demo should target CPU-only, local GPU, or both.
- Static fusion weights versus a tiny learned fusion head.
- Whether eMoE fallback ships enabled by default or behind a feature flag.
