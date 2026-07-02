# Federated and Distributed Training Safety Runbook

This document captures an operational baseline for keeping a federated or distributed training system safe, stable, observable, and rollback-friendly. It assumes mixed-trust clients, continuous model delivery, and production-grade release controls.

## Objectives

- Prevent poisoned, malformed, stale, or compromised client updates from influencing global models.
- Detect model-quality regressions, population drift, and infrastructure overload before full rollout.
- Preserve deterministic replay and fast rollback paths for every global merge.
- Provide clear release gates, telemetry, and incident actions that can be automated in CI/CD.

## Primary failure modes

### Model poisoning

**Risk:** Byzantine, untargeted, or targeted client updates can bias or degrade the global model.

**Mitigations:**

- Use robust aggregation, such as coordinate-wise median, trimmed mean, Krum, or Multi-Krum.
- Add DP-SGD and secure aggregation to reduce gradient leakage and cap single-client influence.
- Require client attestation and update signing.
- Quarantine updates from clients that fail attestation, signing, norm checks, or similarity checks.

### Stragglers and partitioned clients

**Risk:** Slow, offline, or partitioned clients can delay training rounds or introduce stale updates.

**Mitigations:**

- Close rounds using strict deadlines.
- Maintain straggler budgets per cohort.
- Use bounded-staleness rules for asynchronous training.
- Apply importance reweighting only within capped limits.

### Checkpoint corruption

**Risk:** Corrupt or partially written checkpoints can break serving, replay, or rollback.

**Mitigations:**

- Store checkpoints in content-addressed storage with hashes.
- Double-write to independent storage backends.
- Run parity checks and read-after-write verification.
- Keep an N-1 rollback chain warm and tested.

### Silent data drift

**Risk:** Concept drift or population drift can degrade critical slices before global metrics show failure.

**Mitigations:**

- Use canary cohorts and slice-level validation.
- Track feature-marginal divergence using PSI, JS divergence, or equivalent detectors.
- Auto-freeze rollout when drift or slice regressions exceed thresholds.

### Scale overload

**Risk:** Aggregators, parameter servers, or upload systems can be overwhelmed by fan-in.

**Mitigations:**

- Use back-pressure queues and circuit breakers.
- Rate-limit per client and per cohort.
- Horizontally shard aggregators.
- Prioritize cohorts during overload and shed noncritical load first.

## Release gates

Every global merge should pass staged canaries before promotion.

### Canary ladder

- 1% percentile-stratified cohort.
- 5% percentile-stratified cohort.
- 25% percentile-stratified cohort.
- 100% rollout only after all gates remain green for two consecutive rounds.

Cohorts should be stratified by device class, locale, app version, data density, and other high-risk dimensions.

### Freeze thresholds

Freeze rollout immediately if any of the following trip:

- Validation degradation greater than 2% on any critical metric or slice.
- Gradient-norm P95 increases by more than 3 standard deviations from the 7-day baseline.
- Signature or attestation failure rate exceeds 0.5% in any cohort.
- Upload latency P95 exceeds 2x baseline.
- Client churn exceeds 2x baseline.

### Per-update tests

Every accepted client update should include a deterministic replay bundle containing:

- Random seed.
- Data fingerprints or hashes.
- Runtime and dependency manifest.
- Model and optimizer versions.
- Shape, NaN, and Inf guards.
- Server-simulator spec-test results.

## Aggregation and trust policy

A practical default policy:

1. Accept only signed updates from remotely attested clients or measured runtimes.
2. Clip per-layer L2 norms using `median(norm) * 1.5` as the default clipping rule.
3. Filter outliers before aggregation using:
   - Per-layer norm z-score checks.
   - Sign-flip ratio checks.
   - Cosine similarity to the trimmed mean.
4. Aggregate using trimmed mean with `alpha = 0.1`.
5. Fall back to coordinate-wise median when dispersion crosses the instability threshold.
6. Switch to Multi-Krum with `m = 5` when adversarial scoring crosses the high-risk threshold.
7. Apply differential privacy noise at the aggregator.
8. Log the privacy budget for every release.

Suggested privacy default:

- Epsilon per release: `<= 3`.
- Delta: `1e-6`.
- Accounting: moments accountant or equivalent privacy-accounting method.

## Required telemetry

Track these globally and per cohort.

### Model quality

- Validation loss.
- Accuracy, AUC, or task-specific quality metric.
- Critical slice metrics by locale, device class, app version, and data-density bucket.

### Training stability

- Gradient-norm P50, P95, and max.
- Per-layer norm distributions.
- Update cosine dispersion.
- Outlier rejection rate.

### Client health

- Client churn rate.
- Participation rate.
- Upload latency P50 and P95.
- Deadline miss rate.
- Secure-aggregation drop rate.

### Security posture

