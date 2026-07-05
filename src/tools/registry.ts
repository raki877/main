import { bus } from "../events/bus.js"
import { createLogger } from "../logger/index.js"
import type { ToolContext, ToolDefinition, ToolResult } from "../types/index.js"

const log = createLogger("tools")

const tools = new Map<string, ToolDefinition>()

export function registerTool(tool: ToolDefinition): void {
  if (tools.has(tool.name)) {
    log.warn(`Tool ${tool.name} re-registered (overwriting)`)
  }
  tools.set(tool.name, tool)
}

export function unregisterTool(name: string): void {
  tools.delete(name)
}

export function getTool(name: string): ToolDefinition | undefined {
  return tools.get(name)
}

export function listTools(): ToolDefinition[] {
  return [...tools.values()]
}

export function toolCount(): number {
  return tools.size
}

/** OpenAI function-calling format for the model. */
export function toolsForModel() {
  return listTools().map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

/**
 * Execute a tool with timing, structured JSON result, event emission,
 * and confirmation for dangerous tools.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = tools.get(name)
  const start = Date.now()

  if (!tool) {
    return { ok: false, output: null, error: `Unknown tool: ${name}`, durationMs: 0 }
  }

  if (tool.dangerous) {
    const approved = await ctx.confirm(`Tool "${name}" wants to run with args: ${JSON.stringify(args).slice(0, 200)}. Allow?`)
    if (!approved) {
      return { ok: false, output: null, error: "User denied execution", durationMs: Date.now() - start }
    }
  }

  bus.emitEvent("ToolStarted", { name, args })
  log.info(`ToolStarted ${name} ${JSON.stringify(args).slice(0, 300)}`)

  try {
    const output = await tool.execute(args, ctx)
    const result: ToolResult = { ok: true, output, durationMs: Date.now() - start }
    bus.emitEvent("ToolCompleted", { name, ok: true, durationMs: result.durationMs })
    log.info(`ToolCompleted ${name} in ${result.durationMs}ms`)
    return result
  } catch (err) {
    const error = (err as Error).message
    const result: ToolResult = { ok: false, output: null, error, durationMs: Date.now() - start }
    bus.emitEvent("ToolCompleted", { name, ok: false, error, durationMs: result.durationMs })
    log.error(`ToolFailed ${name}: ${error}`)
    return result
  }
}
