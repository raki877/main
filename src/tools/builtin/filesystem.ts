import fs from "node:fs/promises"
import path from "node:path"
import type { ToolDefinition } from "../../types/index.js"

/**
 * Filesystem tools scoped to the workspace directory by default.
 * Absolute paths outside the workspace require confirmation.
 */

function resolveSafe(p: string, workspaceDir: string): { full: string; outside: boolean } {
  const full = path.isAbsolute(p) ? path.normalize(p) : path.normalize(path.join(workspaceDir, p))
  return { full, outside: !full.startsWith(workspaceDir) }
}

async function guard(p: string, ctx: { workspaceDir: string; confirm: (m: string) => Promise<boolean> }, write: boolean) {
  const { full, outside } = resolveSafe(p, ctx.workspaceDir)
  if (outside && write) {
    const ok = await ctx.confirm(`Write access outside workspace: ${full}. Allow?`)
    if (!ok) throw new Error("User denied access outside workspace")
  }
  return full
}

export const fsTools: ToolDefinition[] = [
  {
    name: "fs_read",
    description: "Read a text file. Paths are relative to the workspace unless absolute.",
    category: "filesystem",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        maxBytes: { type: "number", description: "Max bytes to read, default 100000" },
      },
      required: ["path"],
    },
    execute: async (args, ctx) => {
      const full = await guard(String(args.path), ctx, false)
      const content = await fs.readFile(full, "utf-8")
      const max = Number(args.maxBytes || 100_000)
      return { path: full, content: content.slice(0, max), truncated: content.length > max }
    },
  },
  {
    name: "fs_write",
    description: "Write/overwrite a text file. Creates parent directories automatically.",
    category: "filesystem",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
    execute: async (args, ctx) => {
      const full = await guard(String(args.path), ctx, true)
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, String(args.content), "utf-8")
      return { path: full, bytes: String(args.content).length }
    },
  },
  {
    name: "fs_list",
    description: "List files and directories at a path (workspace-relative by default).",
    category: "filesystem",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Directory, default is workspace root" } },
    },
    execute: async (args, ctx) => {
      const full = await guard(String(args.path || "."), ctx, false)
      const entries = await fs.readdir(full, { withFileTypes: true })
      return entries.map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }))
    },
  },
  {
    name: "fs_delete",
    description: "Delete a file or directory (recursive). Requires user confirmation.",
    category: "filesystem",
    dangerous: true,
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    execute: async (args, ctx) => {
      const full = await guard(String(args.path), ctx, true)
      await fs.rm(full, { recursive: true })
      return { deleted: full }
    },
  },
  {
    name: "fs_move",
    description: "Move or rename a file/directory.",
    category: "filesystem",
    parameters: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
    execute: async (args, ctx) => {
      const from = await guard(String(args.from), ctx, true)
      const to = await guard(String(args.to), ctx, true)
      await fs.mkdir(path.dirname(to), { recursive: true })
      await fs.rename(from, to)
      return { from, to }
    },
  },
  {
    name: "fs_copy",
    description: "Copy a file or directory.",
    category: "filesystem",
    parameters: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
    execute: async (args, ctx) => {
      const from = await guard(String(args.from), ctx, false)
      const to = await guard(String(args.to), ctx, true)
      await fs.mkdir(path.dirname(to), { recursive: true })
      await fs.cp(from, to, { recursive: true })
      return { from, to }
    },
  },
  {
    name: "fs_search",
    description: "Search for a text pattern in workspace files (like grep). Returns matching files and lines.",
    category: "filesystem",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Text or regex to search for" },
        dir: { type: "string", description: "Directory to search, default workspace root" },
      },
      required: ["pattern"],
    },
    execute: async (args, ctx) => {
      const dir = await guard(String(args.dir || "."), ctx, false)
      const regex = new RegExp(String(args.pattern), "i")
      const results: { file: string; line: number; text: string }[] = []

      async function walk(d: string, depth: number): Promise<void> {
        if (depth > 6 || results.length >= 100) return
        let entries
        try {
          entries = await fs.readdir(d, { withFileTypes: true })
        } catch {
          return
        }
        for (const e of entries) {
          if (e.name === "node_modules" || e.name.startsWith(".")) continue
          const full = path.join(d, e.name)
          if (e.isDirectory()) {
            await walk(full, depth + 1)
          } else if (e.isFile()) {
            try {
              const stat = await fs.stat(full)
              if (stat.size > 1024 * 1024) continue
              const content = await fs.readFile(full, "utf-8")
              const lines = content.split("\n")
              for (let i = 0; i < lines.length && results.length < 100; i++) {
                if (regex.test(lines[i])) {
                  results.push({ file: full, line: i + 1, text: lines[i].slice(0, 200) })
                }
              }
            } catch {
              /* binary or unreadable */
            }
          }
        }
      }
      await walk(dir, 0)
      return results
    },
  },
]
