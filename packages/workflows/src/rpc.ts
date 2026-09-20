import { Rpc } from "@opencode/plugin/rpc"
import { Schema } from "effect"

const Node = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  status: Schema.String,
})

export const Run = Schema.Struct({
  id: Schema.String,
  workflow: Schema.String,
  status: Schema.Literals(["running", "waiting", "done", "failed", "cancelled"]),
  cursor: Schema.String,
  input: Schema.Unknown,
  outputs: Schema.Record(Schema.String, Schema.Unknown),
  error: Schema.optional(Schema.String),
  nodes: Schema.Array(Node),
})

const WorkflowSummary = Schema.Struct({
  name: Schema.String,
  startAt: Schema.String,
  nodes: Schema.Array(Schema.String),
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
        task: Schema.optional(Schema.String),
        sessionID: Schema.optional(Schema.String),
        input: Schema.optional(Schema.Unknown),
      }),
      output: Schema.Struct({ run: Run }),
      errors: {
        not_found: Schema.Struct({ name: Schema.String }),
        busy: Schema.Struct({ runId: Schema.String }),
      },
    },
    status: {
      input: Schema.Struct({ runId: Schema.optional(Schema.String) }),
      output: Schema.Struct({ run: Schema.optional(Run) }),
    },
    cancel: {
      input: Schema.Struct({ runId: Schema.optional(Schema.String) }),
      output: Schema.Struct({ run: Schema.optional(Run) }),
    },
    answer: {
      input: Schema.Struct({
        value: Schema.Unknown,
        runId: Schema.optional(Schema.String),
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
