import readline from "node:readline"
import chalk from "chalk"
import { runAgent, stopAgent, getAgentPhase } from "../agent/index.js"
import { clearHistory, listMemory, searchMemory, forget } from "../memory/index.js"
import { listTools } from "../tools/registry.js"
import { listSkills } from "../skills/index.js"
import { listPlugins } from "../plugins/index.js"
import { AVAILABLE_MODELS, getCurrentModel, setCurrentModel } from "../models/openrouter.js"
import { listJobs, addJob, removeJob } from "../scheduler/index.js"
import { getStatus } from "../status/index.js"
import { getConfig } from "../config/index.js"
import { bus } from "../events/bus.js"
import { createLogger, getRecentLogs } from "../logger/index.js"

const log = createLogger("terminal")
const SESSION = "terminal"

const HELP = `
${chalk.bold("Commands")}
  /help                 Show this help
  /status               System status (phase, RAM, CPU, uptime)
  /model [id]           Show or switch model
  /models               List available models
  /tools                List registered tools
  /skills               List loaded skills
  /plugins              List loaded plugins
  /memory [query]       List or search long-term memory
  /forget <key>         Delete a memory entry
  /jobs                 List scheduled jobs
  /schedule <name> | <once N|every N|daily HH:MM> | <prompt>
  /unschedule <id>      Remove a scheduled job
  /logs [n]             Show recent log lines
  /clear                Clear this session's conversation history
  /stop                 Abort the current agent run
  /quit                 Exit

Anything else is sent to the agent as a task.
`

export function startTerminal(): void {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  const prompt = () => {
    rl.setPrompt(chalk.green("nova> "))
    rl.prompt()
  }

  // Show tool activity inline while the agent works.
  bus.onEvent("ToolStarted", (p: any) => {
    process.stdout.write(chalk.dim(`\n  ⚙ ${p.name} ${JSON.stringify(p.args).slice(0, 120)}\n`))
  })
  bus.onEvent("ToolCompleted", (p: any) => {
    process.stdout.write(
      p.ok ? chalk.dim(`  ✓ ${p.name} (${p.durationMs}ms)\n`) : chalk.red(`  ✗ ${p.name}: ${p.error}\n`),
    )
  })

  console.log(chalk.bold.green("\nnova_agent") + chalk.dim(" — autonomous AI agent. Type /help for commands.\n"))
  console.log(chalk.dim(`model: ${getCurrentModel()}  dashboard: http://localhost:${getConfig().port}\n`))

  rl.on("line", async (line) => {
    const input = line.trim()
    if (!input) return prompt()

    if (input.startsWith("/")) {
      await handleCommand(input, rl)
      return prompt()
    }

    // Send to the agent with streaming output.
    try {
      process.stdout.write("\n")
      const result = await runAgent(input, {
        sessionId: SESSION,
        onToken: (t) => process.stdout.write(chalk.white(t)),
        confirm: async (msg) =>
          new Promise((resolve) => {
            rl.question(chalk.yellow(`\n${msg} [y/N] `), (ans) => resolve(ans.trim().toLowerCase() === "y"))
          }),
      })
      // If the answer wasn't streamed (tool-only turns), print it.
      process.stdout.write("\n" + chalk.dim(`(${result.iterations} iterations, ${result.toolCalls} tool calls, ${Math.round(result.durationMs / 100) / 10}s)\n\n`))
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      log.error((err as Error).message)
    }
    prompt()
  })

  rl.on("close", () => {
    console.log(chalk.dim("\nbye"))
    process.exit(0)
  })

  prompt()
}

