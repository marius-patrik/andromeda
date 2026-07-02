# Proof Ledger

This ledger tracks exactness routes. It is not a claim that a finite matrix,
finite sample, or finite cutoff has solved the target problem.

## Route: Schwinger K-Tail Regulator Removal

- Target theory: finite-volume massive scalar `phi^4` in 1+1 dimensions.
- Final allowed external constraint: one micrometer squared finite spatial
  volume.
- Temporary regulators: momentum cutoff `K`, Fock occupation cutoff `N`.
- Observable under stress: free-subtracted equal-time Schwinger two-point delta
  `C_interacting(0;K,N)-C_free(0;K)`, with mass counterterm tuned to the
  one-particle gap.

### Target Theorem

Prove a uniform regulator-removal bound for the post-K tail of the
free-subtracted interacting Schwinger delta at fixed physical volume:

```text
|R_K| <= explicit_tail_bound(K, N, lambda, m, L)
```

The bound must become smaller than the tracked target tail bound without
changing the target theory, hiding the occupation cutoff, replacing the route
with a spacetime lattice, or relying on visual/numerical fit agreement alone.

### Assumptions To Prove Or Replace

- The mass-tuned finite Hamiltonians converge to the intended finite-volume
  `phi^4` target as `K,N -> infinity`.
- The free-subtracted Schwinger delta has a controlled large-K tail after mass
  tuning.
- The observed `N=4` occupation sector is not hiding an occupation-tail
  obstruction.
- The equal-time two-point delta extends to a separating Schwinger observable
  family.
- Reflection positivity and OS reconstruction survive the regulator-removal
  limit at fixed volume.

### Supporting Finite Evidence

- `research/evidence/k_tail_K5_N4.json`
  - `interaction_delta_c0 = -0.0019799500984395424`
- `research/evidence/k_tail_K6_N4.json`
  - `interaction_delta_c0 = -0.002097140644003015`
- `research/evidence/k_tail_K7_N4.json`
  - `interaction_delta_c0 = -0.002197172175804285`
  - Hermiticity and tuned one-particle gap pass the current finite checks.
  - The K7-K6 tail decreases relative to the K6-K5 tail.
- `research/evidence/k_tail_K8_N4.json`
  - `interaction_delta_c0 = -0.0022844305169373857`
  - `one_particle_gap = 0.9999999999992072`
  - `hermitian_error = 0.0`
  - The K8-K7 tail decreases relative to the K7-K6 tail.
  - Older raw K8 evidence from GitHub run `26184282257` at commit
    `fb0a53cec54b4ece8521c812ee669f79af77f20e` agreed to numerical roundoff
    (`interaction_delta_c0 = -0.0022844305169370527`) and is corroborating raw
    finite evidence only.

### Evidence Against Or Not Yet Enough

- K6 theorem target:
  - observed K5->K6 tail ratio: about `0.8284830917`
  - required post-K6 geometric ratio: about `0.6415145520`
  - verdict: not certified.
- K7 classifier:
  - `classification_status = inconclusive_tail_decreases_but_above_required_ratio`
  - `abs(K7-K6) = 0.00010003153180127011`
  - required K7 support bound: `0.00007517944033315405`
  - verdict: route remains alive but unsupported by the current geometric
    certificate.
- K8 classifier:
  - `classification_status = inconclusive_tail_decreases_but_above_required_ratio`
  - `abs(K8-K7) = 0.00008725834113310071`
  - `tail_ratio_vs_K7_minus_K6 = 0.8723083567934804`
  - required K8 support bound: `0.0000641716833071184`
  - induced post-K8 geometric remainder: `0.00015614998022122297`
  - verdict: route remains alive but unsupported by the current geometric
    certificate.

### Exact Blocker

No proof currently removes the `K` and `N` regulators. Current finite evidence
shows monotone-looking tail decrease through K8/N4, but not enough decrease for
the fixed geometric certificate. The project therefore has not achieved a
no-workaround one-micrometer-squared QFT simulation.

### K8 Falsifying Experiment Result

Executed and validated:

```bash
uv run python skills/system/scripts/qft.py k-tail-job \
  --momentum-cutoff 8 \
  --occupation-cutoff 4 \
  --out runs/k_tail_K8_N4.json
```

Promotion gate:

```bash
uv run python skills/system/scripts/qft.py promote-k-tail \
  --source runs/k_tail_K8_N4.json \
  --momentum-cutoff 8 \
  --occupation-cutoff 4
```

