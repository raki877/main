import { Bot } from "grammy"
import { runAgent, stopAgent } from "../agent/index.js"
import { clearHistory, listMemory, searchMemory } from "../memory/index.js"
import { AVAILABLE_MODELS, getCurrentModel, setCurrentModel } from "../models/openrouter.js"
import { listJobs, addJob, removeJob } from "../scheduler/index.js"
import { getStatus, setTelegramConnected } from "../status/index.js"
import { env, getConfig } from "../config/index.js"
import { createLogger } from "../logger/index.js"

const log = createLogger("system")

let bot: Bot | null = null

const HELP = `Nova Agent commands:
/status - system status
/model <id> - switch model
/models - list models
/memory [query] - list/search memory
/jobs - scheduled jobs
/schedule name | once 30 | prompt - schedule a task
/unschedule <id> - remove job
/clear - clear conversation
/stop - abort current run
Anything else is a task for the agent.`

function chunked(text: string, size = 3800): string[] {
  const parts: string[] = []
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size))
  return parts.length > 0 ? parts : ["(empty)"]
}

export async function startTelegram(): Promise<void> {
  const cfg = getConfig()
  if (!cfg.telegram.enabled || !env.telegramToken) {
    log.info("Telegram disabled (no token or disabled in config)")
    return
  }

  bot = new Bot(env.telegramToken)

  // Auth: if allowedChatIds is non-empty, only those chats may use the bot.
  bot.use(async (ctx, next) => {
    const allowed = getConfig().telegram.allowedChatIds
    if (allowed.length > 0 && ctx.chat && !allowed.includes(ctx.chat.id)) {
      await ctx.reply("Unauthorized. Ask the owner to add your chat id: " + ctx.chat.id)
      return
    }
    await next()
  })

  bot.command("start", (ctx) => ctx.reply("Nova Agent online. Send me a task or /help."))
  bot.command("help", (ctx) => ctx.reply(HELP))

  bot.command("status", (ctx) => {
    const s = getStatus()
    return ctx.reply(
      `phase: ${s.phase}\nmodel: ${s.model}\nuptime: ${Math.floor(s.uptimeSec / 60)}m\nram: ${s.memoryUsageMb}MB cpu: ${s.cpuPercent}%\ntools: ${s.toolCount} skills: ${s.skillCount} plugins: ${s.pluginCount}`,
    )
  })

  bot.command("models", (ctx) =>
    ctx.reply(AVAILABLE_MODELS.map((m) => `${m.id === getCurrentModel() ? "* " : "  "}${m.id}`).join("\n")),
  )

  bot.command("model", (ctx) => {
    const arg = ctx.match?.toString().trim()
    if (!arg) return ctx.reply(`Current model: ${getCurrentModel()}`)
    setCurrentModel(arg)
    return ctx.reply(`Model set to ${arg}`)
  })

  bot.command("memory", (ctx) => {
    const q = ctx.match?.toString().trim()
    const items = q ? searchMemory(q) : listMemory(15)
    if (items.length === 0) return ctx.reply("No memories found.")
    return ctx.reply(items.map((m) => `• ${m.key}: ${m.value.slice(0, 100)}`).join("\n").slice(0, 3800))
  })

  bot.command("jobs", (ctx) => {
    const jobs = listJobs()
    if (jobs.length === 0) return ctx.reply("No scheduled jobs.")
    return ctx.reply(
      jobs
        .map((j) => `#${j.id} ${j.name} (${j.kind}) next: ${new Date(j.nextRunAt).toLocaleString()}`)
        .join("\n"),
    )
  })

  bot.command("schedule", (ctx) => {
    const parts = (ctx.match?.toString() ?? "").split("|").map((s) => s.trim())
    if (parts.length < 3) return ctx.reply("Usage: /schedule name | once 30 (or: every 60, daily 09:00) | prompt")
    const [name, whenSpec, ...promptParts] = parts
    const [kindWord, whenVal] = whenSpec.split(/\s+/)
    const prompt = promptParts.join("|")
    if (kindWord === "once") addJob({ name, prompt, kind: "once", delayMin: Number(whenVal) || 0 })
    else if (kindWord === "every") addJob({ name, prompt, kind: "interval", intervalMin: Number(whenVal) || 60 })
    else if (kindWord === "daily") addJob({ name, prompt, kind: "daily", atTime: whenVal || "09:00" })
    else return ctx.reply("Unknown kind. Use: once N, every N, daily HH:MM")
    return ctx.reply("Scheduled.")
  })

  bot.command("unschedule", (ctx) => {
    const id = Number(ctx.match?.toString().trim())
    return ctx.reply(removeJob(id) ? "Removed." : "Job not found.")
  })

  bot.command("clear", (ctx) => {
    clearHistory(`tg:${ctx.chat.id}`)
    return ctx.reply("History cleared.")
  })

  bot.command("stop", (ctx) => {
    stopAgent()
    return ctx.reply("Agent stopped.")
  })

  // Any other text: run the agent.
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text
    const sessionId = `tg:${ctx.chat.id}`
    await ctx.replyWithChatAction("typing")
    const typing = setInterval(() => void ctx.replyWithChatAction("typing").catch(() => {}), 5000)
    try {
      const result = await runAgent(text, {
        sessionId,
        // Telegram is remote: never allow dangerous tools without local confirmation.
        confirm: async () => !getConfig().security.confirmDangerous,
      })
      for (const part of chunked(result.answer)) await ctx.reply(part)
    } catch (err) {
      await ctx.reply(`Error: ${(err as Error).message}`)
    } finally {
      clearInterval(typing)
    }
  })

  bot.catch((err) => log.error(`Telegram error: ${err.message}`))

  // Long polling in the background.
  void bot.start({
    onStart: (me) => {
      setTelegramConnected(true)
      log.info(`Telegram bot connected as @${me.username}`)
    },
  })
}

export async function stopTelegram(): Promise<void> {
  await bot?.stop()
  setTelegramConnected(false)
}
