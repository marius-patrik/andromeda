# Source Map

Primary sources and research landmarks for this project.

## Autoresearch Pattern

- Andrej Karpathy, `karpathy/autoresearch`:
  https://github.com/karpathy/autoresearch
  - Small repo.
  - Human edits `program.md`.
  - Agent edits one experiment file.
  - Fixed evaluator decides whether progress survives.

## Quantum Field Simulation

- John Preskill, "Simulating quantum field theory with a quantum computer":
  https://arxiv.org/abs/1811.10085
  - Classical methods remain powerful for Euclidean lattice QCD.
  - Real-time dynamics and strongly coupled regimes remain hard.
  - Quantum computers are a long-term route for QFT simulation.

- Stephen P. Jordan, Keith S. M. Lee, John Preskill,
  "Quantum Algorithms for Quantum Field Theories":
  https://arxiv.org/abs/1111.3633
  - Develops quantum algorithms for scattering in massive scalar `phi^4`
    theory in four or fewer spacetime dimensions.
  - Good anchor for eventual quantum-backend encodings.

- Clay Mathematics Institute, Yang-Mills existence and mass gap:
  https://www.claymath.org/lectures/yang-mills-existence-and-mass-gap/
  - Non-abelian 4D continuum QFT foundations remain a live mathematical
    frontier.
  - This is why the project must avoid pretending a finite script has solved
    exact continuum QFT.

## Method Families to Investigate

- Constructive QFT and Osterwalder-Schrader reconstruction.
- Wightman axioms, Haag-Kastler/algebraic QFT, and operator-valued
  distributions as possible exact target languages.
- Hamiltonian truncation and finite-volume spectral methods.
- Functional renormalization group.
- Tensor-network/state-space approximations and continuum limits.
- Stochastic quantization as a Euclidean/statistical route, not a blanket
  substitute for Lorentzian real-time QFT.

## Exactness Anchors to Add

- Arthur Jaffe and James Glimm, constructive quantum field theory texts and
  papers:
  - Use for rigor around existence, fields as distributions, and the gap
    between finite regulators and continuum objects.

- Konrad Osterwalder and Robert Schrader, Euclidean reconstruction:
  - Use for conditions under which Euclidean correlation functions define a
    Lorentzian QFT rather than just a numerical statistical model.

- Rudolf Haag, local quantum physics / algebraic QFT:
  - Use for exact local observable algebra language when a Hilbert-space
    cutoff basis is too tied to the regulator.