Decision rule:

- Supports the current theorem route if `abs(K8-K7) <= 0.0000641716833071184`
  and the induced post-K8 geometric remainder is below the target tail bound.
- Falsifies the current geometric route if the K8-K7 tail grows relative to
  K7-K6, or Hermiticity/gap tuning fails.
- Remains inconclusive if the tail decreases but still exceeds the required
  ratio.

Actual decision: inconclusive. The K8-K7 tail decreased relative to K7-K6 and
the finite Hermiticity/gap checks passed, but `abs(K8-K7)` exceeded the support
bound and the induced post-K8 geometric remainder did not establish regulator
removal.

### Next Review Gate

Do not start K9/N4 in this evidence cycle. The local proof-ledger review in
`research/k8_classification_review.md` confirms the K8/N4 classification as
inconclusive and selects theorem/obstruction work as the next aligned step.

The next proof obligation is to either strengthen the K-tail theorem for the
free-subtracted, mass-tuned Schwinger delta, or expose a fixed-`N=4`
occupation-tail obstruction with a named threshold before launching more K-tail
evidence. Any later K9/N4 run would remain finite-regulator evidence and would
not by itself prove the exact no-workaround target.

### Occupation-Tail Obstruction Gate

`research/occupation_tail_obstruction_protocol.md` defines the next finite
obstruction test allowed by the K8 review. It names K6/N5 as a lower-K,
higher-N test and fixes the decision rule before launch:

- support fixed-`N=4` K-tail continuation only if
  `abs(delta_K6_N5 - delta_K6_N4) <= 0.000008725834113310071`;
- falsify the fixed-`N=4` K-tail interpretation if
  `abs(delta_K6_N5 - delta_K6_N4) > 0.0000191327336836466`, or finite
  Hermiticity/gap checks fail;
- otherwise classify the occupation-tail test as inconclusive.

This gate still leaves the full no-workaround goal unproved.

### K6/N5 Occupation-Tail Result

Executed and validated:

```bash
uv run python skills/k-tail-evidence/scripts/k_tail_job.py \
  --momentum-cutoff 6 \
  --occupation-cutoff 5 \
  --out runs/k_tail_K6_N5.json
```

Promotion gate:

```bash
uv run python skills/k-tail-evidence/scripts/promote_k_tail_evidence.py \
  --source runs/k_tail_K6_N5.json \
  --momentum-cutoff 6 \
  --occupation-cutoff 5
```

Promoted artifact:

- `research/evidence/k_tail_K6_N5.json`
  - `interaction_delta_c0 = -0.002095467251495009`
  - `one_particle_gap = 1.0000000000004876`
  - `hermitian_error = 0.0`
  - `basis_sector = zero_total_momentum`

Classification review:

- `research/k6_n5_occupation_tail_review.md`
  - `T45 = abs(delta_K6_N5 - delta_K6_N4) = 0.0000016733925080059109`
  - `support_bound = 0.000008725834113310072`
  - verdict: `supports_fixed_N4_continuation`

This narrows the occupation-tail obstruction but does not prove regulator
removal. The next exactness-facing obligation is still a sharper K-tail theorem
or certified bound for the free-subtracted, mass-tuned Schwinger interaction
delta before any finite K continuation can be treated as more than evidence.

### Post-K8 Bound Obligation

The current proof target is materialized as:

- `research/proof_obligations/post_k8_schwinger_bound.json`

Generated by:

```bash
uv run python skills/k-tail-evidence/scripts/post_k8_bound_obligation.py \
  --out research/proof_obligations/post_k8_schwinger_bound.json
```

The artifact validates the promoted K5/N4, K6/N4, K7/N4, K8/N4, K6/N3, and
K6/N5 evidence records and derives the next exactness-facing numeric target:

- `abs(K8/N4 - K7/N4) = 0.00008725834113310071`
- `target_tail_bound = 0.0002097140644003015`
- required post-K8 effective geometric ratio:
  `r <= 0.7061735719977987`
- observed K8-vs-K7 one-step ratio:
  `0.8723083567934804`
- current ratio gap factor: `1.235260552622606`

The K8 one-step tail is below the target bound, but the current geometric
certificate still fails because the observed ratio does not bound the infinite
post-K8 remainder tightly enough. A later finite K point is admissible only if
it is tied to this predeclared proof target; otherwise the next aligned work is
an analytic lemma or certified direct remainder bound for the free-subtracted,
mass-tuned Schwinger interaction delta.
