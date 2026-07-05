import { complete } from "../models/openrouter.js"
import { bus } from "../events/bus.js"
import { createLogger } from "../logger/index.js"
import type { PlanStep, TaskPlan } from "../types/index.js"

const log = createLogger("planner")

let activePlan: TaskPlan | null = null

export function getActivePlan(): TaskPlan | null {
  return activePlan
}

export function clearPlan(): void {
  activePlan = null
  bus.emitEvent("PlanUpdated", { plan: null })
}

/**
 * Decide whether a request needs a multi-step plan at all.
 * Simple conversational turns skip planning to stay fast and cheap.
 */
export function needsPlan(prompt: string): boolean {
  if (prompt.length < 25) return false
  const actionVerbs =
    /\b(create|build|write|fix|refactor|install|deploy|analyze|generate|convert|download|scrape|automate|setup|set up|organize|find and|search and|then|after that|step)\b/i
  return actionVerbs.test(prompt)
}

/**
 * Ask the model to break a goal into 2-7 concrete subtasks.
 * Returns a TaskPlan tracked as the active plan.
 */
export async function createPlan(goal: string): Promise<TaskPlan> {
  const result = await complete(
    [
      {
        role: "system",
        content:
          "You are a task planner. Break the user's goal into 2-7 short, concrete, executable steps. " +
          'Respond ONLY with JSON: {"steps": ["step 1", "step 2", ...]}. No prose.',
      },
      { role: "user", content: goal },
    ],
    { maxTokens: 400, temperature: 0.2 },
  )

  let titles: string[] = []
  try {
    const match = result.content.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      if (Array.isArray(parsed.steps)) titles = parsed.steps.map(String).slice(0, 7)
    }
  } catch {
    /* fall through */
  }
  if (titles.length === 0) titles = [goal]

  const steps: PlanStep[] = titles.map((title, i) => ({
    id: i + 1,
    title,
    status: i === 0 ? "running" : "pending",
  }))

  activePlan = { goal, steps, createdAt: Date.now(), currentStep: 0 }
  bus.emitEvent("PlanCreated", { plan: activePlan })
  log.info(`Plan created for "${goal.slice(0, 80)}" with ${steps.length} steps`)
  return activePlan
}

export function advancePlan(note?: string): void {
  if (!activePlan) return
  const cur = activePlan.steps[activePlan.currentStep]
  if (cur) {
    cur.status = "done"
    if (note) cur.note = note.slice(0, 200)
  }
  activePlan.currentStep++
  const next = activePlan.steps[activePlan.currentStep]
  if (next) next.status = "running"
  bus.emitEvent("PlanUpdated", { plan: activePlan })
}

export function failCurrentStep(error: string): void {
  if (!activePlan) return
  const cur = activePlan.steps[activePlan.currentStep]
  if (cur) {
    cur.status = "failed"
    cur.note = error.slice(0, 200)
  }
  bus.emitEvent("PlanUpdated", { plan: activePlan })
}

export function planProgress(): { done: number; total: number; percent: number } {
  if (!activePlan) return { done: 0, total: 0, percent: 0 }
  const done = activePlan.steps.filter((s) => s.status === "done").length
  const total = activePlan.steps.length
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 }
}
