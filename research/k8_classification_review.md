# K8/N4 Classification Review

Date: 2026-05-20

## Scope

This review classifies the validated current-HEAD K8/N4 finite-regulator
evidence and decides the next aligned research step for the one micrometer
squared finite-volume true-QFT goal. It is not new scientific evidence and does
not claim regulator removal.

## Inputs

- Evidence: `research/evidence/k_tail_K5_N4.json`
- Evidence: `research/evidence/k_tail_K6_N4.json`
- Evidence: `research/evidence/k_tail_K7_N4.json`
- Evidence: `research/evidence/k_tail_K8_N4.json`
- Ledger rule: `research/proof_ledger.md#k8-falsifying-experiment-result`

Tracked interaction deltas:

| K | N | interaction_delta_c0 |
|---|---|---:|
| 5 | 4 | -0.0019799500984395424 |
| 6 | 4 | -0.002097140644003015 |
| 7 | 4 | -0.002197172175804285 |
| 8 | 4 | -0.0022844305169373857 |

Tail checks:

| Tail | Absolute size |
|---|---:|
| K6 - K5 | 0.0001171905455634726 |
| K7 - K6 | 0.00010003153180127011 |
| K8 - K7 | 0.00008725834113310071 |

K8 finite checks:

- `one_particle_gap = 0.9999999999992072`
- `hermitian_error = 0.0`
- `basis_size = 5985`

## Decision

The K8/N4 evidence is
`inconclusive_tail_decreases_but_above_required_ratio`.

Reasons:

- The K8-K7 tail decreases relative to K7-K6.
- Hermiticity and one-particle gap tuning pass the current finite checks.
- The K8-K7 tail is still above the support bound
  `0.0000641716833071184`.
- The induced post-K8 geometric remainder is about
  `0.00015614998022122297`, which does not establish regulator removal.
- The observed K8/K7 tail ratio is about `0.8723083567934804`, while the
  current geometric certificate needs a much sharper effective ratio.

## Route Consequence

K8 neither supports the current geometric K-tail theorem route nor falsifies
the whole spectral/Fock construction. It does falsify treating monotone finite
tail decrease as enough for the no-workaround target.

K9/N4 is not authorized as an automatic continuation. A later K9/N4 point may
be useful only after a proof-ledger update states which theorem or obstruction
it is testing and what decision threshold would change.

## Next Proof Obligation

The next aligned step is a theorem or obstruction review, not another blind
finite K sweep:

1. Derive a sharper K-tail theorem for the free-subtracted, mass-tuned
   Schwinger delta that can beat the K8 support threshold without changing the
   target theory.
2. In parallel or as a fallback, test whether the fixed `N=4` occupation
   sector hides an occupation-tail obstruction by comparing at least one
   controlled lower-K, higher-N point against the K-tail conclusions.
3. Require any new finite point to name the theorem or obstruction it tests
   before it is launched.

## No-Workaround Status

Not achieved. The current repository has validated finite-regulator evidence
through K8/N4, but still lacks a proof removing the momentum and occupation
regulators at the one micrometer squared finite volume.
