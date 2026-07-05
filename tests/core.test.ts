import { describe, it, expect, beforeAll } from "vitest"
import { registerTool, executeTool, listTools, toolsForModel } from "../src/tools/registry.js"
import { remember, recall, searchMemory, forget, addMessage, getHistory, clearHistory } from "../src/memory/index.js"
import { addJob, listJobs, removeJob, initScheduler, stopScheduler } from "../src/scheduler/index.js"
import type { ToolContext } from "../src/types/index.js"

const ctx: ToolContext = {
  workspaceDir: "/tmp",
  sessionId: "test",
  emit: () => {},
  confirm: async () => true,
}

describe("tool registry", () => {
  beforeAll(() => {
    registerTool({
      name: "test_echo",
      description: "echo",
      category: "test",
      parameters: { type: "object", properties: { msg: { type: "string" } } },
      execute: async (args) => ({ echoed: args.msg }),
    })
    registerTool({
      name: "test_fail",
      description: "always fails",
      category: "test",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        throw new Error("boom")
      },
    })
  })

  it("registers and lists tools", () => {
    expect(listTools().some((t) => t.name === "test_echo")).toBe(true)
  })

  it("produces OpenAI function-calling format", () => {
    const defs = toolsForModel()
    const echo = defs.find((d) => d.function.name === "test_echo")
    expect(echo?.type).toBe("function")
    expect(echo?.function.parameters).toBeDefined()
  })

  it("executes a tool and returns a structured result", async () => {
    const res = await executeTool("test_echo", { msg: "hi" }, ctx)
    expect(res.ok).toBe(true)
    expect(res.output).toEqual({ echoed: "hi" })
    expect(res.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("captures tool errors without throwing", async () => {
    const res = await executeTool("test_fail", {}, ctx)
    expect(res.ok).toBe(false)
    expect(res.error).toBe("boom")
  })

  it("handles unknown tools", async () => {
    const res = await executeTool("does_not_exist", {}, ctx)
    expect(res.ok).toBe(false)
    expect(res.error).toContain("Unknown tool")
  })
})

describe("memory", () => {
  it("remembers, recalls, and forgets", () => {
    remember("test.key", "test value", "fact")
    expect(recall("test.key")?.value).toBe("test value")
    expect(forget("test.key")).toBe(true)
    expect(recall("test.key")).toBeUndefined()
  })

  it("searches with FTS", () => {
    remember("test.search", "the quick brown fox jumps", "fact")
    const hits = searchMemory("brown fox")
    expect(hits.some((h) => h.key === "test.search")).toBe(true)
    forget("test.search")
  })

  it("stores conversation history per session", () => {
    clearHistory("test-session")
    addMessage("test-session", "user", "hello")
    addMessage("test-session", "assistant", "hi there")
    const hist = getHistory("test-session")
    expect(hist.length).toBe(2)
    expect(hist[0].role).toBe("user")
    clearHistory("test-session")
    expect(getHistory("test-session").length).toBe(0)
  })
})

describe("scheduler", () => {
  it("adds, lists, and removes jobs", () => {
    initScheduler(async () => {})
    const job = addJob({ name: "test-job", prompt: "do a thing", kind: "interval", intervalMin: 60 })
    expect(job.id).toBeGreaterThan(0)
    expect(listJobs().some((j) => j.name === "test-job")).toBe(true)
    expect(removeJob(job.id)).toBe(true)
    stopScheduler()
  })

  it("computes daily next-run in the future", () => {
    initScheduler(async () => {})
    const job = addJob({ name: "test-daily", prompt: "daily task", kind: "daily", atTime: "09:00" })
    expect(job.nextRunAt).toBeGreaterThan(Date.now())
    removeJob(job.id)
    stopScheduler()
  })
})
