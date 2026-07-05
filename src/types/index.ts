/**
 * Shared type definitions for the entire agent.
 */

// ---------- Chat / model ----------

export type Role = "system" | "user" | "assistant" | "tool"

export interface ChatMessage {
  role: Role
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCallRequest[]
}

export interface ToolCallRequest {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export interface ModelInfo {
  id: string
  label: string
  contextWindow?: number
  supportsTools: boolean
}

export interface CompletionChunk {
  token?: string
  toolCalls?: ToolCallRequest[]
  done: boolean
  finishReason?: string
}

// ---------- Tools ----------

export interface ToolResult {
  ok: boolean
  output: unknown
  error?: string
  durationMs: number
}

export interface ToolDefinition {
  name: string
  description: string
  category: string
  /** JSON-schema for parameters (OpenAI function-calling format). */
  parameters: Record<string, unknown>
  /** If true the agent asks the user before executing. */
  dangerous?: boolean
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
}

export interface ToolContext {
  workspaceDir: string
  sessionId: string
  emit: (event: string, payload: unknown) => void
  confirm: (message: string) => Promise<boolean>
}

// ---------- Planner ----------

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped"

export interface PlanStep {
  id: number
  title: string
  status: StepStatus
  note?: string
}

export interface TaskPlan {
  goal: string
  steps: PlanStep[]
  createdAt: number
  currentStep: number
}

// ---------- Agent ----------

export type AgentPhase =
  | "idle"
  | "thinking"
  | "planning"
  | "acting"
  | "observing"
  | "reflecting"
  | "finished"
  | "error"

export interface AgentRunOptions {
  sessionId: string
  maxIterations?: number
  onToken?: (token: string) => void
  confirm?: (message: string) => Promise<boolean>
}

export interface AgentRunResult {
  answer: string
  plan?: TaskPlan
  iterations: number
  toolCalls: number
  durationMs: number
}

// ---------- Memory ----------

export interface StoredMessage {
  id: number
  sessionId: string
  role: Role
  content: string
  createdAt: number
}

export interface MemoryEntry {
  id: number
  key: string
  value: string
  kind: "fact" | "summary" | "task" | "preference"
  createdAt: number
  updatedAt: number
}

// ---------- Skills / plugins ----------

export interface SkillManifest {
  name: string
  version: string
  description: string
  category?: string
  priority?: number
  keywords?: string[]
  permissions?: string[]
  variables?: Record<string, string>
  enabled?: boolean
}

export interface LoadedSkill {
  manifest: SkillManifest
  dir: string
  instructions: string
}

export interface PluginManifest {
  name: string
  version: string
  description: string
  main: string
  permissions?: string[]
  enabled?: boolean
}

export interface PluginApi {
  registerTool: (tool: ToolDefinition) => void
  on: (event: string, handler: (payload: unknown) => void) => void
  log: (msg: string) => void
  config: Record<string, unknown>
}

export interface LoadedPlugin {
  manifest: PluginManifest
  dir: string
}

// ---------- Events ----------

export type AgentEvent =
  | "AgentStarted"
  | "AgentStopped"
  | "TaskStarted"
  | "TaskCompleted"
  | "TaskFailed"
  | "PlanCreated"
  | "PlanUpdated"
  | "ToolStarted"
  | "ToolCompleted"
  | "MemoryUpdated"
  | "PluginLoaded"
  | "SkillLoaded"
  | "Token"
  | "Log"
  | "StatusChanged"
  | "ModelChanged"

// ---------- Status ----------

export interface SystemStatus {
  uptimeSec: number
  model: string
  phase: AgentPhase
  memoryUsageMb: number
  cpuPercent: number
  toolCount: number
  skillCount: number
  pluginCount: number
  telegramConnected: boolean
  sessions: number
}
