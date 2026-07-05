import fs from "node:fs"
import path from "node:path"
import { LOGS_DIR, getConfig } from "../config/index.js"
import { bus } from "../events/bus.js"

/**
 * Lightweight rotating file logger. One file per channel
 * (conversation, planner, tools, memory, performance, errors, terminal).
 * Keeps RAM/CPU low: appends synchronously in small batches, rotates by size.
 */

export type LogChannel =
  | "conversation"
  | "planner"
  | "tools"
  | "memory"
  | "performance"
  | "errors"
  | "terminal"
  | "system"

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const
type Level = keyof typeof LEVELS

// In-memory ring buffer of recent log lines for the dashboard/API.
const RING_SIZE = 500
const ring: { ts: number; channel: string; level: string; msg: string }[] = []

function rotateIfNeeded(file: string): void {
  const cfg = getConfig()
  try {
    const stat = fs.statSync(file)
    if (stat.size > cfg.logging.maxFileSizeMb * 1024 * 1024) {
      for (let i = cfg.logging.maxFiles - 1; i >= 1; i--) {
        const from = i === 1 ? file : `${file}.${i - 1}`
        const to = `${file}.${i}`
        if (fs.existsSync(from)) fs.renameSync(from, to)
      }
    }
  } catch {
    /* file does not exist yet */
  }
}

function write(channel: LogChannel, level: Level, msg: string): void {
  const cfg = getConfig()
  if (LEVELS[level] < LEVELS[cfg.logging.level]) return
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}\n`
  const file = path.join(LOGS_DIR, `${channel}.log`)
  rotateIfNeeded(file)
  try {
    fs.appendFileSync(file, line)
  } catch {
    /* disk issues should never crash the agent */
  }
  ring.push({ ts: Date.now(), channel, level, msg })
  if (ring.length > RING_SIZE) ring.shift()
  bus.emitEvent("Log", { channel, level, msg, ts: Date.now() })
  if (level === "error") {
    const errFile = path.join(LOGS_DIR, "errors.log")
    rotateIfNeeded(errFile)
    try {
      fs.appendFileSync(errFile, `${new Date().toISOString()} [${channel}] ${msg}\n`)
    } catch {
      /* ignore */
    }
  }
}

export function getRecentLogs(limit = 200, channel?: string) {
  const items = channel ? ring.filter((r) => r.channel === channel) : ring
  return items.slice(-limit)
}

export function createLogger(channel: LogChannel) {
  return {
    debug: (msg: string) => write(channel, "debug", msg),
    info: (msg: string) => write(channel, "info", msg),
    warn: (msg: string) => write(channel, "warn", msg),
    error: (msg: string) => write(channel, "error", msg),
  }
}

export const log = createLogger("system")
