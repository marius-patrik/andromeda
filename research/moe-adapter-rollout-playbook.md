# MoE and Adapter-Augmented Rollout Playbook

This document defines a practical rollout checklist for Mixture-of-Experts (MoE) and adapter-augmented model stacks. It is written for production deployments where quality, latency, memory pressure, routing behavior, and rollback safety must all be validated before full release.

## Goals

- Make model rollouts reproducible and observable.
- Catch quality regressions before broad exposure.
- Detect latency, memory, and expert-routing failures early.
- Automate canary promotion and rollback.
- Keep a hot fallback path for fast recovery.

## Acceptance before canary

A candidate build must pass these checks before it receives live traffic.

### Reproducibility

- Fix seeds for replay runs.
- Keep tokenizer, quantization config, CUDA/cuDNN flags, environment variables, and adapter order stable.
- Require deterministic forward-pass hashes on a tiny fixture when bit-for-bit determinism is feasible.
- Record model ID, adapter ID, routing table version, quantization config, and serving image digest.

### Functional quality

- Run held-out task evaluation against the last known-good baseline.
- Track absolute deltas for accuracy, exact match, F1, or the task-specific primary metric.
- Block canary if validation quality drops by more than 1.5 percentage points absolute.

### Latency and throughput

- Measure P50, P95, and P99 end-to-end latency.
- Separately measure queue time, first-token latency, decode average latency, and total request latency.
- Enforce P99 no worse than 1.2x baseline before promotion.
- Record tokens per second per worker and backpressure signals.

### Memory and OOM stress

- Sweep batch size, sequence length, and KV-cache residency.
- Test adapter load, merge, and quantized initialization paths.
- Capture peak GPU memory, peak CPU memory, fragmentation, allocator retries, and OOM events.
- Verify no allocator thrash or pathological cache eviction.

### MoE routing stability

For MoE deployments, capture these metrics over representative token volumes:

- Per-expert token counts.
- Expert-load standard deviation divided by mean.
- Gate entropy.
- Gate saturation and collapse indicators.
- Capacity-factor overflow and token-drop counts.
- Expert cache hit rate.
- Expert prefetch or offload success rate.

Block canary if expert-load standard deviation exceeds 5% of the mean, or if expert cache hit rate drops below 80%.

### Cold and warm start

- Measure first-token latency after cold start.
- Measure steady-state latency after warmup.
- Verify adapter load time and optional merge time.
- Test quantized startup path.
- Run once on the weakest representative target device, such as Jetson, CPU, or XPU where applicable.

## Canary plan

Use staged exposure with hard rollback gates.

1. Start with 1% traffic or one low-risk tenant cohort.
2. Hold for 30 to 60 minutes of peak traffic, or until a fixed request threshold is reached.
3. Promote to 10% if all gates remain healthy.
4. Hold again using the same checks.
5. Promote to 100% only after the 10% stage is clean.

Optional: run shadow or dark traffic in parallel and score periodic A/B batches before live exposure.

## Automatic rollback gates

Rollback immediately if any condition is true for the configured evaluation window.

| Area | Rollback trigger |
| --- | --- |
| Quality | Validation metric drops more than 1.5 percentage points absolute versus baseline |
| Latency | P99 end-to-end latency exceeds 1.2x baseline for five consecutive checks |
| Routing | Expert-load standard deviation divided by mean exceeds 0.05 |
| Cache | Expert cache hit rate falls below 0.80 |
| Errors | 5xx or timeout rate rises more than 50% above baseline |
| Memory | Any repeated OOM, allocator failure, or severe eviction storm appears |

Rollback should flip traffic routing through a feature flag or environment switch. The previous serving stack must remain hot and health checked during canary.

## CI/CD automation

### Pull request checks

Run these checks before merging model-serving changes:

1. Unit tests for adapter load, adapter merge, routing config parsing, and deterministic tiny-fixture forward pass.
2. Static checks for tokenizer compatibility, checkpoint compatibility, quantization schema, and custom-kernel ABI.
3. Integration smoke test that starts the serving stack and sends one real request through the quantized model plus adapter.
4. Artifact build and signing for base model references, adapter bundles, routing tables, and serving configs.

Example GitHub Actions smoke workflow:

```yaml
name: moe-adapter-ci
on: [push]

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install -r requirements.txt
      - run: pytest -q tests/unit --maxfail=1

  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install -r requirements.txt
      - name: Start server
        run: python serve.py --model "$MODEL" --adapter "$ADAPTER" --quant int4 &
      - name: Probe
        run: python tools/probe_request.py --text "hello" --expect_deterministic_hash
```

### Nightly benchmark

Run a memory-aware inference benchmark every night. Sweep batch size, sequence length, KV cache mode, adapter configuration, and representative device type.

Upload these metrics:

- P50, P95, and P99 latency.
- Tokens per second.
- Peak GPU and CPU memory.
- Allocator fragmentation.
- KV-cache residency and eviction.
- Per-expert utilization histogram.
- Expert-load standard deviation divided by mean.
- Gate entropy.
- Expert cache hit rate.
- Expert prefetch and offload hit rates.

