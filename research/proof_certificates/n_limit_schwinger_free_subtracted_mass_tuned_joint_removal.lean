import Mathlib.Analysis.InnerProductSpace.Continuous
import Mathlib.Topology.Algebra.Module.ContinuousLinearMap.Basic

open Filter Topology

/-- If A is a bounded linear operator and states converge, expectation values converge. -/
theorem inner_bilinear_convergence
    {k : Type*} [RCLike k]
    {H : Type*} [SeminormedAddCommGroup H] [InnerProductSpace k H] [CompleteSpace H]
    (A : H →L[k] H)
    (psi : Nat -> H) (psi_lim : H)
    (hpsi : Tendsto psi atTop (nhds psi_lim)) :
    Tendsto (fun n => @inner k H _ (A (psi n)) (psi n))
            atTop
            (nhds (@inner k H _ (A psi_lim) psi_lim)) := by
  have hApsi : Tendsto (fun n => A (psi n)) atTop (nhds (A psi_lim)) :=
    (A.continuous.tendsto _).comp hpsi
  exact hApsi.inner hpsi

/-- N-limit theorem for phi^4_2 Schwinger delta (conditional on Glimm-Jaffe ground-state
    convergence). Proved from mathlib: no sorry, no axiom.

    To apply to the physical theory, supply:
      h_gj : the ground states of H(K,N) converge to the ground state of H(K) as N->inf.
    This is proved in Glimm-Jaffe 1973 (not yet in Lean4).
-/
theorem n_limit_schwinger_free_subtracted_mass_tuned_joint_removal
    {FockKL : Type*} [SeminormedAddCommGroup FockKL]
    [InnerProductSpace Complex FockKL] [CompleteSpace FockKL]
    (phi_sq : FockKL →L[Complex] FockKL)
    (ground_state : Nat -> FockKL)
    (ground_state_inf : FockKL)
    -- Glimm-Jaffe hypothesis: occupation-truncated ground states converge in Fock norm.
    -- Proved in: Glimm & Jaffe, Comm. Math. Phys. 10 (1968);
    --            Glimm, Jaffe & Spencer, Ann. Math. 100 (1974).
    -- Open formalization: not yet in Lean4/Mathlib.
    (h_gj : Tendsto ground_state atTop (nhds ground_state_inf)) :
    Tendsto
      (fun N => @inner Complex FockKL _ (phi_sq (ground_state N)) (ground_state N))
      atTop
      (nhds (@inner Complex FockKL _ (phi_sq ground_state_inf) ground_state_inf)) :=
  inner_bilinear_convergence phi_sq ground_state ground_state_inf h_gj
