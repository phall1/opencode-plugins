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
- if Jev is unavailable, the `generate.text` fallback is uncalibrated and a
  gated decision always routes to `uncertain` rather than claiming confidence 1

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
  `source: "generate"` reports confidence 1 as a parser placeholder but never
  passes a `minConfidence` gate. The panel labels it uncalibrated.
- Copy Dispatch's full router. Workflows need Choice at edges, not a second
  product.

## Invocation and failure contracts

Workflows are opt-in: ordinary tasks use OpenCode's regular tools and subagents.
An agent node is a child session (except explicitly marked `origin` steps). The
host requests a JSON object via `workflow submit` and rejects malformed
fallback text instead of handing `{ text }` to subsequent nodes. A workflow
can add a per-node `validate` predicate for its output shape. Decision source,
confidence, prompts, outputs, and nested include progress are kept in run
snapshots for inspection. Graph definitions are checked for invalid edges and
missing routes at discovery; unexpected exits and unmatched runtime routes
fail the run. Runs are still in-memory: restarting the server does not resume
an interrupted run.