Compare each run against a seven-day rolling baseline. Open a blocking issue or fail the nightly job when thresholds are breached.

## Observability contract

Every request log should include:

- `request_id`
- `model_id`
- `adapter_id`
- `routing_table_id`
- `quantization_config`
- `sequence_length`
- `batch_size`
- `device_type`
- `queue_latency_ms`
- `first_token_latency_ms`
- `decode_latency_ms_avg`
- `end_to_end_latency_ms`
- `tokens_per_second`
- `error_type`

MoE-specific logs should include:

- chosen experts per token or sampled summary
- gate probability entropy
- per-expert token counts
- expert-load standard deviation divided by mean
- capacity overflow count
- token-drop count
- expert cache lookups and hits
- expert prefetch attempts and successes

Memory logs should include:

- peak GPU memory
- peak CPU memory
- KV-cache residency
- KV-cache evictions
- allocator retries
- OOM events

## Prometheus examples

```yaml
groups:
  - name: moe
    rules:
      - record: route:expert_load_stddev_ratio
        expr: stddev_over_time(expert_tokens[5m]) / avg_over_time(expert_tokens[5m])

      - record: route:expert_cache_hit_rate
        expr: sum(rate(expert_cache_hits[5m])) / sum(rate(expert_cache_lookups[5m]))

      - record: svc:p99_e2e_ms
        expr: histogram_quantile(0.99, sum(rate(e2e_ms_bucket[5m])) by (le))
```

Recommended alerts:

```yaml
groups:
  - name: moe-alerts
    rules:
      - alert: MoEExpertRoutingImbalance
        expr: route:expert_load_stddev_ratio > 0.05
        for: 5m
        labels:
          severity: page
        annotations:
          summary: Expert routing imbalance exceeded threshold

      - alert: MoEExpertCacheHitRateLow
        expr: route:expert_cache_hit_rate < 0.80
        for: 5m
        labels:
          severity: page
        annotations:
          summary: Expert cache hit rate below rollout threshold

      - alert: ModelP99LatencyRegression
        expr: svc:p99_e2e_ms > 1.2 * svc:p99_e2e_ms:baseline
        for: 5m
        labels:
          severity: page
        annotations:
          summary: Model serving P99 latency regressed beyond canary gate
```

## Canary gate pseudocode

```python
def evaluate_canary(metrics, baseline):
    if metrics.p99_e2e_ms > 1.2 * baseline.p99_e2e_ms:
        rollback("p99 latency regression")

    if metrics.validation_score < baseline.validation_score - 0.015:
        rollback("quality regression")

    expert_load_ratio = metrics.expert_load_stddev / metrics.expert_load_mean
    if expert_load_ratio > 0.05:
        rollback("expert routing imbalance")

    if metrics.expert_cache_hit_rate < 0.80:
        rollback("expert cache hit-rate regression")

    if metrics.error_rate > 1.5 * baseline.error_rate:
        rollback("error-rate spike")

    promote_next_cohort()
```

## Safe default configuration

For MoE deployments:

- Start with top-k equal to 2.
- Use a capacity factor between 1.2 and 1.5.
- Log token drops and treat non-zero sustained drops as a release blocker.
- Cap per-expert tokens per step to avoid overload.
- Add a gate entropy floor or temperature guardrail to reduce expert collapse.
- Keep expert prefetch enabled only when hit-rate telemetry is healthy.

For adapter deployments:

- Freeze the base model unless the release explicitly includes a base-model update.
- Validate adapter stacking order.
- Validate dtype compatibility across base weights, adapters, and quantized kernels.
- Verify LoRA rank expectations per layer.
- Record adapter version and checksum in every served request.

## Rollback and fail-safe procedure

- Keep the previous serving stack hot.
- Health check both old and new stacks throughout the canary.
- Use a single feature flag or environment variable to switch cohort routing.
- On blocker detection, automatically route traffic back to the previous stack.
- Notify the release owner and freeze further promotion.
- Preserve canary logs, routing telemetry, and memory traces for postmortem analysis.

## Printable checklist

- [ ] Reproducibility seeds are fixed.
- [ ] Tiny-fixture deterministic hashes match.
- [ ] Tokenizer, quantization, adapter order, and routing config are pinned.
- [ ] Held-out quality metrics are within threshold.
- [ ] P50, P95, and P99 latency are within SLO.
- [ ] Batch, sequence, and KV-cache stress grid has no OOM.
- [ ] MoE expert utilization is stable.
- [ ] Expert cache hit rate is at least 80%.
- [ ] Observability fields are present in logs.
- [ ] Canary 1% stage is clean.
- [ ] Canary 10% stage is clean.
- [ ] Rollback has been tested against the live routing path.
- [ ] Previous stack remains hot until full rollout is stable.

## Ownership

This document should be reviewed whenever any of the following changes:

- Base model checkpoint.
- Adapter set or adapter composition order.
- Quantization format.
- MoE routing policy.
- Expert cache, prefetch, or offload behavior.
- Serving runtime or custom kernel ABI.
- Production SLO or rollback threshold.
