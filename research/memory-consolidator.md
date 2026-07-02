# Memory Consolidator: Sleep + Replay for Stable Agent Learning

## Purpose

This note captures a compact memory-consolidation module for agents and continual-learning classifiers. The goal is to let an agent learn online without bloating the active context window, then periodically consolidate important memories during offline "sleep" passes.

The core idea is simple:

1. Store recent experiences in an online buffer.
2. Sample important or forgotten items with priority replay.
3. Run offline sleep passes that retrain on replay batches.
4. Optionally synthesize rare cases with generative replay.
5. Persist model snapshots after consolidation.

This gives the system a practical working-memory-to-durable-knowledge loop.

## Architecture

```text
┌────────────────────┐
│ Agent interaction  │
│ obs/action/reward  │
└─────────┬──────────┘
          │ store(exp)
          ▼
┌────────────────────┐
│ Online buffer       │
│ recent experience   │
└─────────┬──────────┘
          │ priority sample
          ▼
┌────────────────────┐
│ Replay sampler      │
│ PER + IS weights    │
└─────────┬──────────┘
          │ sleep_pass()
          ▼
┌────────────────────┐
│ Trainer             │
│ model update        │
└─────────┬──────────┘
          │ update priorities
          ▼
┌────────────────────┐
│ Consolidated model  │
│ snapshot/checkpoint │
└────────────────────┘
```

## API

```python
from dataclasses import dataclass, field
import random, math
from typing import Any, Dict, List, Literal, Optional, Tuple

Mode = Literal["online", "offline"]

@dataclass
class Experience:
    x: Any
    y: Any
    meta: Dict[str, Any] = field(default_factory=dict)

class MemoryConsolidator:
    def __init__(
        self,
        buffer_size: int = 200_000,
        mode: str = "hybrid",
        priority_alpha: float = 0.6,
        importance_beta_start: float = 0.4,
        importance_beta_end: float = 1.0,
        synaptic_decay: float = 1e-5,
        replay_batch: int = 256,
    ):
        self.buffer_size = buffer_size
        self.mode = mode
        self.alpha = priority_alpha
        self.beta_start = importance_beta_start
        self.beta_end = importance_beta_end
        self.decay = synaptic_decay
        self.replay_batch = replay_batch

        self._buf: List[Experience] = []
        self._prio: List[float] = []
        self._age: List[int] = []
        self._t = 0

    def store(self, exp: Experience):
        pr = abs(exp.meta.get("td_error", exp.meta.get("loss", 1.0))) + 1e-6
        if len(self._buf) >= self.buffer_size:
            idx = self._prio.index(min(self._prio))
            self._buf[idx], self._prio[idx], self._age[idx] = exp, pr, 0
        else:
            self._buf.append(exp)
            self._prio.append(pr)
            self._age.append(0)

    def sample(self, batch_size: int, mode: Mode = "online") -> Tuple[List[Experience], List[float], List[int]]:
        if not self._buf:
            return [], [], []

        weights = [p ** self.alpha for p in self._prio]
        total = sum(weights)
        probs = [w / total for w in weights]
        idxs = random.choices(range(len(self._buf)), probs, k=min(batch_size, len(self._buf)))

        beta = self._anneal_beta()
        is_weights = [(len(self._buf) * probs[i]) ** (-beta) for i in idxs]
        max_w = max(is_weights) or 1.0
        is_weights = [w / max_w for w in is_weights]

        return [self._buf[i] for i in idxs], is_weights, idxs

    def sleep_pass(self, epochs: int = 5, trainer=None, generative_replay=None):
        """
        trainer(xs, ys, is_weights) -> list[float]
        generative_replay(n) -> list[Experience]
        """
        for _ in range(epochs):
            if generative_replay:
                for exp in generative_replay(self.replay_batch // 4):
                    self.store(exp)

            batch, is_w, idxs = self.sample(self.replay_batch, mode="offline")
            if not batch or trainer is None:
                continue

            xs = [e.x for e in batch]
            ys = [e.y for e in batch]
            td_errors = trainer(xs, ys, is_w)

            for j, buf_i in enumerate(idxs):
                self._prio[buf_i] = abs(td_errors[j]) + 1e-6
                self._age[buf_i] += 1
                self._prio[buf_i] *= math.exp(-self.decay * self._age[buf_i])

        self._t += 1

    def consolidate(self, snapshot_id: Optional[str] = None, saver=None):
        if saver:
            saver(snapshot_id)

    def _anneal_beta(self) -> float:
        t = min(1.0, self._t / 10_000)
        return self.beta_start + (self.beta_end - self.beta_start) * t
```

