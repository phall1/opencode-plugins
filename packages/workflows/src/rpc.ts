import { Rpc } from "@opencode/plugin/rpc"
import { z } from "zod"

const Run = z.object({
  id: z.string(),
  workflow: z.string(),
  status: z.enum(["running", "waiting", "done", "failed", "cancelled"]),
  cursor: z.string(),
  input: z.unknown(),
  outputs: z.record(z.string(), z.unknown()),
  error: z.string().optional(),
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      status: z.string(),
    }),
  ),
})

const WorkflowSummary = z.object({
  name: z.string(),
  startAt: z.string(),
  nodes: z.array(z.string()),
})

export const Workflows = Rpc.define({
  id: "phall.workflows",
  methods: {
    list: {
      input: z.object({}),
      output: z.object({ workflows: z.array(WorkflowSummary) }),
    },
    start: {
      input: z.object({
        name: z.string(),
        task: z.string().optional(),
        sessionID: z.string().optional(),
      }),
      output: z.object({ run: Run }),
      errors: {
        not_found: z.object({ name: z.string() }),
        busy: z.object({ runId: z.string() }),
      },
    },
    status: {
      input: z.object({ runId: z.string().optional() }),
      output: z.object({ run: Run.optional() }),
    },
    cancel: {
      input: z.object({ runId: z.string().optional() }),
      output: z.object({ run: Run.optional() }),
    },
    answer: {
      input: z.object({
        value: z.unknown(),
        runId: z.string().optional(),
      }),
      output: z.object({ run: Run }),
      errors: {
        not_waiting: z.object({ runId: z.string() }),
      },
    },
  },
  events: {
    updated: {
      schema: z.object({ run: Run }),
    },
  },
})
