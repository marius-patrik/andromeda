# Research Agenda

## North Star

Find a mathematically honest route to simulating quantum fields over spacetime
with finite spatial volume as the only allowed final constraint, without
replacing the problem with a toy classical field animation or an unstated
discretization trick.

The north star is true exact QFT simulation. Approximants, truncations, and
finite experiments are acceptable only as research instruments that help define,
prove, certify, or falsify the exact construction.

Momentum cutoffs, Fock occupation cutoffs, sampling limits, or basis truncations
are not allowed final constraints. They must be removed, certified with error
bounds, or replaced by exact finite-volume machinery.

## Working Definition of "True"

A candidate simulation is true only to the extent that it defines:

- the continuum target theory,
- the exact field/state/dynamics object being claimed,
- the finite regulated approximants,
- the observable algebra it can actually measure,
- the renormalization or limit procedure,
- the convergence/falsification tests,
- the proof obligations required to remove the regulator,
- the computational resources required.

## Initial Line of Attack

Start with scalar `phi^4` in low spacetime dimension as the first interacting
target. Use the free scalar theory as the calibration oracle. Prefer
finite-volume spectral, Hamiltonian, and Fock-space truncation methods over a
spacetime lattice.

## Research Tracks

1. Spectral/Hamiltonian construction
   - finite-volume mode expansion,
   - Fock occupation cutoff,
   - interacting Hamiltonian matrix elements,
   - counterterm flow,
   - spectral convergence,
   - cutoff sweeps over momentum cutoff, occupation cutoff, and volume.
   - mass-gap tuning as the first finite renormalization condition.
   - connected four-point spectral response as an independent observable.
   - finite-volume scaling after mass tuning.

2. Constructive/QFT foundations
   - define the target via Schwinger functions or operator algebras,
   - identify which dimensions/interactions have rigorous footholds,
   - encode reflection positivity and covariance checks where applicable.

3. Exactness and proof scaffolding
   - state the exactness criterion before any numerical score is trusted,
   - separate theorem obligations from empirical convergence evidence,
   - track which counterexamples would kill the candidate construction.

4. Functional renormalization
   - represent scale flow without pretending it is the full field,
   - compare fixed-point and running-coupling behavior against observables.

5. Quantum-simulation bridge
   - map finite regulated Hamiltonians to qubits/qumodes,
   - track which classical checks are needed before quantum execution,
   - keep real-time dynamics separate from Euclidean Monte Carlo claims.

## Open Questions

- Can we define a non-lattice regulator family that is computationally useful
  and has a defensible continuum limit?
- Which observables best expose fake progress early?
- What minimum set of renormalization conditions prevents cutoff tuning from
  becoming arbitrary curve-fitting?
- Can the interacting mass-gap shift be stabilized by a real counterterm flow,
  or does the current spectral/Fock probe falsify this regulator family early?
- Does the fitted mass counterterm flow approach a limit or scaling law as
  `K`, `N`, and `L` grow?
- After mass tuning, does the connected four-point response stabilize, or does
  it require an independent coupling counterterm?
- Is the large small-volume connected-response outlier a finite-volume artifact,
  a truncation artifact, or evidence that the current regulator family needs a
  better scaling prescription?
- At fixed finite volume, can the connected response converge as `K,N -> inf`,
  or does the spectral/Fock truncation need a different non-volume regulator
  removal strategy?
- Can a fixed-volume extrapolation certificate reduce the current relative
  error enough to certify K/N removal, or is a stronger basis/exact method
  required?
- Why does the connected response flip sign at `(K=2,N=4)` after mass tuning:
  basis truncation pathology, level ordering artifact, or a signal that this
  observable definition is not robust enough for K/N removal?
- Overlap tracking shows the `(K=2,N=4)` sign flip is not merely a naive level
  index swap; the next candidate must explain the high-overlap tracked state
  instability or replace the observable.
- The mass-tuned vacuum energy density is much more stable across the high-K
  occupation tail than the two-particle connected proxy; use it to separate
  observable pathology from full regulator failure.
- How should the score reward proof-quality progress versus numerical progress?
- What would constitute a certificate that a finite computation is exposing the
  exact QFT rather than substituting a different theory?
- Which parts of the loop require a room-scale compute cluster, and which parts
  can be validated locally?
- The tracked K6/N4 Schwinger evidence leaves a concrete theorem gap: the
  observed K-tail ratio is about `0.8285`, while the current geometric
  certificate would need an effective post-K6 ratio no larger than about
  `0.6415`. The next proof-search target is a uniform K-tail theorem for the
  free-subtracted interacting Schwinger delta, not another claim that a finite
  matrix is exact.
- The next finite evidence job should be treated as a falsification stress
  test: K7/N4 only supports the current K-tail theorem route if the absolute
  K7-K6 interaction-delta tail is below the threshold derived from the K6 proof
  contract. It still cannot be promoted to an exact simulation claim.
- K7 evidence must be promoted only as tracked evidence under
  `research/evidence/k_tail_K7_N4.json`; until that file exists, the lab should
  report the K7 classifier as pending rather than infer success from a protocol
  or an untracked run artifact.
- K8/N4 current-HEAD evidence is now tracked and reviewed. Its K8-K7 tail
  decreases but remains above the support threshold, so it is inconclusive and
  does not authorize an automatic K9/N4 continuation. The next aligned research
  step is a sharper K-tail theorem or an occupation-tail obstruction test with
  a named proof-ledger threshold before any further finite K sweep.
- The named occupation-tail obstruction test is K6/N5 against the existing
  K6/N3 and K6/N4 anchors. It supports fixed-`N=4` continuation only if the
  N5-N4 tail is no larger than `0.000008725834113310071`; it falsifies fixed
  `N=4` as a K-tail basis if the N5-N4 tail grows above the N4-N3 tail.
- K6/N5 has now been promoted and classified as supporting the fixed-`N=4`
  continuation interpretation for the tested occupation-tail gate:
  `abs(delta_K6_N5 - delta_K6_N4) = 0.0000016733925080059109`, below the
  named support bound. This does not prove regulator removal; it returns the
  route to the sharper K-tail theorem/certified-bound obligation before any
  later K9/N4 finite point can be promoted as more than evidence.
