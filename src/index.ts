/**
 * Nova Agent — OpenClaw-inspired autonomous AI agent for Linux.
 * Entry point: boots every subsystem and keeps the process alive.
 *
 *   node dist/index.js            server + telegram + scheduler (headless)
 *   node dist/index.js --terminal also attach the interactive terminal UI
 */
import { getConfig, env } from "./config/index.js"
import { createLogger } from "./logger/index.js"
import { bus } from "./events/bus.js"
import { loadBuiltinTools } from "./tools/index.js"
import { loadSkills, watchSkills } from "./skills/index.js"
import { loadPlugins, watchPlugins } from "./plugins/index.js"
import { initScheduler, stopScheduler } from "./scheduler/index.js"
import { runAgent, stopAgent } from "./agent/index.js"
import { startServer } from "./server/index.js"
import { startTelegram, stopTelegram } from "./telegram/index.js"
import { startTerminal } from "./terminal/index.js"
import { closeBrowser } from "./browser/index.js"

const log = createLogger("system")

async function main(): Promise<void> {
  const cfg = getConfig()
  log.info("Nova Agent starting...")
  bus.emitEvent("AgentStarted", { model: cfg.model })

  if (!env.openRouterKey) {
    console.error(
      "\n  OPENROUTER_API_KEY is not set.\n  Create a .env file in the project root:\n\n    OPENROUTER_API_KEY=sk-or-...\n    TELEGRAM_TOKEN=...   (optional)\n",
    )
  }

  // 1. Tools, skills, plugins.
  loadBuiltinTools()
  loadSkills()
  watchSkills()
  await loadPlugins()
  watchPlugins()

  // 2. Scheduler: scheduled jobs run through the agent under a dedicated session.
  initScheduler(async (prompt, jobName) => {
    await runAgent(prompt, { sessionId: `job:${jobName}` })
  })

  // 3. HTTP + WebSocket server (dashboard + REST API).
  const server = startServer()

  // 4. Telegram bot (long polling, optional).
  await startTelegram()

  // 5. Terminal UI when run interactively.
  const wantTerminal = process.argv.includes("--terminal") || process.stdout.isTTY
  if (wantTerminal && !process.argv.includes("--headless")) {
    startTerminal()
  } else {
    log.info("Running headless. Dashboard: http://localhost:" + cfg.port)
  }

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down...`)
    stopAgent()
    stopScheduler()
    await stopTelegram().catch(() => {})
    await closeBrowser().catch(() => {})
    server.close()
    bus.emitEvent("AgentStopped", {})
    setTimeout(() => process.exit(0), 500)
  }
  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))

  process.on("uncaughtException", (err) => log.error(`uncaughtException: ${err.message}`))
  process.on("unhandledRejection", (reason) => log.error(`unhandledRejection: ${String(reason)}`))
}

void main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