- Signature failures.
- Attestation failures.
- Blacklist and probation-list counts.
- Anomalous-client quarantine rate.

### Drift indicators

- Feature-marginal divergence.
- Label-mix shift.
- OOD score distribution.
- Slice-level error changes.

## Incident playbooks

### Quality drop

Trigger: validation metric degradation greater than 2%, or any critical-slice failure.

Actions:

1. Freeze rollout.
2. Isolate the failing cohort.
3. Replay the last N rounds deterministically.
4. Bisect by cohort, client group, and aggregation round.
5. Roll back to the last green checkpoint.
6. Open a root-cause-analysis ticket and hotfix branch.

### Byzantine or poisoning suspicion

Trigger: spike in gradient dispersion, norm outliers, cosine-similarity anomalies, or targeted slice failure.

Actions:

1. Quarantine top-k anomalous clients.
2. Increase trim percentage.
3. Switch from trimmed mean to coordinate-wise median or Multi-Krum.
4. Raise DP noise within approved privacy and utility bounds.
5. Re-run evaluation on canaries.
6. Promote only after two consecutive green rounds.

### Checkpoint corruption

Trigger: hash mismatch, failed read-after-write verification, failed restore, or serving crash after checkpoint promotion.

Actions:

1. Promote the N-1 checkpoint.
2. Verify hashes across all replicas.
3. Re-run aggregation using replay logs.
4. Compare regenerated checkpoint hashes.
5. Block promotion until storage and restore tests pass.

### Scale overload

Trigger: aggregator saturation, upload latency P95 over 2x baseline, queue growth, or elevated client churn.

Actions:

1. Trip the circuit breaker.
2. Shed load by cohort priority.
3. Scale aggregator shards.
4. Resume with bounded staleness.
5. Reopen canary promotion only after latency and churn return below thresholds.

## Operational automation

- Run staged canaries for every model release.
- Require all gates to stay green for two consecutive rounds before promotion.
- Keep one-click rollback to the last green tag.
- Maintain warm standby serving endpoints.
- Use a model hotfix channel for scoped patches, such as layer freeze or learning-rate decay.
- Maintain automatic blacklist and probation lists.
- Require fresh attestation before a quarantined client rejoins.
- Run nightly deterministic replays of sampled updates.
- Store minimal replay artifacts: seeds, operator versions, runtime manifests, and data fingerprints.

## CI/CD policy template

```yaml
federated_training_safety:
  canary_ladder:
    rungs: ["1%", "5%", "25%", "100%"]
    minimum_green_rounds_per_rung: 2
    stratify_by:
      - device_class
      - locale
      - app_version
      - data_density

  freeze_thresholds:
    validation_metric_degradation_pct: 2.0
    gradient_norm_p95_sigma: 3.0
    attestation_failure_rate_pct: 0.5
    signature_failure_rate_pct: 0.5
    upload_latency_p95_baseline_multiplier: 2.0
    client_churn_baseline_multiplier: 2.0

  aggregation:
    default: trimmed_mean
    trimmed_mean_alpha: 0.1
    instability_fallback: coordinate_median
    adversarial_fallback: multi_krum
    multi_krum_m: 5
    per_layer_l2_clip_multiplier: 1.5

  privacy:
    dp_enabled: true
    epsilon_per_release_max: 3.0
    delta: 1.0e-6
    accounting: moments_accountant

  client_trust:
    require_update_signing: true
    require_remote_attestation: true
    quarantine_on_attestation_failure: true
    quarantine_on_signature_failure: true

  auto_freeze_actions:
    - freeze_rollout
    - enable_stricter_aggregation
    - quarantine_anomalous_clients
    - rollback_to_last_green_checkpoint
    - open_rca_ticket
```

## Dashboard requirements

Each model should have a one-page dashboard with:

- Overall metric delta versus baseline.
- Current rollout rung.
- Privacy budget used and remaining.
- Loss and accuracy by cohort.
- Critical-slice redline status.
- Gradient-norm boxplot.
- Cosine-dispersion histogram.
- Signature and attestation failure counts.
- Blacklist and probation-list counts.
- Upload latency, churn, participation, and secure-aggregation drops.
- Drill-downs by locale, device class, app version, and replay status.

## Default rollout decision rule

A model can advance to the next rung only when:

1. All release gates are green.
2. No freeze thresholds have tripped.
3. Replay bundles are available for sampled updates.
4. The last green checkpoint is verified and rollback-tested.
5. Security posture is within threshold.
6. The current rung has stayed green for two consecutive rounds.

A model must roll back when:

1. Any critical slice degrades beyond threshold.
2. Checkpoint integrity fails.
3. Attestation or signing failures exceed threshold.
4. Aggregation instability remains after stricter aggregation is enabled.
5. Serving or training overload persists after circuit breaking and load shedding.
