// Only loaded in the disposable runtime evaluation project.
export default {
  id: "phall.router.fixture",
  async setup(ctx) {
    let calls = 0;
    await ctx.rpc.register({ id: "phall.router.fixture", methods: { status: { input: { type: "object" }, output: { type: "object" } } }, events: {} }, {
      status: async () => ({ calls }),
    });
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "echo",
        description: "Echo the supplied marker for the router's harmless runtime integration test. No terminal or filesystem side effects.",
        input: { type: "object", properties: { marker: { type: "string", enum: ["ROUTER_SMOKE"] } }, required: ["marker"], additionalProperties: false },
        options: { namespace: "router_fixture", codemode: true, permission: "router_fixture" },
        execute: async ({ marker }) => {
          calls++;
          return { content: `fixture echo: ${marker}` };
        },
      })
    })
    // Ensure native inline discovery leaves this fixture hidden so the probe
    // actually measures automatic pre-discovery rather than a pre-shown schema.
    await ctx.session.hook("context", (event) => {
      const hide = (text) => text.replace(/^\s+- tools\.router_fixture\.echo\([\s\S]*?(?=^\S|^\s+- tools\.|$(?![\s\S]))/gm, "")
      event.system = event.system.map((part) => ({ ...part, text: hide(part.text) }))
      event.messages = event.messages.map((message) => message.role !== "system" ? message : ({ ...message, content: message.content.map((part) => part.type !== "text" ? part : ({ ...part, text: hide(part.text) })) }))
    })
  },
}
