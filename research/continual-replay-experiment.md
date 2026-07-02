# Continual Replay Experiment: Memory Consolidation Strategies

## Purpose

This experiment tests whether replay-based memory consolidation reduces catastrophic forgetting in continual learning. The study compares no replay, uniform replay, prioritized replay, and sleep-style offline replay across one supervised continual-learning task and one reinforcement-learning task.

## Background

Catastrophic forgetting occurs when a model learns a new task and loses performance on earlier tasks. Replay methods reduce forgetting by reintroducing older examples or trajectories during later training. This experiment is designed as a fast, high-signal sprint that can be run in roughly 48 hours on modest hardware, then expanded if the first results are promising.

## Research Question

Which replay strategy gives the best retained performance per unit of compute?

## Hypotheses

1. Uniform replay will reduce forgetting relative to no replay.
2. Prioritized Experience Replay will improve sample efficiency when the priority signal is well aligned with task loss or TD error.
3. Sleep-style replay will reduce forgetting most strongly, but may cost more compute.
4. The most useful method will be the one that improves retained accuracy or return while staying under a 2x compute budget.

## Conditions

| Condition | Description |
|---|---|
| No replay | Train only on the current stream or environment interaction. |
| Uniform replay | Sample past items uniformly from a fixed-size buffer. |
| Prioritized replay | Sample past items with probability proportional to loss or TD error. |
| Sleep replay | Pause online training at fixed intervals and run offline consolidation epochs over buffered or synthetic replay data. |

## Tasks

### Supervised Continual Learning

Use one of the following:

- Split-MNIST: 5 tasks with 2 classes per task.
- CIFAR-10 incremental: 5 tasks with 2 classes per task.

Recommended first run: Split-MNIST for speed, then CIFAR-10 incremental for a stronger result.

### Reinforcement Learning

Use one of the following:

- CartPole-v1 for a fast sanity check.
- A small MuJoCo-style environment if available and compute allows.

Recommended first run: CartPole-v1 with a DQN-style agent.

## Experimental Grid

Run each condition with 5 random seeds.

| Domain | Task | Replay modes | Seeds |
|---|---|---:|---:|
| Supervised | Split-MNIST or CIFAR-10 incremental | none, uniform, per, sleep | 5 |
| RL | CartPole-v1 | none, uniform, per, sleep | 5 |

Use 10k to 50k total training steps per run. Log everything to Weights & Biases and save representation checkpoints every fixed interval.

## Hyperparameter Sweep

Keep the sweep small for the first sprint.

| Parameter | Values | Applies to |
|---|---|---|
| `sleep_freq` | 500, 1000, 2000 | sleep replay |
| `offline_epochs` | 1, 5, 10 | sleep replay |
| `priority_alpha` | 0.4, 0.6, 0.8 | prioritized replay |

Hold optimizer, learning rate schedule, model size, batch size, task order, and buffer size constant across conditions unless the ablation explicitly changes them.

## Success Criteria

A replay method is considered promising if it achieves:

- At least 10% reduction in forgetting compared with no replay.
- No more than 2x wall-time or FLOP overhead.
- Stable results across 5 seeds.

If a method passes this threshold, containerize the experiment and run a deeper ablation for publication-quality plots.

## Metrics

### Primary Metrics

- Average accuracy across tasks for supervised learning.
- Average return for reinforcement learning.
- Forgetting index per task: `max_performance(task) - final_performance(task)`.
- Mean forgetting across tasks.

### Secondary Metrics

- Forward transfer: early performance on new tasks relative to no-replay baseline.
- Sample efficiency: steps needed to reach a fixed accuracy or return threshold.
- Representation overlap: CKA, CCA, or PCA subspace similarity across task checkpoints.
- Compute efficiency: retained performance per wall-time or estimated FLOP budget.

## Core API

```python
class MemoryConsolidator:
    def __init__(
        self,
        mode: str,
        buf_size: int = 50_000,
        priority_alpha: float = 0.6,
        sleep_freq: int = 1000,
        offline_epochs: int = 5,
    ):
        """
        mode in {"none", "uniform", "per", "sleep"}
        """

    def observe(self, x, y=None, reward=None, info=None, loss=None, td_error=None):
        """Insert one experience and optional priority signal."""

    def sample(self, batch_size: int):
        """Return indices, replay data, and optional importance weights."""

    def update_priorities(self, idxs, new_priorities):
        """Update priorities for PER; no-op for other modes."""

    def maybe_sleep(self, model, optimizer, data_loader_fn):
        """
        If mode == "sleep" and step % sleep_freq == 0,
        run offline consolidation for offline_epochs.
        """
```

## Supervised Training Loop Sketch

