# One Micrometer Squared Volume Target Mapping & Bridge

This document details how the physical target of a $1 \text{ \mu m}^2$ spatial area maps to our current scalar Hamiltonian simulation framework (`true-qft-autoresearch`) and outlines the concrete, missing mathematical obligations required to transition from finite-evidence status to a true "no-workaround" physical volume simulator.

## 1. Physical Target and Unit Mapping

The simulation volume is a physical constraint of the target theory:
- **Target Area:** $10^{-12} \text{ m}^2$ (exactly $1 \text{ \mu m}^2$).
- **Side Length (if square):** $1.0 \text{ \mu m}$ ($10^{-6} \text{ m}$).
- **Role of Finite Volume:** The spatial boundary of size $L$ is the physical box enclosing the scalar field. It is **not** a discretization grid spacing, lattice cell size, or numerical cutoff.

### Unit Bridge to Hamiltonian Length $L$
The Hamiltonian formulation uses a dimensionless length parameter $L_{\text{dim}}$. To map this to the physical $1 \text{ \mu m}$ scale:
1. We choose a mass/energy unit (e.g., $m_{\text{phys}}$ in eV or inverse meters).
2. The physical side length is $L_{\text{phys}} = 10^{-6} \text{ m}$.
3. The dimensionless length is related by $L_{\text{dim}} = L_{\text{phys}} \times m_{\text{phys}}$.
4. Changing the choice of mass/energy units scales both $L_{\text{dim}}$ and the momentum cutoff $K$ proportionally, meaning unit choice **cannot hide or eliminate** the regulators.

---

## 2. Current Evidence & Blockers

Based on our current diagnostics at $L=4.0$, $m=1.0$, $g=0.1$, the regulator-removal limit fails to certify:

* **Extrapolation Sign Flip:** The connected zero-mode response changes sign under different cutoff pairs, leading to a status of `failed_sign_flip`.
* **High Relative Error:** The estimated relative extrapolation error is approximately $1.64$ ($164\%$), far exceeding the certification limit of $0.25$ ($25\%$).
* **Bare Coupling Pathology:** Holding the connected shift constant under cutoff variations requires the bare coupling to change sign (`coupling_flow_requires_negative_bare_coupling: true`). This sign flip suggests that the current regulator family is unstable under renormalization flows.

---

## 3. Missing No-Workaround Obligations

To achieve a true "no-workaround" QFT simulation where the only external constraint is the physical volume, the following mathematical and physical conditions must be proven:

1. **Exact Finite-Volume Object:** Rigorously define the $\phi^4$ Hamiltonian or quantum state space directly on a circle of size $1 \text{ \mu m}$ without referring to cutoffs.
2. **Uniform Regulator Removal:** Prove that the momentum cutoff $K$ and Fock occupation cutoff $N$ can be taken to infinity for the entire observable algebra, rather than tuning one specific parameter/eigenvalue.
3. **Renormalization Stability:** Replace the negative-bare-coupling artifact with a stable, positive-definite renormalization prescription that does not cause path instability.
4. **Scale Invariance of Truncations:** Formulate a method to change the mass unit without introducing a hidden resolution or grid scale that implicitly bounds the truncation.
