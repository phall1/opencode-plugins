import type { MarkdownOptions } from "@opentui/core"

const MERMAN = "../../../../opencode/packages/merman/src/markdown.ts"
const PALETTE = "../../../../opencode/packages/merman/src/palette.ts"

type ThemeMode = "dark" | "light"

export async function loadWorkflowDiagram(
  ctx: unknown,
  options: () => { theme: unknown; mode: ThemeMode; width: number },
): Promise<MarkdownOptions["renderNode"] | undefined> {
  try {
    const [markdown, palette] = await Promise.all([import(MERMAN), import(PALETTE)])
    return markdown.createMermaidMarkdownRenderer(ctx, () => diagramOptions(palette, options()))
  } catch {
    return undefined
  }
}

function diagramOptions(
  palette: { resolveOpenCodeDiagramPalette: (theme: unknown, mode: ThemeMode) => unknown },
  options: { theme: unknown; mode: ThemeMode; width: number },
) {
  return {
    compact: true,
    layoutMaxWidth: Math.max(24, options.width),
    colors: palette.resolveOpenCodeDiagramPalette(options.theme, options.mode),
  }
}