## Agent wiring

```python
mem = MemoryConsolidator()

def on_step(obs, action, reward, next_obs, td_error):
    mem.store(
        Experience(
            x=(obs, action),
            y=(reward, next_obs),
            meta={"td_error": td_error},
        )
    )

# Run periodically, for example every 1k steps and at episode end.
mem.sleep_pass(epochs=5, trainer=train_step, generative_replay=sample_synthetic)
mem.consolidate(snapshot_id="nightly", saver=save_model)
```

## Recommended defaults

| Parameter | Default | Notes |
|---|---:|---|
| `buffer_size` | `200_000` | Enough to preserve recent diversity without unbounded growth. |
| `replay_batch` | `256` | Good starting point for offline consolidation. |
| `priority_alpha` | `0.6` | Balances priority replay against diversity. |
| `importance_beta_start` | `0.4` | Starts with partial correction. |
| `importance_beta_end` | `1.0` | Anneals toward full importance-sampling correction. |
| `synaptic_decay` | `1e-5` | Gradually reduces stale replay dominance. |
| Sleep frequency | every `1k` steps + episode end | Keeps online learning stable. |
| Offline epochs | `5` | Enough consolidation without too much wall-clock cost. |

## Design notes

### Online buffer

The buffer stores compact experiences, not full conversational context. For an RL-style agent, `x` can hold `(obs, action)` and `y` can hold `(reward, next_obs)`. For a classifier, `x` can hold the input and `y` can hold the label or target.

### Priority replay

Priority is initialized from `td_error` or `loss`. High-priority items are sampled more often, but importance-sampling weights reduce bias. This helps the system revisit surprising, forgotten, or high-loss experiences without completely abandoning coverage of ordinary cases.

### Sleep pass

Sleep is an offline maintenance loop. It samples replay batches, trains the model, updates item priorities from new errors, and optionally mixes in synthetic examples. The system should schedule sleep outside the latency-critical path.

### Generative replay

Generative replay is optional. It is useful when rare or long-tail cases are important but underrepresented in the buffer. The generator can be a VAE, diffusion model, GAN, simulator, or rule-based synthesizer. Treat generated examples as low-trust unless validated.

### Consolidation snapshots

After sleep, persist a model and optimizer snapshot. This makes consolidation auditable and gives the agent a rollback point if synthetic replay or over-prioritized outliers damage behavior.

## Trade-offs

Bigger buffers and more sleep epochs improve retention but increase memory, storage, and wall-clock cost. A high `priority_alpha` can overfit spikes or noisy failures. A low `priority_alpha` approaches uniform replay and may forget rare but important items. Generative replay improves coverage but can introduce generator bias or synthetic artifacts.

## Fit with the Singularity System

In the Singularity System, this module should act as the maintenance layer between active working memory and durable model knowledge. Online interaction writes to the buffer. Sleep replay distills experience into the model. Consolidation snapshots promote stable behavior into persistent checkpoints.

A useful operating model is:

```text
working memory → replay buffer → sleep pass → consolidated model → snapshot
```

This gives the system a rhythm: act, remember, sleep, consolidate, resume.

## Next implementation tasks

- Add a TypeScript/Bun version of the same API for agent-runtime use.
- Add persistent buffer storage, likely SQLite or DuckDB for local agents.
- Add metrics: replay entropy, priority distribution, forgetting rate, rare-case recall.
- Add a scheduler that triggers sleep every `N` steps, at episode end, and during idle windows.
- Add snapshot metadata: dataset hash, replay seed, trainer version, and model checkpoint ID.