```python
for step, (x, y) in enumerate(stream_loader):
    logits = model(x)
    loss = ce_loss(logits, y)
    loss.backward()
    opt.step()
    opt.zero_grad()

    mem.observe(x=x, y=y, loss=loss.detach())

    if mem.mode in {"uniform", "per"}:
        bx, by, iw, idxs = replay_sampler(mem, batch_size=B)
        l_rep = ce_loss(model(bx), by, reduction="none")
        l_rep = (l_rep * iw).mean() if iw is not None else l_rep.mean()
        l_rep.backward()
        opt.step()
        opt.zero_grad()

        if mem.mode == "per":
            mem.update_priorities(idxs, l_rep.detach())

    mem.maybe_sleep(model, opt, data_loader_fn=buffer_loader)
```

## RL Training Loop Sketch

Use a DQN-style agent for CartPole-v1.

- Store transitions in the shared memory buffer.
- For uniform replay, sample transitions uniformly.
- For PER, use absolute TD error as the priority signal.
- For sleep replay, pause environment collection every `sleep_freq` online steps and run `offline_epochs` buffer-training passes.
- Evaluate the greedy policy every fixed number of environment steps.

## Logging Requirements

Log the following to Weights & Biases:

- Per-task accuracy or episodic return.
- Running best performance per task.
- Forgetting index.
- Training step and environment step.
- Wall-time.
- Learning rate.
- Replay mode and all replay hyperparameters.
- Buffer occupancy.
- Offline sleep compute time.

Save encoder checkpoints after each task and at the final checkpoint for representation analysis.

## Reproducibility Requirements

- Use 5 seeds per condition.
- Store the task order for every seed.
- Use the same model backbone per domain.
- Use the same optimizer and learning-rate schedule across replay modes.
- Pin package versions in `requirements.txt` or a Docker image.
- Save config files for every run.

## Suggested Repository Layout

```text
continual-replay/
  configs/
    split_mnist.yaml
    cartpole.yaml
  src/
    memory/
      consolidator.py
      uniform.py
      per.py
      sleep.py
    tasks/
      split_mnist.py
      cifar10_incremental.py
      cartpole.py
    models/
      cnn_small.py
      mlp_small.py
    train_sup.py
    train_rl.py
    analysis.py
  sweeps/
    wandb_sweep.yaml
  docker/
    Dockerfile
  README.md
```

## Commands

```bash
# Supervised continual learning
python -m src.train_sup --task split_mnist --mode none --seeds 5
python -m src.train_sup --task split_mnist --mode uniform --seeds 5
python -m src.train_sup --task split_mnist --mode per --seeds 5 --priority_alpha 0.6
python -m src.train_sup --task split_mnist --mode sleep --seeds 5 --sleep_freq 1000 --offline_epochs 5

# Reinforcement learning
python -m src.train_rl --env CartPole-v1 --mode none --seeds 5
python -m src.train_rl --env CartPole-v1 --mode uniform --seeds 5
python -m src.train_rl --env CartPole-v1 --mode per --seeds 5 --priority_alpha 0.6
python -m src.train_rl --env CartPole-v1 --mode sleep --seeds 5 --sleep_freq 1000 --offline_epochs 5
```

## Analysis Plan

1. Compute per-task forgetting: `max_performance(task) - final_performance(task)`.
2. Average forgetting across tasks and seeds.
3. Plot retained performance versus compute cost.
4. Plot final performance and forgetting with mean plus 95% confidence interval.
5. Compare representation checkpoints using CKA or CCA.
6. Identify the replay strategy on the retained-performance versus compute Pareto frontier.

## Expected Outputs

- `results/metrics.csv`: all scalar metrics by run, seed, and step.
- `results/forgetting_summary.csv`: final forgetting metrics by condition.
- `results/compute_summary.csv`: wall-time and FLOP estimates by condition.
- `plots/avg_accuracy.png` or `plots/avg_return.png`.
- `plots/forgetting_index.png`.
- `plots/retain_vs_compute.png`.
- `plots/cka_similarity.png`.

## Follow-Up Ablations

If the first pass succeeds, run these ablations:

- Buffer size: 5k, 10k, 50k, 100k.
- Replay ratio: 0.25x, 0.5x, 1x, 2x replay batches per online batch.
- Sleep trigger: fixed interval versus validation-drop trigger.
- PER priority signal: loss, gradient norm, TD error, mixed score.
- Synthetic replay: buffered-only versus generated samples.

## Publication-Quality Package

After the sprint:

1. Add a Dockerfile.
2. Pin seeds and package versions.
3. Add a single-command reproduction script.
4. Include raw metrics and plotting scripts.
5. Write a short methods note with the experiment grid, compute budget, and final Pareto analysis.
