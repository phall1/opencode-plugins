# Architecture

The graph is code. Models only answer questions the graph already knows how to
route. That is the TypeSafe/Jev fit: **AI-powered software**, not another agent
loop inside the runner.

## Layers

| Layer | Owns | Does not own |
| --- | --- | --- |
| DSL | nodes, edges, named exits | OpenCode, Jev, TUI |
| Engine | stepping, `maxSteps`, includes | HTTP, sessions |
| Host | sessions, Jev, `generate.text`, checkpoints | graph shape |
| Plugin | discovery, RPC, tools, skills | node semantics |
| TUI | picker, panel, toasts | execution |

A run is an Effect. Checkpoints are `Deferred`s. Cancel interrupts the fiber.

## Two kinds of model

**System Two (OpenCode sessions)** — `agent` nodes. Tools, language, patches,
PRs. Slow, expensive, supervised.

**System One (Jev)** — `decision` nodes. Choice / Noul / Score over structured
state. ~100ms, typed, calibrated confidence.

Do not ask an agent to pick `wait | act | stop` and parse JSON. That is Jev
Choice. Do not ask Jev to edit a file. That is an agent.

```
observe (agent) → route (Jev Choice) → act (agent) | wait | stop
                      ↓ low confidence
                 uncertain → checkpoint (human)
```

## Confidence policy

Jev's `confidence` is distribution concentration, not permission to act. Code
owns the threshold:

- `minConfidence` on a `decision` node
- below threshold → synthetic choice `uncertain`
- graph routes `from: "route.uncertain"` to a human checkpoint or a safer lane

Unused branches' uncertainty is ignored.

## Fan-out (later)

One Jev request can ask many independent questions over the same observe-state
(Noul: is the goal complete? Choice: next action? Score: how blocked?). The
engine still steps one node; the host may batch. Do not add a question-per-node
type until two workflows need it.

## What not to do

- Put TypeSafe calls in `.workflow.ts` files. Workflows stay host-agnostic.
- Use Jev to generate the next graph. The graph is source.
- Treat `generate.text` fallback as equivalent. It has no calibrated confidence;
  `source: "generate"` always reports confidence 1 and must not drive gates.
- Copy Dispatch's full router. Workflows need Choice at edges, not a second
  product.
