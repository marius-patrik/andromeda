# K6/N5 Occupation-Tail Obstruction Review

Date: 2026-05-21

## Scope

This review classifies the governed K6/N5 occupation-tail obstruction test
defined in `research/occupation_tail_obstruction_protocol.md`. It is finite
regulator evidence only. It does not remove the momentum cutoff `K`, remove
the Fock occupation cutoff `N`, or prove a no-workaround one-micrometer-squared
QFT simulation.

## Promoted Evidence

- `research/evidence/k_tail_K6_N3.json`
  - `interaction_delta_c0 = -0.0021162733776866616`
- `research/evidence/k_tail_K6_N4.json`
  - `interaction_delta_c0 = -0.002097140644003015`
- `research/evidence/k_tail_K6_N5.json`
  - `interaction_delta_c0 = -0.002095467251495009`
  - `basis_sector = zero_total_momentum`
  - `basis_size = 372`
  - `one_particle_gap = 1.0000000000004876`
  - `hermitian_error = 0.0`

## Decision Rule

From the protocol:

```text
T34 = abs(delta_K6_N4 - delta_K6_N3)
T45 = abs(delta_K6_N5 - delta_K6_N4)
K78 = abs(delta_K8_N4 - delta_K7_N4)
support_bound = min(0.5 * T34, 0.1 * K78)
```

Actual values:

```text
T34 = 0.000019132733683646652
T45 = 0.0000016733925080059109
K78 = 0.00008725834113310071
support_bound = 0.000008725834113310072
T45 / support_bound = 0.1917745038784749
T45 / T34 = 0.08746227986417916
```

## Classification

`supports_fixed_N4_continuation`

The K6 N=5 to N=4 occupation-tail movement is below the named support bound,
and the finite Hermiticity and mass-gap tuning checks pass. This supports the
interpretation that the fixed `N=4` K-tail evidence is not currently dominated
by the tested occupation-tail obstruction.

## Consequence

This result does not authorize an exactness claim. It narrows one obstruction
and returns the route to the sharper K-tail theorem obligation for the
free-subtracted, mass-tuned Schwinger interaction delta. Any later K9/N4 point
would still be finite-regulator evidence and should require a named threshold
before promotion.

## No-Workaround Status

Not achieved. The candidate still lacks a proof or certified bound removing
the momentum cutoff `K` and the Fock occupation cutoff `N`.
