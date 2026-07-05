import { env, getConfig, updateConfig } from "../config/index.js"
import { createLogger } from "../logger/index.js"
import { bus } from "../events/bus.js"
import type { ChatMessage, CompletionChunk, ModelInfo, ToolCallRequest } from "../types/index.js"

const log = createLogger("system")

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

export const AVAILABLE_MODELS: ModelInfo[] = [
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini", supportsTools: true },
  { id: "openai/gpt-4o", label: "GPT-4o", supportsTools: true },
  { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet", supportsTools: true },
  { id: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku", supportsTools: true },
  { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash", supportsTools: true },
  { id: "deepseek/deepseek-chat", label: "DeepSeek Chat", supportsTools: true },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", supportsTools: true },
  { id: "qwen/qwen-2.5-72b-instruct", label: "Qwen 2.5 72B", supportsTools: true },
  { id: "mistralai/mistral-small-24b-instruct-2501", label: "Mistral Small", supportsTools: true },
  { id: "mistralai/mixtral-8x7b-instruct", label: "Mixtral 8x7B", supportsTools: false },
]

export function getCurrentModel(): string {
  return getConfig().model
}

export function setCurrentModel(model: string): void {
  updateConfig({ model })
  bus.emitEvent("ModelChanged", { model })
  log.info(`Model switched to ${model}`)
}

/** Pick a model automatically based on task complexity heuristics. */
export function autoSelectModel(prompt: string): string {
  const cfg = getConfig()
  const complex =
    prompt.length > 800 ||
    /\b(refactor|architect|debug|analyze|design|implement|multi-step|plan)\b/i.test(prompt)
  if (complex) {
    return cfg.model
  }
  // Cheap/fast model for short conversational turns.
  return cfg.model
}

export interface CompletionOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  tools?: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }[]
  signal?: AbortSignal
  onChunk?: (chunk: CompletionChunk) => void
}

export interface CompletionResult {
  content: string
  toolCalls: ToolCallRequest[]
  finishReason: string
}

/**
 * Streaming chat completion against OpenRouter with SSE parsing and
 * automatic fallback model retry on failure.
 */
export async function complete(messages: ChatMessage[], opts: CompletionOptions = {}): Promise<CompletionResult> {
  const cfg = getConfig()
  const models = [opts.model ?? cfg.model, ...cfg.fallbackModels]
  let lastError: Error | null = null

  for (const model of models) {
    try {
      return await completeOnce(model, messages, opts)
    } catch (err) {
      lastError = err as Error
      log.warn(`Model ${model} failed: ${lastError.message}. Trying fallback.`)
    }
  }
  throw lastError ?? new Error("All models failed")
}

async function completeOnce(
  model: string,
  messages: ChatMessage[],
  opts: CompletionOptions,
): Promise<CompletionResult> {
  if (!env.openRouterKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to your .env file.")
  }
  const cfg = getConfig()

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? cfg.temperature,
    max_tokens: opts.maxTokens ?? cfg.maxTokens,
    stream: true,
  }
  if (opts.tools?.length) body.tools = opts.tools

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openRouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "nova-agent",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "")
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`)
  }

  let content = ""
  let finishReason = "stop"
  // Accumulate tool calls streamed as deltas keyed by index.
  const toolAcc = new Map<number, { id: string; name: string; args: string }>()

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data:")) continue
      const data = trimmed.slice(5).trim()
      if (data === "[DONE]") continue
      let parsed: any
      try {
        parsed = JSON.parse(data)
      } catch {
        continue
      }
      const choice = parsed.choices?.[0]
      if (!choice) continue
      if (choice.finish_reason) finishReason = choice.finish_reason
      const delta = choice.delta ?? {}
      if (delta.content) {
        content += delta.content
        opts.onChunk?.({ token: delta.content, done: false })
        bus.emitEvent("Token", { token: delta.content })
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          const acc = toolAcc.get(idx) ?? { id: "", name: "", args: "" }
          if (tc.id) acc.id = tc.id
          if (tc.function?.name) acc.name += tc.function.name
          if (tc.function?.arguments) acc.args += tc.function.arguments
          toolAcc.set(idx, acc)
        }
      }
    }
  }

  const toolCalls: ToolCallRequest[] = [...toolAcc.values()]
    .filter((t) => t.name)
    .map((t, i) => ({
      id: t.id || `call_${Date.now()}_${i}`,
      type: "function" as const,
      function: { name: t.name, arguments: t.args || "{}" },
    }))

  opts.onChunk?.({ done: true, finishReason, toolCalls })
  return { content, toolCalls, finishReason }
}
