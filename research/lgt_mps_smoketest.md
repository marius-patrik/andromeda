# Lattice Gauge MPS Smoke Test

This document defines a small, reproducible lattice-gauge simulation for validating gauge invariance and real-time integration stability before scaling to larger runs.

## Target run

Simulate a one-dimensional lattice gauge theory on a chain of length `L = 20` with open boundaries using an MPS real-time evolution pipeline.

Default parameters:

- Gauge group: U(1) truncated rotor, with optional Z2 variant.
- Link cutoff: `n_max = 3`, so link states are `|m>` for `m = -n_max, ..., +n_max`.
- Evolution method: two-site TDVP, or TEBD split as fallback.
- Bond dimension cap: `chi_max = 128`.
- Time step: `dt = 0.01`.
- Final time: `T = 10.0`.
- Checkpoint interval: `0.5` time units.
- Abort tolerance: `max_x ||G_x |psi>|| > 1e-8`.

## Local basis

Use staggered matter sites interleaved with gauge links:

```text
site_0, link_0, site_1, link_1, ..., site_{L-1}
```

For U(1), each link has the finite basis:

```text
{|m> : m = -n_max, ..., +n_max}
```

Build local site/link objects so the initial state and Hamiltonian respect Gauss law. Implement the Gauss generator as a local operator `G_x` and use it in diagnostics throughout the run.

## Initial state

Use a gauge-invariant product state:

- vacuum matter sector with zero electric flux, or
- a fixed uniform electric-flux sector.

The initial MPS must satisfy:

```text
G_x |psi_0> = 0  for all x
```

Avoid relying only on penalty terms to enforce the constraint during this smoke test. The purpose is to verify that the basis, MPO, and time evolution preserve the physical sector directly.

## Hamiltonian

Use only gauge-invariant terms.

Electric field:

```text
H_E = (g^2 / 2) sum_l E_l^2
```

with `g^2 = 1.0`.

Staggered mass:

```text
H_m = m sum_x (-1)^x n_x
```

with `m = 0.1`.

Matter-gauge hopping:

```text
H_K = -kappa sum_x (psi_x^dagger U_x psi_{x+1} + h.c.)
```

Use `kappa = 1.0` for the first smoke test unless another convention is already defined in the codebase.

For a Z2 variant, replace U(1) rotor links with Pauli link fields and update the Gauss operator and coupling terms accordingly.

## Diagnostics

Log these after every time step:

- `t`: simulation time.
- `energy`: `<psi(t)|H|psi(t)>`.
- `energy_drift`: `energy(t) - energy(0)`.
- `gauss_max`: `max_x ||G_x |psi(t)>||`.
- `S_mean`: mean bipartite entanglement entropy.
- `chi_max`: maximum active MPS bond dimension.

Abort immediately if `gauss_max > 1e-8`. If the run aborts, first halve `dt`; if it still fails, increase `n_max` or `chi_max`.

## Checkpointing

Save a full MPS checkpoint every `0.5` time units. Each checkpoint should include:

- MPS tensors and canonical-form metadata.
- Simulation parameters.
- RNG seed.
- Git commit SHA or code version.
- Local package versions.

Store logs separately as JSON or JSONL so quick plots do not require loading full checkpoints.

## teNPy driver sketch

```python
import json
import pathlib
import numpy as np
from tenpy.algorithms import tdvp
from tenpy.tools import hdf5_io

L = 20
n_max = 3
chi_max = 128
dt = 1e-2
T = 10.0
g2 = 1.0
mass = 0.1
kappa = 1.0
abort_tol = 1e-8
checkpoint_dt = 0.5
seed = 7

matter_sites, link_sites = build_u1_truncated_sites(L, n_max)
sites = interleave_sites(matter_sites, link_sites)

psi = build_gauge_invariant_product_mps(
    sites,
    sector="vacuum_zero_field",
    chi=8,
    seed=seed,
)

H_mpo = build_hamiltonian_u1_mpo(
    sites,
    g2=g2,
    mass=mass,
    kappa=kappa,
    open_bc=True,
)

eng = tdvp.TwoSiteTDVP(
    psi,
    H_mpo,
    dt=dt,
    trunc_params={"chi_max": chi_max},
)

def gauss_error(psi):
    return max_gauss_violation(psi)

def energy(psi):
    return expectation_value_mpo(psi, H_mpo)

def entropy_mean(psi):
    psi.canonical_form()
    entropies = psi.entanglement_entropy()
    return float(np.mean(entropies))

pathlib.Path("logs").mkdir(exist_ok=True)
pathlib.Path("checkpoints").mkdir(exist_ok=True)

E0 = energy(psi)
t = 0.0
next_ckpt = checkpoint_dt
log = []

while t < T - 1e-12:
    eng.run_one_step()
    t += dt

    E = energy(psi)
    ge = gauss_error(psi)
    S_mean = entropy_mean(psi)
    chi_now = max(B.shape[1] for B in psi._B)

    row = {
        "t": t,
        "energy": float(E),
        "energy_drift": float(E - E0),
        "gauss_max": float(ge),
        "S_mean": S_mean,
        "chi_max": int(chi_now),
    }
    log.append(row)
    print(row)

    if ge > abort_tol:
        raise RuntimeError(
            "Gauss-law violation exceeded tolerance; "
            "try smaller dt, larger n_max, or larger chi_max."
        )

    if t + 1e-12 >= next_ckpt:
        hdf5_io.save_to_hdf5(f"checkpoints/mps_t{t:.2f}.h5", psi)
        next_ckpt += checkpoint_dt

with open("logs/lgt_mps_smoketest.json", "w") as f:
    json.dump(log, f, indent=2)
```

Implementation-specific helper functions:

```text
build_u1_truncated_sites
interleave_sites
build_gauge_invariant_product_mps
build_hamiltonian_u1_mpo
max_gauss_violation
expectation_value_mpo
```

Keep these functions small, tested, and version-controlled.

## Exact diagonalization baseline

Include a tiny exact or Lanczos baseline for `L = 6` to `L = 8`. Use it to compare:

- initial energy,
- short-time energy drift,
- selected local densities or electric fields,
- Gauss-law residuals.

This catches basis-ordering, sign-convention, and link-orientation bugs before running the MPS version.

## Suggested repository layout

```text
research/
  lgt_mps_smoketest.md
src/
  basis_u1.py
  mpo_u1.py
  initial_states.py
  observables.py
  run_tdvp.py
tests/
  test_gauss_smallL.py
logs/
checkpoints/
```

## Acceptance criteria

A successful smoke test should satisfy:

- `gauss_max <= 1e-8` throughout the run.
- Energy drift remains smooth and small for the chosen `dt` and truncation.
- No unexpected bond-dimension saturation before early-time dynamics are understood.
- `L = 6` to `L = 8` MPS/TDVP results agree with the exact baseline over short times.

## Follow-up extensions

After the smoke test passes:

1. Sweep `dt` to verify convergence.
2. Sweep `n_max` to check electric-field truncation stability.
3. Sweep `chi_max` to quantify truncation error.
4. Add Z2 as a lower-dimensional control model.
5. Add plotting scripts for energy drift, Gauss violation, entanglement growth, and bond dimensions.
