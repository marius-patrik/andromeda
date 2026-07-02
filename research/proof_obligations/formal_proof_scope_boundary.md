# Formal Proof Scope Boundary

**Date:** 2026-05-22  
**Purpose:** Honest account of what automation can prove vs. what requires human mathematician input.

---

## What has been proved (machine-verified)

### post_k8_schwinger_bound_strategy (score: 1.0, ok: True)
- **Content:** The K8–K7 Schwinger tail step times 7/3 is ≤ the required target bound.
- **Why it worked:** Pure rational arithmetic. The claim reduces to `8725834113310071/10^20 × 7/3 ≤ 2097140644003015/10^19`, which `native_decide` in Lean4 / `omega`/`lra` in Coq can verify without any analysis.
- **Machine verifier:** `coqc` (and separately `lean` via `native_decide`), both compile clean.

---

## What requires human mathematician input

### 1. N-limit theorem (n_limit_schwinger_removal_strategy)

**Claim:** For the mass-tuned phi^4_2 Hamiltonian in finite volume L with UV cutoff K, the occupation-truncated Schwinger delta delta_c0(K,N) converges to delta_c0(K,∞) as N→∞.

**Why automation fails:** This requires:
- Proving that the phi^4_2 interaction is relatively bounded w.r.t. the free Hamiltonian (Nelson estimate, 1966)
- Proving that the occupation-truncated ground states converge in Fock-space norm (Kato-Rellich + spectral gap)
- Mathlib has the abstract tools (ContinuousLinearMap, Tendsto, inner product convergence), but the phi^4-specific setup (Fock space, renormalized interaction) must be formalized from scratch.

**What the Lean4 file does:**
- `research/proof_certificates/n_limit_schwinger_free_subtracted_mass_tuned_joint_removal.lean` proves the ABSTRACT part (Layer 1): if ground states converge and the observable is bounded, then the expectation value converges. This is proved from mathlib with no sorry.
- The two `axiom gj_...` statements capture exactly what needs to be formalized from the physics literature.

**Estimated effort to close the sorry/axiom gap:**
- Minimal route (accept phi^4_2 existence as given, prove our reduction): 2–4 weeks of Lean4 expert work
- Full formalization (prove phi^4_2 existence from scratch): estimated 2–5 person-years (this is an open problem in formal mathematics)

**Recommended path:** Treat the two `axiom gj_...` statements as the formal interface to Glimm-Jaffe. Any mathematician who has read Glimm-Jaffe Chapter 8 (or Simon's P(φ)_2 book) can attest these are true. The question is only whether to formalize them in Lean4 or accept them as a trusted interface.

---

### 2. OS reconstruction (os_reconstruction_obligation)

**Claim:** The family of Schwinger functions for the mass-tuned phi^4_2 theory in finite volume satisfies the OS axioms (reflection positivity, clustering, covariance, symmetry), allowing application of the Osterwalder-Schrader reconstruction theorem.

**Why it's harder than it looks:** The OS theorem is proved for the Euclidean path-integral formulation. Our theory uses Hamiltonian truncation (Fock-space). The gap:
- Euclidean lattice phi^4: reflection positivity from Osterwalder-Seiler (well-known)
- Hamiltonian truncation: reflection positivity must be proved directly from Hermiticity + a Nelson-type positivity argument

**What is known:** For phi^4_2, the full OS reconstruction is proved (GRS 1975 = Glimm, Jaffe, Spencer 1974 + Osterwalder-Schrader 1973/75). The open sub-question is whether the Hamiltonian truncation approach is equivalent to the Euclidean path-integral approach for the purpose of OS axiom verification.

**Short path:** Show that the Hamiltonian truncation Schwinger functions coincide with the Euclidean path-integral Schwinger functions in the double limit K,N→∞ (which follows from the N-limit theorem above + the K-tail bound). Then apply the known GRS result.

---

### 3. Certificates blocked by hardwired False

Six certificate checks (`fixed_volume_extrapolation_certificate`, `schwinger_interaction_delta_certificate`, etc.) are designed to pass only when `_can_clear_via_analytic_cert(check_name)` returns True, which requires a file at:
```
research/proof_certificates/{check_name}_analytic_certificate.json
```
containing a machine verification report with `"status": "passed"`.

For each of these, the path to clearing is:
1. Write a Lean4 or Coq proof of the relevant analytic bound
2. Create the certificate JSON pointing to it
3. The evaluator will then clear the cap

These are geometric series estimates, Schwinger delta bounds, and tail extrapolation arguments — all more tractable than the N-limit theorem. A mathematician could write these proofs in a few days each once the Lean4 infrastructure is in place.

---

## What automation CAN still do

1. **Finite K-tail evidence:** K9/N4, K10/N4, etc. — running more simulations is pure computation and can be automated. However, the planner now correctly blocks K10 until the N-limit theorem is addressed.

2. **Score infrastructure:** The agent can build certificate JSON structures, update train.py documentation, and improve the structural score components (which are capped at 0.35 but not gated on human proofs).

3. **Proof sketches:** Agents can write Lean4 sketches (like Layer 1 above) for the parts of the proof that are formal consequences of mathlib lemmas. This is valuable because it precisely locates the sorry/axiom boundary.

4. **Verifier scripts:** Automatically check whether a Lean4 file compiles, whether an axiom list is complete, whether certificates are well-formed.

---

## Summary table

| Theorem/Check | Automation status | Human input needed |
|---|---|---|
| post_k8_schwinger_bound_strategy | ✅ PROVED | None |
| n_limit_schwinger_removal_strategy | 🔲 Layer 1 proved, Layer 2 axioms | Glimm-Jaffe formalization |
| os_reconstruction_obligation | 🔲 Structure documented | RP for Hamiltonian truncation |
| 6x certificate checks | 🔲 Analytic cert pathway ready | Analytic bound proofs (days each) |
| fixed_volume_regulator_removal | 🔲 Gated on above | After N-limit + OS |
| exact_qft_readiness_gate | 🔲 All of the above | All of the above |

**North star:** The mathematical route EXISTS (phi^4_2 is a known Wightman QFT, Glimm-Jaffe 1973). The task is formal verification of that route. The bottleneck has shifted from "does it converge?" to "can we machine-verify that it converges?"
