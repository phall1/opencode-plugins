# Router acceptance evidence

Local evaluation on 2026-10-13 with OpenCode 2.0.27, `jev-latest`, and the
actual registered 74-tool catalog. The test requests are synthetic and checked
into `scripts/cases.ts`; no user transcripts or credentials are retained here.

## Classifier iteration

| Revision | Cases passed | Median | p95 |
| --- | ---: | ---: | ---: |
| Choice + independent relevance gate | 20/24 | 173 ms | 214 ms |
| Choice with explicit `none` | 24/24 | 160 ms | 233 ms |
| Higher alternative probability threshold (0.2) | 24/24 | 169 ms | 225 ms |

The independent relevance question lacked the Choice's catalog evidence and
suppressed valid terminal-close, model-list, worktree and workflow requests.
Using `none` within the same Choice removes that inconsistent gate. Increasing
the alternative threshold avoids offering `phux_spawn` for an existing
debugger's Enter request.

The last 24-case run consumed 93,928 Jev input tokens and 17,921 output tokens
in total. This intentionally evaluates the larger unfiltered registered catalog;
the plugin limits classification to inventories advertised by the current
request. Global routing is metered and is not claimed to reduce total tokens or
cost on every turn. This is a development smoke set, not a held-out benchmark.

## Main-model Code Mode probe

Same main model: `openai/gpt-6.1-sol`. The fixture is a harmless echo tool whose
schema is hidden from the native inline catalog. The probe compares normal
search discovery against Jev schema preloading, then checks real executor
activity and the returned marker—not merely code mentioning the function.

| Mode | Model steps | Execute calls | Search calls | Successful echo |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 3 | 2 | 1 | 1 |
| Router | 2 | 1 | 0 | 1 |

This result repeated across separate disposable sessions. Wall-clock duration
varied substantially between model runs; one fewer discovery/model round trip
is demonstrated, a universal end-to-end speedup is not.

## Safety and packaging

- Native permission denial is checked by the runtime probe.
- Unsupported-schema/count collisions and catalog-removal/delta notices have
  regressions; ambiguous request inventories preserve native discovery.
- Source tests cover exact paths/brackets, schema conversion, no-match,
  already-shown selections, cache invalidation, concurrency, deadlines, unload,
  malformed answers, cooldown/recovery, media filtering and credential rotation.
- Packed artifact loads outside the checkout without runtime SDK resolution.
- Workspace typechecks, builds and tests pass, including existing workflows.
- Fresh-context review findings were fixed and covered by regression tests.

## Complexity

Measured with Lizard. New production functions stay at CCN 8 or below.

| Function | Before | After |
| --- | ---: | ---: |
| Context-hook callback | 10 | 7 |

Extracted: `createCounters`, `recordRoute`. Behavior verified by plugin-hook,
runtime, packaging and workspace checks.
