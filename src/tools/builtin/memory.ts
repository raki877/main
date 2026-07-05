import { forget, listMemory, recall, remember, searchMemory } from "../../memory/index.js"
import type { ToolDefinition } from "../../types/index.js"

export const memoryTools: ToolDefinition[] = [
  {
    name: "memory_save",
    description:
      "Save a fact, preference, or task note to long-term memory so it persists across sessions. Use short descriptive keys.",
    category: "memory",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Short unique key, e.g. 'user.favorite_editor'" },
        value: { type: "string" },
        kind: { type: "string", enum: ["fact", "summary", "task", "preference"] },
      },
      required: ["key", "value"],
    },
    execute: async (args) => {
      remember(String(args.key), String(args.value), (args.kind as never) || "fact")
      return { saved: String(args.key) }
    },
  },
  {
    name: "memory_recall",
    description: "Recall a value from long-term memory by exact key, or search when key is unknown.",
    category: "memory",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Exact key (optional)" },
        query: { type: "string", description: "Free-text search (optional)" },
      },
    },
    execute: async (args) => {
      if (args.key) {
        const entry = recall(String(args.key))
        return entry ?? { found: false }
      }
      if (args.query) return searchMemory(String(args.query))
      return listMemory(20)
    },
  },
  {
    name: "memory_forget",
    description: "Delete an entry from long-term memory by key.",
    category: "memory",
    parameters: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
    execute: async (args) => ({ deleted: forget(String(args.key)) }),
  },
]
