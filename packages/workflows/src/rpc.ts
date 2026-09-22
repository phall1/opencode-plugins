import { Rpc } from "@opencode/plugin/rpc"
import { Schema } from "effect"

const Node = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  status: Schema.String,
  startedAt: Schema.optionalKey(Schema.Number),
  finishedAt: Schema.optionalKey(Schema.Number),
  sessionID: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  choices: Schema.optionalKey(Schema.Array(Schema.String)),
})

const Edge = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  label: Schema.optionalKey(Schema.String),
})

export const Run = Schema.Struct({
  id: Schema.String,
  workflow: Schema.String,
  status: Schema.Literals(["running", "waiting", "done", "failed", "cancelled"]),
  cursor: Schema.String,
  startedAt: Schema.Number,
  input: Schema.Unknown,
  outputs: Schema.Record(Schema.String, Schema.Unknown),
  error: Schema.optionalKey(Schema.String),
  nodes: Schema.Array(Node),
  edges: Schema.Array(Edge),
})

const WorkflowSummary = Schema.Struct({
  name: Schema.String,
  startAt: Schema.String,
  nodes: Schema.Array(Schema.String),
})

const RunId = Schema.Struct({
  runId: Schema.optionalKey(Schema.String),
})

const MaybeRun = Schema.Struct({
  run: Schema.optionalKey(Run),
})

export const Workflows = Rpc.define({
  id: "phall.workflows",
  methods: {
    list: {
      input: Schema.Struct({}),
      output: Schema.Struct({ workflows: Schema.Array(WorkflowSummary) }),
    },
    start: {
      input: Schema.Struct({
        name: Schema.String,
        task: Schema.optionalKey(Schema.String),
        sessionID: Schema.optionalKey(Schema.String),
        input: Schema.optionalKey(Schema.Unknown),
      }),
      output: Schema.Struct({ run: Run }),
      errors: {
        not_found: Schema.Struct({ name: Schema.String }),
        busy: Schema.Struct({ runId: Schema.String }),
      },
    },
    status: {
      input: RunId,
      output: MaybeRun,
    },
    cancel: {
      input: RunId,
      output: MaybeRun,
    },
    answer: {
      input: Schema.Struct({
        value: Schema.Unknown,
        runId: Schema.optionalKey(Schema.String),
      }),
      output: Schema.Struct({ run: Run }),
      errors: {
        not_waiting: Schema.Struct({ runId: Schema.String }),
      },
    },
  },
  events: {
    updated: {
      schema: Schema.Struct({ run: Run }),
    },
  },
})