async function handleCommand(input: string, rl: readline.Interface): Promise<void> {
  const [cmd, ...rest] = input.split(/\s+/)
  const arg = rest.join(" ").trim()

  switch (cmd) {
    case "/help":
      console.log(HELP)
      break

    case "/status": {
      const s = getStatus()
      console.log(
        `phase: ${chalk.cyan(s.phase)}  model: ${s.model}\n` +
          `uptime: ${s.uptimeSec}s  ram: ${s.memoryUsageMb}MB  cpu: ${s.cpuPercent}%\n` +
          `tools: ${s.toolCount}  skills: ${s.skillCount}  plugins: ${s.pluginCount}  telegram: ${s.telegramConnected ? "on" : "off"}`,
      )
      break
    }

    case "/model":
      if (arg) {
        setCurrentModel(arg)
        console.log(chalk.green(`Model set to ${arg}`))
      } else {
        console.log(`Current model: ${chalk.cyan(getCurrentModel())}`)
      }
      break

    case "/models":
      for (const m of AVAILABLE_MODELS) {
        const mark = m.id === getCurrentModel() ? chalk.green("* ") : "  "
        console.log(`${mark}${m.id} ${chalk.dim(`(${m.label}${m.supportsTools ? "" : ", no tools"})`)}`)
      }
      break

    case "/tools": {
      const byCat = new Map<string, string[]>()
      for (const t of listTools()) {
        const list = byCat.get(t.category) ?? []
        list.push(t.name + (t.dangerous ? chalk.red("!") : ""))
        byCat.set(t.category, list)
      }
      for (const [cat, names] of byCat) console.log(`${chalk.bold(cat)}: ${names.join(", ")}`)
      break
    }

    case "/skills":
      for (const s of listSkills()) {
        console.log(`${chalk.bold(s.manifest.name)}@${s.manifest.version} ${chalk.dim(s.manifest.description)}`)
      }
      if (listSkills().length === 0) console.log(chalk.dim("No skills loaded. Add folders under skills/"))
      break

    case "/plugins":
      for (const p of listPlugins()) {
        console.log(`${chalk.bold(p.manifest.name)}@${p.manifest.version} ${chalk.dim(p.manifest.description)}`)
      }
      if (listPlugins().length === 0) console.log(chalk.dim("No plugins loaded. Add folders under plugins/"))
      break

    case "/memory": {
      const items = arg ? searchMemory(arg) : listMemory(30)
      for (const m of items) {
        console.log(`${chalk.bold(m.key)} ${chalk.dim(`(${m.kind})`)}\n  ${m.value.slice(0, 160)}`)
      }
      if (items.length === 0) console.log(chalk.dim("No memories found."))
      break
    }

    case "/forget":
      if (!arg) console.log("Usage: /forget <key>")
      else console.log(forget(arg) ? chalk.green("Forgotten.") : chalk.red("Key not found."))
      break

    case "/jobs":
      for (const j of listJobs()) {
        console.log(
          `#${j.id} ${chalk.bold(j.name)} (${j.kind}${j.intervalMin ? ` ${j.intervalMin}m` : ""}${j.atTime ? ` @ ${j.atTime}` : ""}) next: ${new Date(j.nextRunAt).toLocaleString()}\n  ${chalk.dim(j.prompt.slice(0, 100))}`,
        )
      }
      if (listJobs().length === 0) console.log(chalk.dim("No scheduled jobs."))
      break

    case "/schedule": {
      const parts = arg.split("|").map((s) => s.trim())
      if (parts.length < 3) {
        console.log('Usage: /schedule <name> | <once 30|every 60|daily 09:00> | <prompt>')
        break
      }
      const [name, whenSpec, ...promptParts] = parts
      const jobPrompt = promptParts.join("|")
      const [kindWord, whenVal] = whenSpec.split(/\s+/)
      if (kindWord === "once") addJob({ name, prompt: jobPrompt, kind: "once", delayMin: Number(whenVal) || 0 })
      else if (kindWord === "every") addJob({ name, prompt: jobPrompt, kind: "interval", intervalMin: Number(whenVal) || 60 })
      else if (kindWord === "daily") addJob({ name, prompt: jobPrompt, kind: "daily", atTime: whenVal || "09:00" })
      else {
        console.log("Unknown schedule kind. Use: once N, every N, daily HH:MM")
        break
      }
      console.log(chalk.green("Job scheduled."))
      break
    }

    case "/unschedule":
      console.log(removeJob(Number(arg)) ? chalk.green("Removed.") : chalk.red("Job not found."))
      break

    case "/logs":
      for (const l of getRecentLogs(Number(arg) || 30)) {
        const color = l.level === "error" ? chalk.red : l.level === "warn" ? chalk.yellow : chalk.dim
        console.log(color(`${new Date(l.ts).toLocaleTimeString()} [${l.channel}] ${l.msg.slice(0, 200)}`))
      }
      break

    case "/clear":
      clearHistory(SESSION)
      console.log(chalk.green("History cleared."))
      break

    case "/stop":
      stopAgent()
      console.log(chalk.yellow(`Agent stopped (was: ${getAgentPhase()})`))
      break

    case "/quit":
    case "/exit":
      rl.close()
      break

    default:
      console.log(chalk.red(`Unknown command: ${cmd}. Type /help`))
  }
}
