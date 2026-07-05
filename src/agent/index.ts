import { complete } from "../models/openrouter.js"
import { executeTool, toolsForModel } from "../tools/index.js"
import { addMessage, getHistoryAsChatMessages, listMemory, summarizeIfNeeded } from "../memory/index.js"
import { advancePlan, clearPlan, createPlan, failCurrentStep, getActivePlan, needsPlan } from "../planner/index.js"
import { getSkillInstructionsFor } from "../skills/index.js"
import { bus } from "../events/bus.js"
import { WORKSPACE_DIR, getConfig } from "../config/index.js"
import { createLogger } from "../logger/index.js"
import type { AgentPhase, AgentRunOptions, AgentRunResult, ChatMessage } from "../types/index.js"

const log = createLogger("conversation")

let phase: AgentPhase = "idle"
let currentAbort: AbortController | null = null

export function getAgentPhase(): AgentPhase {
  return phase
}

function setPhase(next: AgentPhase): void {
  phase = next
  bus.emitEvent("StatusChanged", { phase: next })
}

export function stopAgent(): void {
  currentAbort?.abort()
  setPhase("idle")
}

function buildSystemPrompt(userInput: string): string {
  const memories = listMemory(10)
  const memoryBlock =
    memories.length > 0
      ? `\n\nLong-term memory (relevant facts you previously saved):\n${memories
          .map((m) => `- ${m.key}: ${m.value.slice(0, 150)}`)
          .join("\n")}`
      : ""

  const skillBlock = getSkillInstructionsFor(userInput)

  return (
    "You are Nova, an autonomous AI agent running on the user's Ubuntu Linux laptop. " +
    "You do not merely answer questions - you complete tasks using your tools. " +
    "Think step by step. When a task requires action (opening apps or websites, playing music, running commands, " +
    "reading or writing files, browsing the web, remembering things), call the appropriate tool instead of describing what the user should do. " +
    "After using tools, observe results, retry with a different approach on failure, and continue until the task is done. " +
    "Never stop after a single failure: read the error, adapt, and try again (max 3 attempts per approach). " +
    "Keep final answers concise. Save important user preferences and facts with memory_save." +
    memoryBlock +
    skillBlock
  )
}

/**
 * The autonomous agent loop:
 *   Think -> Plan (if needed) -> Act (tool calls) -> Observe -> Reflect -> Continue/Finish
 */
export async function runAgent(userInput: string, opts: AgentRunOptions): Promise<AgentRunResult> {
  const start = Date.now()
  const cfg = getConfig()
  const maxIterations = opts.maxIterations ?? cfg.maxIterations
  const confirm = opts.confirm ?? (async () => !cfg.security.confirmDangerous)

  currentAbort = new AbortController()
  bus.emitEvent("TaskStarted", { input: userInput.slice(0, 200), sessionId: opts.sessionId })
  log.info(`[${opts.sessionId}] user: ${userInput.slice(0, 300)}`)

  addMessage(opts.sessionId, "user", userInput)

  // Plan for multi-step tasks.
  setPhase("planning")
  clearPlan()
  if (needsPlan(userInput)) {
    try {
      await createPlan(userInput)
    } catch (err) {
      log.warn(`Planning failed, continuing without plan: ${(err as Error).message}`)
    }
  }

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(userInput) },
    ...getHistoryAsChatMessages(opts.sessionId, 24),
  ]

  const plan = getActivePlan()
  if (plan && plan.steps.length > 1) {
    messages.push({
      role: "system",
      content: `Current plan:\n${plan.steps.map((s) => `${s.id}. ${s.title}`).join("\n")}\nWork through these steps.`,
    })
  }

  let iterations = 0
  let toolCallCount = 0
  let finalAnswer = ""
  let consecutiveFailures = 0

  while (iterations < maxIterations) {
    iterations++
    setPhase("thinking")

    const result = await complete(messages, {
      tools: toolsForModel(),
      signal: currentAbort.signal,
      onChunk: (chunk) => {
        if (chunk.token) opts.onToken?.(chunk.token)
      },
    })

    if (result.toolCalls.length === 0) {
      // Model produced a final answer.
      finalAnswer = result.content.trim()
      break
    }

    // Record assistant turn with tool calls.
    messages.push({ role: "assistant", content: result.content, tool_calls: result.toolCalls })

    setPhase("acting")
    for (const call of result.toolCalls) {
      toolCallCount++
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(call.function.arguments)
      } catch {
        /* empty args */
      }

      const toolResult = await executeTool(call.function.name, args, {
        workspaceDir: WORKSPACE_DIR,
        sessionId: opts.sessionId,
        emit: (event, payload) => bus.emit(event, payload),
        confirm,
      })

      setPhase("observing")
      if (toolResult.ok) {
        consecutiveFailures = 0
        advancePlan(`${call.function.name} ok`)
      } else {
        consecutiveFailures++
        failCurrentStep(toolResult.error ?? "unknown error")
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult).slice(0, 8000),
      })
    }

    // Reflection: if tools keep failing, tell the model to change strategy.
    if (consecutiveFailures >= 3) {
      setPhase("reflecting")
      messages.push({
        role: "system",
        content:
          "Multiple consecutive tool failures. Stop retrying the same approach. Either use a different tool/strategy or explain the blocker to the user and finish.",
      })
      consecutiveFailures = 0
    }
  }

  if (!finalAnswer) {
    finalAnswer = "I reached my iteration limit before fully completing the task. Here is where I got to - ask me to continue if needed."
  }

  addMessage(opts.sessionId, "assistant", finalAnswer)
  log.info(`[${opts.sessionId}] assistant: ${finalAnswer.slice(0, 300)}`)

  // Background summarization to keep history small.
  void summarizeIfNeeded(opts.sessionId, async (text) => {
    const r = await complete(
      [
        { role: "system", content: "Summarize this conversation chunk in 3-5 bullet points. Keep facts, names, decisions." },
        { role: "user", content: text },
      ],
      { maxTokens: 250 },
    )
    return r.content
  })

  setPhase("finished")
  bus.emitEvent("TaskCompleted", { sessionId: opts.sessionId, iterations, toolCalls: toolCallCount })
  setPhase("idle")
  currentAbort = null

  return {
    answer: finalAnswer,
    plan: getActivePlan() ?? undefined,
    iterations,
    toolCalls: toolCallCount,
    durationMs: Date.now() - start,
  }
}
