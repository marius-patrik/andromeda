# Autonomous Lab Operations

The autonomous loop runs from GitHub Actions on a self-hosted runner. It is a
research instrument, not a claim of exact QFT simulation.

## Workflow

- Workflow: `.github/workflows/selfhosted-qft.yml`
- Main workflow runner labels: `self-hosted`, `qft`, `docker`
- Parallel sweep runner labels: `self-hosted`, `qft`; each shard selects Docker
  when available and otherwise falls back to a direct `uv` backend
- Default mode: `autonomous`
- Scheduled cadence: every six hours
- Result publication: one GitHub issue per run, plus uploaded `runs/**` and
  `results.tsv` artifacts
- Planning artifact: `runs/next_experiment_plan.json`, derived from the latest
  evaluator record and tracked finite-evidence files. The autonomous workflow
  does not dispatch follow-on workflows automatically; the CI run is the Codex
  candidate-agent run plus its evaluator/audit artifacts.
- Parallel sweep workflow: `.github/workflows/k-tail-sweep.yml`
- GPU readiness workflow: `.github/workflows/gpu-qft.yml`

Current runner pool:

- `s001-true-qft`: Linux/x64, labels `s001`, `qft`, `docker`; user-reported RTX 3090, primary CUDA container runner
- `dekstop-true-qft`: Linux/x64, labels `dekstop`, `qft`, `no-docker`; user-reported RTX 3070 Ti, secondary CUDA container runner once Docker/NVIDIA runtime is enabled
- `mac-true-qft`: macOS/arm64, labels `mac`, `local`, `qft`, `docker`

`dekstop` is registered without the `docker` label until user `patrik` has
permission to access `/var/run/docker.sock`; the parallel sweep can still use it
through the direct `uv` backend, but GPU routing requires Docker plus NVIDIA
runtime and therefore cannot use `dekstop` until that label/runtime is fixed.

## Secrets

Secrets are stored in GitHub Actions secrets, never in git.

Required or supported names:

- `GH_PAT`
- `LITELLM_MASTER_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `KIMI_API_KEY`
- `KIMI_API_BASE`
- `CODEX_AUTH_JSON`
- `GEMINI_OAUTH_JSON`
- `GEMINI_GOOGLE_ACCOUNTS_JSON`

`CODEX_AUTH_JSON`, `GEMINI_OAUTH_JSON`, and `GEMINI_GOOGLE_ACCOUNTS_JSON` are
materialized only inside the runner workspace and mounted read-only into the
container.

## Provider Gateway

The Docker image includes LiteLLM and a config at `config/litellm.yaml`. It
exposes OpenAI-compatible model aliases:

- `openai-default`
- `claude-default`
- `gemini-default`
- `kimi-default`

Autonomous candidate edits use `skills/autonomous-lab/scripts/codex_candidate_agent.py`.
That script runs the actual `codex exec` CLI against the LiteLLM gateway. The
legacy `candidate_editor.py` entrypoint is only a compatibility wrapper around
the Codex CLI agent and must not call model APIs directly.

Start the gateway inside the container with:

```bash
skills/autonomous-lab/scripts/start_litellm_gateway.sh
```

## Speed Rules

- Docker layers are cached on the self-hosted runner with
  `true-qft-autoresearch:latest`.
- BLAS thread counts are workflow inputs and default to `1` to avoid
  oversubscription across parallel jobs.
- Expensive finite evidence should run as governed `k-tail` mode and publish
  artifacts instead of blocking local interactive work.
- For multi-machine campaigns, use `k-tail-sweep.yml` with JSON arrays of
  K/N values. Each matrix shard runs on any available `qft` self-hosted runner,
  uses Docker or direct `uv` execution depending on the host, validates its
  artifact, publishes an issue, and uploads shard artifacts.
- For GPU readiness, use `gpu-qft.yml` against a specific NVIDIA runner label.
  The default targets `s001` and builds `Dockerfile.gpu`; it must pass
  `skills/gpu-qft-runner/scripts/gpu_container_probe.py` inside `docker run --gpus all` before any GPU
  claim is assigned. In `k-tail-smoke` mode it also runs
  `skills/gpu-qft-runner/scripts/k_tail_gpu_smoke.py`, which compares a CUDA dense eigensolver result
  against the CPU K-tail smoke result. GPU smoke output is not research evidence
  until it matches CPU smoke behavior and passes the normal proof-ledger gates.

Example:

```bash
gh workflow run k-tail-sweep.yml \
  -f momentum_cutoffs='[8,9]' \
  -f occupation_cutoffs='[4]' \
  -f max_parallel=2 \
  -f description='parallel K-tail theorem stress campaign'
```

```bash
gh workflow run gpu-qft.yml \
  -f runs_on='["self-hosted","qft","docker","s001"]' \
  -f mode=probe
```

## Autonomy Boundary

The scheduled loop may select and publish a next experiment, but it does not
fan out into extra workflow dispatches or silently mutate the truth contract.
Candidate edits are limited to `research/proof_certificates/**` and the
existing `post_k8_schwinger_bound_strategy()` method in `train.py`, and are
attempted by the Codex CLI gateway agent. Evaluator edits in `prepare.py` are
infrastructure work and must raise the truth bar, not game the score. The
next-experiment plan is therefore advisory until a committed experiment branch
executes it and publishes the resulting artifact.
