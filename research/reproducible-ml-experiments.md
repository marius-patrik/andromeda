# Reproducible ML Experiment Template

This note captures a minimal, clone-ready template and 48-hour runbook for reproducible continual-learning experiments with PyTorch, CUDA, Avalanche, and Weights & Biases.

## Goals

- One command to run experiments locally or on a GPU server.
- Pinned CUDA and PyTorch in Docker for repeatable environments.
- Deterministic seeds and cuDNN settings.
- YAML-driven sweeps for repeatable ablations.
- W&B logging plus local per-seed artifacts.
- CPU smoke tests in CI to catch regressions early.

## Repository layout

```text
.
├─ bench/
│  ├─ config.yaml
│  └─ datasets.md
├─ docker/
│  ├─ Dockerfile.nvidia
│  └─ requirements.txt
├─ run.sh
├─ src/
│  ├─ main.py
│  ├─ data.py
│  ├─ model.py
│  ├─ train.py
│  └─ utils/
│     ├─ seeds.py
│     ├─ wandb_logger.py
│     └─ artifacts.py
├─ results/
├─ .github/workflows/
│  └─ smoke.yml
└─ README.md
```

## Docker environment

Use a pinned NVIDIA CUDA runtime and exact PyTorch wheel versions. Avoid `latest` tags for reproducibility.

```Dockerfile
# docker/Dockerfile.nvidia
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CUBLAS_WORKSPACE_CONFIG=:4096:8 \
    TORCH_CUDNN_DTERMINISTIC=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential python3 python3-pip && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir \
    torch==2.2.2+cu121 torchvision==0.17.2+cu121 \
    --index-url https://download.pytorch.org/whl/cu121

COPY docker/requirements.txt /tmp/requirements.txt
RUN pip3 install --no-cache-dir -r /tmp/requirements.txt

WORKDIR /workspace
COPY . /workspace
```

```text
# docker/requirements.txt
avalanche-lib==0.4.0
wandb==0.16.6
numpy==1.26.4
tqdm==4.66.4
matplotlib==3.8.4
```

Build and record the image digest:

```bash
docker build -f docker/Dockerfile.nvidia -t cl-repro .
docker inspect --format='{{index .RepoDigests 0}}' cl-repro > docker_image_digest.txt
```

## Determinism

```python
# src/utils/seeds.py
import random
import numpy as np
import torch


def set_all(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.use_deterministic_algorithms(True)
    torch.backends.cudnn.benchmark = False
```

Use this at the top of every experiment entrypoint before creating datasets, dataloaders, or models.

## Sweep config

```yaml
# bench/config.yaml
experiment: split-mnist
backbone: mlp
seeds: [1, 2, 3, 4, 5]
gpu: 0

grid:
  mode: [online, offline, hybrid]
  sleep_freq: [0, 100, 500]
  offline_epochs: [0, 1, 5]
  priority_alpha: [0.0, 0.3, 0.7]

logging:
  wandb_project: continual-baselines
  wandb_entity: null
  save_checkpoints: true
```

## CLI wrapper

```bash
#!/usr/bin/env bash
# run.sh
set -euo pipefail

EXP="split-mnist"
MODE="hybrid"
SEEDS="1"
GPU="0"
CFG="bench/config.yaml"

while [[ $# -gt 0 ]]; do
  case $1 in
    --exp) EXP="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --seeds) SEEDS="$2"; shift 2 ;;
    --gpu) GPU="$2"; shift 2 ;;
    --cfg) CFG="$2"; shift 2 ;;
    *) echo "Unknown arg $1"; exit 1 ;;
  esac
done

export CUDA_VISIBLE_DEVICES="$GPU"
IFS=',' read -ra S <<< "$SEEDS"
for seed in "${S[@]}"; do
  python3 -m src.main --exp "$EXP" --mode "$MODE" --seed "$seed" --cfg "$CFG"
done
```

Example:

```bash
./run.sh --exp split-mnist --mode hybrid --seeds 1,2,3,4,5 --gpu 0
```

## Entrypoint and metrics

