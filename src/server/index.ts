import http from "node:http"
import path from "node:path"
import express from "express"
import { WebSocketServer, WebSocket } from "ws"
import { bus } from "../events/bus.js"
import { getConfig, updateConfig, ROOT_DIR, WORKSPACE_DIR, env } from "../config/index.js"
import { createLogger, getRecentLogs } from "../logger/index.js"
import { runAgent, stopAgent } from "../agent/index.js"
import { getHistory, clearHistory, listMemory, remember, forget, searchMemory } from "../memory/index.js"
import { listTools, executeTool } from "../tools/registry.js"
import { listSkills } from "../skills/index.js"
import { listPlugins } from "../plugins/index.js"
import { AVAILABLE_MODELS, getCurrentModel, setCurrentModel } from "../models/openrouter.js"
import { addJob, listJobs, removeJob, toggleJob } from "../scheduler/index.js"
import { getStatus } from "../status/index.js"

const log = createLogger("system")

const PUBLIC_DIR = path.join(ROOT_DIR, "public")

export function startServer(): http.Server {
  const app = express()
  app.use(express.json({ limit: "1mb" }))

  // Localhost-only API guard.
  app.use((req, res, next) => {
    const ip = req.socket.remoteAddress ?? ""
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || process.env.ALLOW_REMOTE === "1") {
      next()
    } else {
      res.status(403).json({ error: "Localhost only" })
    }
  })

  // ---------- Static dashboard ----------
  app.use(express.static(PUBLIC_DIR))

  // ---------- Status ----------
  app.get("/api/status", (_req, res) => res.json(getStatus()))

  // ---------- Chat ----------
  app.post("/api/chat", async (req, res) => {
    const { message, sessionId = "api" } = req.body ?? {}
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message (string) is required" })
    }
    try {
      const result = await runAgent(message, { sessionId })
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  })

  app.post("/api/stop", (_req, res) => {
    stopAgent()
    res.json({ ok: true })
  })

  // ---------- History ----------
  app.get("/api/history/:sessionId", (req, res) => res.json(getHistory(req.params.sessionId, 100)))
  app.delete("/api/history/:sessionId", (req, res) => {
    clearHistory(req.params.sessionId)
    res.json({ ok: true })
  })

  // ---------- Memory ----------
  app.get("/api/memory", (req, res) => {
    const q = req.query.q as string | undefined
    res.json(q ? searchMemory(q) : listMemory(200))
  })
  app.post("/api/memory", (req, res) => {
    const { key, value, kind = "fact" } = req.body ?? {}
    if (!key || !value) return res.status(400).json({ error: "key and value are required" })
    remember(key, value, kind)
    res.json({ ok: true })
  })
  app.delete("/api/memory/:key", (req, res) => res.json({ ok: forget(req.params.key) }))

  // ---------- Tools / skills / plugins ----------
  app.get("/api/tools", (_req, res) =>
    res.json(
      listTools().map((t) => ({
        name: t.name,
        description: t.description,
        category: t.category,
        dangerous: !!t.dangerous,
      })),
    ),
  )
  app.post("/api/tools/:name", async (req, res) => {
    const name = req.params.name
    if (!listTools().some((t) => t.name === name)) {
      return res.status(404).json({ error: `Unknown tool: ${name}` })
    }
    // Direct API invocations auto-approve dangerous tools only when the
    // caller explicitly passes confirmDangerous: true.
    const confirmDangerous = req.body?.confirmDangerous === true
    const result = await executeTool(name, req.body?.args ?? {}, {
      workspaceDir: WORKSPACE_DIR,
      sessionId: "api",
      emit: (event, payload) => bus.emit(event, payload),
      confirm: async () => confirmDangerous,
    })
    res.status(result.ok ? 200 : 500).json(result)
  })
  app.get("/api/skills", (_req, res) =>
    res.json(listSkills().map((s) => ({ ...s.manifest, dir: s.dir }))),
  )
  app.get("/api/plugins", (_req, res) => res.json(listPlugins().map((p) => ({ ...p.manifest, dir: p.dir }))))

  // ---------- Models ----------
  app.get("/api/models", (_req, res) => res.json({ current: getCurrentModel(), available: AVAILABLE_MODELS }))
  app.post("/api/models", (req, res) => {
    const { model } = req.body ?? {}
    if (!model) return res.status(400).json({ error: "model is required" })
    setCurrentModel(model)
    res.json({ ok: true, model })
  })

  // ---------- Config ----------
  app.get("/api/config", (_req, res) => res.json(getConfig()))
  app.patch("/api/config", (req, res) => {
    try {
      res.json(updateConfig(req.body ?? {}))
    } catch (err) {
      res.status(400).json({ error: (err as Error).message })
    }
  })

  // ---------- Scheduler ----------
  app.get("/api/jobs", (_req, res) => res.json(listJobs()))
  app.post("/api/jobs", (req, res) => {
    const { name, prompt, kind, intervalMin, atTime, delayMin } = req.body ?? {}
    if (!name || !prompt || !kind) return res.status(400).json({ error: "name, prompt, kind are required" })
    res.json(addJob({ name, prompt, kind, intervalMin, atTime, delayMin }))
  })
  app.delete("/api/jobs/:id", (req, res) => res.json({ ok: removeJob(Number(req.params.id)) }))
  app.patch("/api/jobs/:id", (req, res) => {
    toggleJob(Number(req.params.id), !!req.body?.enabled)
    res.json({ ok: true })
  })

  // ---------- Logs ----------
  app.get("/api/logs", (req, res) =>
    res.json(getRecentLogs(Number(req.query.n) || 200, req.query.channel as string | undefined)),
  )

  // ---------- HTTP + WS ----------
  const server = http.createServer(app)
  const wss = new WebSocketServer({ server, path: "/ws" })

  // Fan out all bus events to connected websocket clients.
  const fanout = (envelope: unknown) => {
    const data = JSON.stringify(envelope)
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data)
    }
  }
  bus.onEvent("*", fanout)

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ event: "Hello", payload: getStatus(), ts: Date.now() }))

    ws.on("message", async (raw) => {
      let msg: { type?: string; message?: string; sessionId?: string } = {}
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (msg.type === "chat" && msg.message) {
        const sessionId = msg.sessionId ?? "dashboard"
        try {
          const result = await runAgent(msg.message, { sessionId })
          ws.send(JSON.stringify({ event: "ChatResult", payload: { ...result, sessionId }, ts: Date.now() }))
        } catch (err) {
          ws.send(
            JSON.stringify({
              event: "ChatError",
              payload: { error: (err as Error).message, sessionId },
              ts: Date.now(),
            }),
          )
        }
      } else if (msg.type === "stop") {
        stopAgent()
      } else if (msg.type === "status") {
        ws.send(JSON.stringify({ event: "Status", payload: getStatus(), ts: Date.now() }))
      }
    })
  })

  const port = env.port ?? getConfig().port
  // Binds to localhost by default for security. Set HOST=0.0.0.0 (plus
  // ALLOW_REMOTE=1) only when you intentionally want remote access.
  const host = process.env.HOST || "127.0.0.1"
  server.listen(port, host, () => {
    log.info(`Dashboard + API listening on http://localhost:${port}`)
  })

  return server
}
