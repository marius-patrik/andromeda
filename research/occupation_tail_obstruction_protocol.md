# Occupation-Tail Obstruction Protocol

Date: 2026-05-20

## Scope

This protocol converts the K8/N4 proof-route review into a named
occupation-tail gate. It does not launch a run, promote evidence, or claim
regulator removal. Its purpose is to decide whether fixed `N=4` may be hiding
an occupation-tail obstruction before any K9/N4 continuation is authorized.

## Existing Inputs

- `research/evidence/k_tail_K6_N3.json`
- `research/evidence/k_tail_K6_N4.json`
- `research/evidence/k_tail_K8_N4.json`
- `research/k8_classification_review.md`

Tracked lower-occupation values at K6:

| K | N | interaction_delta_c0 |
|---|---|---:|
| 6 | 3 | -0.0021162733776866616 |
| 6 | 4 | -0.002097140644003015 |

Derived values:

- `abs(delta_K6_N4 - delta_K6_N3) = 0.0000191327336836466`
- `abs(delta_K8_N4 - delta_K7_N4) = 0.00008725834113310071`
- `0.1 * abs(delta_K8_N4 - delta_K7_N4) = 0.000008725834113310071`
- `0.5 * abs(delta_K6_N4 - delta_K6_N3) = 0.00000956636684182330`

## Proposed Evidence Point

Only if this protocol is accepted, run:

```bash
uv run python skills/k-tail-evidence/scripts/k_tail_job.py \
  --momentum-cutoff 6 \
  --occupation-cutoff 5 \
  --out runs/k_tail_K6_N5.json
```

This is a lower-K, higher-N obstruction test. It is not a K9 substitute and is
not evidence of exact QFT simulation until validated, promoted, and classified.

## Decision Rule

Let:

```text
T34 = abs(delta_K6_N4 - delta_K6_N3)
T45 = abs(delta_K6_N5 - delta_K6_N4)
K78 = abs(delta_K8_N4 - delta_K7_N4)
support_bound = min(0.5 * T34, 0.1 * K78)
```

Numerically:

```text
T34 = 0.0000191327336836466
K78 = 0.00008725834113310071
support_bound = 0.000008725834113310071
```

- Supports continuing the K-tail theorem route if `T45 <= support_bound` and
  Hermiticity/gap tuning pass.
- Falsifies the fixed-`N=4` K-tail interpretation if `T45 > T34`, or
  Hermiticity/gap tuning fails.
- Remains inconclusive if `T45 <= T34` but `T45 > support_bound`.

## Consequence

- A supporting result would not prove the no-workaround target. It would only
  make fixed-`N=4` less likely to be the dominant blocker and would return the
  proof route to the sharper K-tail theorem obligation.
- A falsifying result would require replacing the fixed-`N=4` K-tail route with
  an occupation-removal theorem or a different regulator-removal route before
  any K9/N4 run.
- An inconclusive result would keep K9 blocked and require either a sharper
  occupation-tail theorem or another explicitly thresholded N-tail point.

## No-Workaround Status

Not achieved. This protocol names the next obstruction test for one temporary
regulator; it does not remove either the momentum cutoff `K` or the Fock
occupation cutoff `N`.
