import os from "node:os"
import { getAgentPhase } from "../agent/index.js"
import { getCurrentModel } from "../models/openrouter.js"
import { toolCount } from "../tools/registry.js"
import { skillCount } from "../skills/index.js"
import { pluginCount } from "../plugins/index.js"
import { sessionCount } from "../memory/index.js"
import type { SystemStatus } from "../types/index.js"

const startedAt = Date.now()
let telegramConnected = false

export function setTelegramConnected(connected: boolean): void {
  telegramConnected = connected
}

let lastCpu = process.cpuUsage()
let lastCpuTime = Date.now()

export function getStatus(): SystemStatus {
  const nowCpu = process.cpuUsage()
  const now = Date.now()
  const elapsedMs = Math.max(now - lastCpuTime, 1)
  const usedMs = (nowCpu.user - lastCpu.user + (nowCpu.system - lastCpu.system)) / 1000
  const cpuPercent = Math.min(100, Math.round((usedMs / (elapsedMs * os.cpus().length)) * 10000) / 100)
  lastCpu = nowCpu
  lastCpuTime = now

  return {
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    model: getCurrentModel(),
    phase: getAgentPhase(),
    memoryUsageMb: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
    cpuPercent,
    toolCount: toolCount(),
    skillCount: skillCount(),
    pluginCount: pluginCount(),
    telegramConnected,
    sessions: sessionCount(),
  }
}
