import { exec } from "node:child_process"
import { promisify } from "node:util"
import { getConfig } from "../../config/index.js"
import type { ToolDefinition } from "../../types/index.js"

const execAsync = promisify(exec)

function isBlocked(command: string): boolean {
  const cfg = getConfig()
  return cfg.security.blockedCommands.some((b) => command.includes(b))
}

const DANGEROUS_PATTERNS = [/\brm\s+-rf?\b/, /\bsudo\b/, /\bmkfs\b/, /git\s+reset\s+--hard/, /\bdd\s+if=/, /apt(-get)?\s+(remove|purge)/]

function isDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(command))
}

async function runShell(command: string, cwd: string, timeoutMs = 60_000) {
  if (isBlocked(command)) throw new Error("Command blocked by security policy")
  const { stdout, stderr } = await execAsync(command, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env },
  })
  return { stdout: stdout.slice(0, 20_000), stderr: stderr.slice(0, 8_000) }
}

export const shellTools: ToolDefinition[] = [
  {
    name: "shell_run",
    description:
      "Run a shell command on the Linux host and return stdout/stderr. Use for system tasks, package checks, process management. Working directory defaults to the agent workspace.",
    category: "system",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        cwd: { type: "string", description: "Optional working directory (absolute path)" },
        timeoutSec: { type: "number", description: "Timeout in seconds, default 60" },
      },
      required: ["command"],
    },
    execute: async (args, ctx) => {
      const command = String(args.command)
      if (isDangerous(command)) {
        const ok = await ctx.confirm(`Dangerous shell command: "${command}". Allow?`)
        if (!ok) throw new Error("User denied dangerous command")
      }
      return runShell(command, String(args.cwd || ctx.workspaceDir), Number(args.timeoutSec || 60) * 1000)
    },
  },
  {
    name: "node_eval",
    description: "Execute JavaScript code with Node.js and return its stdout. Code runs in a separate process.",
    category: "code",
    parameters: {
      type: "object",
      properties: { code: { type: "string", description: "JavaScript code to run" } },
      required: ["code"],
    },
    execute: async (args, ctx) => {
      const code = String(args.code)
      const b64 = Buffer.from(code, "utf-8").toString("base64")
      return runShell(`node -e "eval(Buffer.from('${b64}','base64').toString())"`, ctx.workspaceDir, 30_000)
    },
  },
  {
    name: "python_run",
    description: "Execute a Python script (python3) and return stdout/stderr. Use for data processing or when Python libraries are needed.",
    category: "code",
    parameters: {
      type: "object",
      properties: { code: { type: "string", description: "Python code to run" } },
      required: ["code"],
    },
    execute: async (args, ctx) => {
      const b64 = Buffer.from(String(args.code), "utf-8").toString("base64")
      return runShell(
        `python3 -c "import base64;exec(base64.b64decode('${b64}').decode())"`,
        ctx.workspaceDir,
        60_000,
      )
    },
  },
  {
    name: "git",
    description: "Run a git command (status, log, diff, add, commit, branch, etc.) in the workspace or a given repo path.",
    category: "code",
    parameters: {
      type: "object",
      properties: {
        subcommand: { type: "string", description: "Git subcommand and args, e.g. 'status --short'" },
        repoPath: { type: "string", description: "Optional repository path" },
      },
      required: ["subcommand"],
    },
    execute: async (args, ctx) => {
      const sub = String(args.subcommand)
      if (/reset\s+--hard|push\s+--force|clean\s+-fd/.test(sub)) {
        const ok = await ctx.confirm(`Destructive git command: "git ${sub}". Allow?`)
        if (!ok) throw new Error("User denied destructive git command")
      }
      return runShell(`git ${sub}`, String(args.repoPath || ctx.workspaceDir))
    },
  },
  {
    name: "clipboard",
    description: "Read or write the system clipboard (requires xclip on Linux).",
    category: "system",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "write"] },
        text: { type: "string", description: "Text to write (for write action)" },
      },
      required: ["action"],
    },
    execute: async (args, ctx) => {
      if (args.action === "read") {
        return runShell("xclip -selection clipboard -o", ctx.workspaceDir, 5000)
      }
      const b64 = Buffer.from(String(args.text ?? ""), "utf-8").toString("base64")
      return runShell(`echo '${b64}' | base64 -d | xclip -selection clipboard`, ctx.workspaceDir, 5000)
    },
  },
  {
    name: "screenshot",
    description: "Take a screenshot of the desktop and save it to the workspace (requires gnome-screenshot or scrot).",
    category: "system",
    parameters: {
      type: "object",
      properties: { filename: { type: "string", description: "Output filename, default screenshot.png" } },
    },
    execute: async (args, ctx) => {
      const file = `${ctx.workspaceDir}/${String(args.filename || "screenshot.png")}`
      try {
        await runShell(`gnome-screenshot -f "${file}"`, ctx.workspaceDir, 10_000)
      } catch {
        await runShell(`scrot "${file}"`, ctx.workspaceDir, 10_000)
      }
      return { saved: file }
    },
  },
]