```python
# src/main.py
import argparse
import yaml

from src.train import run_experiment
from src.utils.seeds import set_all
from src.utils.wandb_logger import maybe_init

parser = argparse.ArgumentParser()
parser.add_argument("--exp", required=True)
parser.add_argument("--mode", required=True)
parser.add_argument("--seed", type=int, required=True)
parser.add_argument("--cfg", default="bench/config.yaml")
args = parser.parse_args()

cfg = yaml.safe_load(open(args.cfg))
set_all(args.seed)

wandb_run = maybe_init(cfg, args)
summary = run_experiment(
    exp=args.exp,
    mode=args.mode,
    seed=args.seed,
    cfg=cfg,
    wandb_run=wandb_run,
)

forgetting = {
    task: summary["peak"][task] - summary["final"][task]
    for task in summary["final"]
}

if wandb_run:
    import wandb

    wandb.log({"forgetting/mean": sum(forgetting.values()) / len(forgetting)})
    wandb.summary.update({"forgetting": forgetting})

print("DONE", forgetting)
```

Track at least:

- accuracy by task and experience,
- final average accuracy,
- mean forgetting index,
- forward transfer,
- wall-clock time,
- image digest and git commit SHA.

## W&B logger

```python
# src/utils/wandb_logger.py
def maybe_init(cfg, args):
    project = cfg.get("logging", {}).get("wandb_project")
    if not project:
        return None

    import wandb

    wandb.init(
        project=project,
        entity=cfg["logging"].get("wandb_entity"),
        config={"exp": args.exp, "mode": args.mode, "seed": args.seed, **cfg},
    )
    return wandb.run
```

## Artifacts

Each seed should write to:

```text
results/<exp>/<mode>/seed-<n>/
```

Pack the run directory at the end of training:

```python
# src/utils/artifacts.py
import os
import tarfile


def pack_run(out_dir: str) -> str:
    tar_path = out_dir.rstrip("/") + ".tar.gz"
    with tarfile.open(tar_path, "w:gz") as archive:
        archive.add(out_dir, arcname=os.path.basename(out_dir))
    return tar_path
```

## CI smoke test

```yaml
# .github/workflows/smoke.yml
name: smoke

on:
  push:
    branches: [main]
  schedule:
    - cron: "0 3 * * *"

jobs:
  cpu-smoke:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        exp: [split-mnist]
        mode: [online]
        seed: [1]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: >-
          pip install -r docker/requirements.txt
          torch==2.2.2+cpu torchvision==0.17.2+cpu
          -f https://download.pytorch.org/whl/cpu/torch_stable.html
      - run: >-
          python -m src.main
          --exp ${{ matrix.exp }}
          --mode ${{ matrix.mode }}
          --seed ${{ matrix.seed }}
      - name: Attach Docker image digest
        if: ${{ hashFiles('docker_image_digest.txt') != '' }}
        run: echo "DIGEST=$(cat docker_image_digest.txt)" >> $GITHUB_OUTPUT
```

## 48-hour runbook

### Stage 0: CPU smoke test

Run:

```bash
python -m src.main --exp split-mnist --mode online --seed 1
```

Expected outcome: dataset download works, the training loop runs, logging initializes, metrics are emitted, and artifacts are written.

### Stage 1: Split-MNIST sweep

Run on one mid-range GPU:

```bash
./run.sh --exp split-mnist --mode hybrid --seeds 1,2,3,4,5 --gpu 0
```

Use the config grid for `sleep_freq`, `offline_epochs`, and `priority_alpha`.

Deliverables:

- W&B dashboard grouped by `mode`,
- per-seed `.tar.gz` artifacts,
- accuracy curves,
- forgetting index summary,
- forward-transfer summary.

### Stage 2: CIFAR incremental learning

Run on a single A100-class GPU when available:

```bash
./run.sh --exp cifar-il --mode hybrid --seeds 1,2,3,4,5 --gpu 0
```

Use fast local dataset caching. Keep logging, artifact naming, and metric definitions identical to Stage 1.

## Reproducibility checklist

Before sharing results, verify:

- Docker base image and PyTorch/CUDA versions are pinned.
- `docker_image_digest.txt` is committed or attached to artifacts.
- Git commit SHA is logged in W&B.
- All seeds use the same config file.
- Results are grouped by experiment, mode, and seed.
- Every run has a local artifact tarball.
- CI smoke test passes on CPU.
- Dataset cache paths and preprocessing are documented in `bench/datasets.md`.

## Fast path

1. Build the Docker image and record the digest.
2. Edit `bench/config.yaml` for the project, seeds, and grid.
3. Run Stage 0, then Stage 1, then Stage 2.
4. Share the W&B link, upload the `results/` artifacts, and commit the Docker digest.
