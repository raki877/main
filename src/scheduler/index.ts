import { getDb } from "../memory/index.js"
import { bus } from "../events/bus.js"
import { createLogger } from "../logger/index.js"

const log = createLogger("system")

/**
 * Lightweight SQLite-backed scheduler. No cron dependency.
 * Schedule kinds:
 *  - "once"     : run at `next_run_at`, then delete
 *  - "interval" : run every `interval_min` minutes
 *  - "daily"    : run every day at `at_time` (HH:MM, local)
 */
export interface ScheduledJob {
  id: number
  name: string
  prompt: string
  kind: "once" | "interval" | "daily"
  intervalMin: number | null
  atTime: string | null
  nextRunAt: number
  lastRunAt: number | null
  enabled: number
  createdAt: number
}

type JobRunner = (prompt: string, jobName: string) => Promise<void>

let timer: ReturnType<typeof setInterval> | null = null
let runner: JobRunner | null = null

function db() {
  return getDb()
}

export function initScheduler(run: JobRunner): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      kind TEXT NOT NULL,
      interval_min INTEGER,
      at_time TEXT,
      next_run_at INTEGER NOT NULL,
      last_run_at INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
  `)
  runner = run
  if (timer) clearInterval(timer)
  timer = setInterval(tick, 30_000)
  timer.unref?.()
  log.info("Scheduler started (30s tick)")
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}

function nextDailyRun(atTime: string, from = Date.now()): number {
  const [h, m] = atTime.split(":").map(Number)
  const d = new Date(from)
  d.setHours(h, m, 0, 0)
  if (d.getTime() <= from) d.setDate(d.getDate() + 1)
  return d.getTime()
}

export function addJob(opts: {
  name: string
  prompt: string
  kind: "once" | "interval" | "daily"
  intervalMin?: number
  atTime?: string
  delayMin?: number
}): ScheduledJob {
  let nextRunAt: number
  if (opts.kind === "once") {
    nextRunAt = Date.now() + (opts.delayMin ?? 0) * 60_000
  } else if (opts.kind === "interval") {
    nextRunAt = Date.now() + (opts.intervalMin ?? 60) * 60_000
  } else {
    nextRunAt = nextDailyRun(opts.atTime ?? "09:00")
  }

  const res = db()
    .prepare(
      "INSERT INTO jobs (name, prompt, kind, interval_min, at_time, next_run_at, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
    )
    .run(opts.name, opts.prompt, opts.kind, opts.intervalMin ?? null, opts.atTime ?? null, nextRunAt, Date.now())
  log.info(`Job added: ${opts.name} (${opts.kind}) next run ${new Date(nextRunAt).toISOString()}`)
  return getJob(Number(res.lastInsertRowid))!
}

export function getJob(id: number): ScheduledJob | undefined {
  return db()
    .prepare(
      "SELECT id, name, prompt, kind, interval_min as intervalMin, at_time as atTime, next_run_at as nextRunAt, last_run_at as lastRunAt, enabled, created_at as createdAt FROM jobs WHERE id = ?",
    )
    .get(id) as ScheduledJob | undefined
}

export function listJobs(): ScheduledJob[] {
  return db()
    .prepare(
      "SELECT id, name, prompt, kind, interval_min as intervalMin, at_time as atTime, next_run_at as nextRunAt, last_run_at as lastRunAt, enabled, created_at as createdAt FROM jobs ORDER BY next_run_at ASC",
    )
    .all() as ScheduledJob[]
}

export function removeJob(id: number): boolean {
  return db().prepare("DELETE FROM jobs WHERE id = ?").run(id).changes > 0
}

export function toggleJob(id: number, enabled: boolean): void {
  db().prepare("UPDATE jobs SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id)
}

async function tick(): Promise<void> {
  if (!runner) return
  const due = db()
    .prepare("SELECT id FROM jobs WHERE enabled = 1 AND next_run_at <= ?")
    .all(Date.now()) as { id: number }[]

  for (const { id } of due) {
    const job = getJob(id)
    if (!job) continue
    log.info(`Running job: ${job.name}`)
    bus.emitEvent("Log", { level: "info", msg: `Scheduled job started: ${job.name}` })

    // Reschedule or delete BEFORE running so a crash cannot cause tight re-run loops.
    if (job.kind === "once") {
      removeJob(job.id)
    } else if (job.kind === "interval") {
      db()
        .prepare("UPDATE jobs SET next_run_at = ?, last_run_at = ? WHERE id = ?")
        .run(Date.now() + (job.intervalMin ?? 60) * 60_000, Date.now(), job.id)
    } else {
      db()
        .prepare("UPDATE jobs SET next_run_at = ?, last_run_at = ? WHERE id = ?")
        .run(nextDailyRun(job.atTime ?? "09:00"), Date.now(), job.id)
    }

    try {
      await runner(job.prompt, job.name)
    } catch (err) {
      log.error(`Job ${job.name} failed: ${(err as Error).message}`)
    }
  }
}
