# Autonomous Lab Protocol

This repo is a research lab for true exact QFT simulation, not a benchmark
optimization game. Agents may use finite computations, but only as instruments
for discovering, testing, or falsifying a mathematically exact construction.
The only allowed final external constraint is finite spatial volume; every
other regulator must be removed, certified, or explicitly marked as a blocker.

## Run Record

Each run must leave an evidence trail:

```bash
uv run lab.py --description "short hypothesis and result"
```

The runner evaluates `train.py` through the fixed judge in `prepare.py`, writes
a JSON artifact under `runs/`, and appends a row to `results.tsv`.

## Ratchet Rule

Keep a candidate only when it improves at least one of:

- a valid post-K8 proof certificate or certified remainder bound, bound to
  the committed post-K8 obligation hash and a passed machine-verification
  report under `research/proof_certificates`, with a formal artifact declaring
  `post_k8_schwinger_free_subtracted_mass_tuned_remainder_bound` as a
  non-vacuous bound-shaped statement containing the actual proven remainder
  and target bounds,
- a passing `post_k8_schwinger_bound_strategy()` method in `train.py`,
- a cleared `exact_qft_readiness_gate`,
- a sharper falsification/obstruction that makes the exactness blocker more
  precise without weakening the target theory,
- computational reach that is explicitly tied to a predeclared proof threshold
  and does not hide cutoffs.

Reject a candidate when it raises the score by weakening the truth contract,
hiding finite truncations, replacing QFT with a toy system, claiming exact
continuum success without proof, or moving only secondary diagnostics while the
post-K8 proof/certification blocker remains open. Raw strategy-score movement,
partial certificate structure, protocol text, unverified proof-ledger notes, and
finite metadata churn are not ratchet progress.

## Current First Gate

The first executable interacting gate is a tiny finite-volume spectral/Fock
Hamiltonian probe for scalar `phi^4`. It checks:

- the free `lambda=0` spectrum,
- Hermiticity of the finite Hamiltonian matrix,
- bounded low-lying spectrum for positive coupling,
- explicit finite-volume, momentum, and occupation cutoffs.
- a K/N cutoff sweep for the interacting mass-gap shift.
- a finite-cutoff mass counterterm flow tuned to a fixed one-particle gap.
- an independent connected four-point spectral proxy after mass tuning.
- a finite-volume scaling probe for the tuned connected response.
- a fixed-volume K/N removal probe, because K and N are not allowed final
  constraints.

Passing this gate is not the goal. It is the first local test that future
research must refine into real renormalized Hamiltonian convergence evidence.
Large sweep drift is allowed only when it is reported as a failure mode; it
should reduce the score rather than be hidden.

The mass-counterterm gate checks whether a candidate can satisfy one
renormalization condition at each finite cutoff and expose the bare parameter
flow. It does not prove that the flow converges or that the continuum QFT has
been constructed.

The connected-response gate checks whether an observable not fitted by the mass
condition remains finite and explicitly recorded. Future candidates should try
to stabilize this response across cutoffs without hiding additional tuning.

The finite-volume gate checks whether the same tuned observable is recorded
across several box lengths. It scores both tail drift and full-span instability
so an outlier volume cannot be hidden by a stable-looking final pair.

The fixed-volume regulator-removal gate holds `L` fixed and varies `K,N`. It is
the direct test for the current objective: success ultimately requires these
non-volume regulators to disappear from the claimed construction.

The extrapolation-certificate gate turns that fixed-volume grid into an
explicit estimate with an error bar. A failed certificate is progress when it
pinpoints why K/N removal has not yet been earned.
If adding a larger cutoff point worsens the certificate or flips the observable
sign, preserve that result as falsification evidence rather than trimming the
grid to recover a better score.
Connected spectral proxies must identify states by overlap with reference
finite-volume states, not by raw eigenvalue index alone.
When a spectral connected proxy fails, compare it against a non-level-tracking
observable such as vacuum energy density before declaring the whole regulator
family dead.

## Evidence Promotion

Raw K-tail batch artifacts are not tracked evidence until they pass the
promotion validator:

```bash
uv run python skills/system/scripts/qft.py promote-k-tail \
  --source runs/k_tail_K8_N4.json \
  --momentum-cutoff 8 \
  --occupation-cutoff 4
```

The validator checks schema, cutoff labels, finite values, Hermiticity, tuned
gap, and explicit no-workaround status. Promotion records finite-regulator
evidence only; it never certifies exact QFT simulation by itself.
