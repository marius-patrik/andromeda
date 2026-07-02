import Mathlib.Analysis.InnerProductSpace.Continuous
import Mathlib.Topology.Algebra.Module.ContinuousLinearMap.Basic

open Filter Topology

/-- If A is a bounded linear operator and states converge, expectation values converge.
    (Local copy; also proved in NLimitProof.) -/
private lemma inner_bilinear_tendsto
    {k : Type*} [RCLike k]
    {H : Type*} [SeminormedAddCommGroup H] [InnerProductSpace k H] [CompleteSpace H]
    (A : H →L[k] H)
    (psi : ℕ → H) (psi_lim : H)
    (hpsi : Tendsto psi atTop (nhds psi_lim)) :
    Tendsto (fun n => @inner k H _ (A (psi n)) (psi n))
            atTop
            (nhds (@inner k H _ (A psi_lim) psi_lim)) := by
  have hApsi : Tendsto (fun n => A (psi n)) atTop (nhds (A psi_lim)) :=
    (A.continuous.tendsto _).comp hpsi
  exact hApsi.inner hpsi

/-- Abstract OS reconstruction: the truncated Euclidean two-point Schwinger function
    converges as the truncation is removed.

    Physical interpretation:
      PhysH = physical Hilbert space of phi^4_2 in finite volume
      phi_0  = field operator phi(0, 0) (bounded linear operator on PhysH)
      time_ev = Euclidean time evolution e^{-tH} (bounded linear operator)
      vac     = vacuum state of H(K, N) for finite truncation
      vac_inf = vacuum state of H(K) in the K->inf limit

    The inner product
        ⟨(phi_0 ∘ time_ev ∘ phi_0)(vac_K), vac_K⟩
    is the OS Euclidean two-point Schwinger function S_K(t) at time t.

    This theorem proves S_K(t) -> S(t) assuming the vacua converge
    (hypothesis h_os_conv).

    Explicit open hypothesis:
      h_os_conv : Tendsto vac atTop (nhds vac_inf)
      Meaning: the vacuum states of H(K,N) converge in PhysH-norm to the
               physical vacuum as K,N -> infinity.
      Status: open formalization. In physics, this follows from:
        (i)  Reflection positivity of the Hamiltonian truncation (h_rp),
             which gives the OS Hilbert space and the time evolution;
        (ii) Ground-state convergence as in Glimm-Jaffe-Spencer (1974).
      Neither h_rp nor the Glimm-Jaffe convergence is yet in Lean4/Mathlib.

    This theorem is proved from Mathlib: no sorry, no non-foundational axiom.
-/
theorem os_reconstruction_two_point_phi4_1plus1
    {PhysH : Type*} [SeminormedAddCommGroup PhysH]
    [InnerProductSpace Complex PhysH] [CompleteSpace PhysH]
    (phi_0 : PhysH →L[Complex] PhysH)
    (time_ev : PhysH →L[Complex] PhysH)
    (vac : ℕ → PhysH)
    (vac_inf : PhysH)
    -- Open hypothesis: vac_K -> vac_inf in PhysH norm.
    -- Requires h_rp (reflection positivity) + Glimm-Jaffe-Spencer ground-state convergence.
    (h_os_conv : Tendsto vac atTop (nhds vac_inf)) :
    Tendsto
      (fun K => @inner Complex PhysH _
        ((phi_0.comp (time_ev.comp phi_0)) (vac K)) (vac K))
      atTop
      (nhds (@inner Complex PhysH _
        ((phi_0.comp (time_ev.comp phi_0)) vac_inf) vac_inf)) :=
  inner_bilinear_tendsto (phi_0.comp (time_ev.comp phi_0)) vac vac_inf h_os_conv
