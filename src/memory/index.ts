import Database from "better-sqlite3"
import path from "node:path"
import { DATA_DIR } from "../config/index.js"
import { createLogger } from "../logger/index.js"
import { bus } from "../events/bus.js"
import type { ChatMessage, MemoryEntry, Role, StoredMessage } from "../types/index.js"

const log = createLogger("memory")

/**
 * SQLite-backed memory:
 *  - messages: full conversation history per session (short-term)
 *  - memory:   long-term key/value facts, summaries, task memory
 *  - FTS index for search
 */
const db = new Database(path.join(DATA_DIR, "agent.db"))
db.pragma("journal_mode = WAL")
db.pragma("synchronous = NORMAL")

db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);

CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fact',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(key, value, content='memory', content_rowid='id');

CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
  INSERT INTO memory_fts(rowid, key, value) VALUES (new.id, new.key, new.value);
END;
CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, key, value) VALUES('delete', old.id, old.key, old.value);
END;
CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, key, value) VALUES('delete', old.id, old.key, old.value);
  INSERT INTO memory_fts(rowid, key, value) VALUES (new.id, new.key, new.value);
END;
`)

// ---------- Conversation history ----------

const insertMsg = db.prepare(
  "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
)
const selectMsgs = db.prepare(
  "SELECT id, session_id as sessionId, role, content, created_at as createdAt FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?",
)
const clearMsgs = db.prepare("DELETE FROM messages WHERE session_id = ?")
const countSessions = db.prepare("SELECT COUNT(DISTINCT session_id) as n FROM messages")

export function addMessage(sessionId: string, role: Role, content: string): void {
  insertMsg.run(sessionId, role, content, Date.now())
}

export function getHistory(sessionId: string, limit = 30): StoredMessage[] {
  return (selectMsgs.all(sessionId, limit) as StoredMessage[]).reverse()
}

export function getHistoryAsChatMessages(sessionId: string, limit = 30): ChatMessage[] {
  return getHistory(sessionId, limit).map((m) => ({ role: m.role, content: m.content }))
}

export function clearHistory(sessionId: string): void {
  clearMsgs.run(sessionId)
  log.info(`Cleared history for session ${sessionId}`)
}

export function sessionCount(): number {
  return (countSessions.get() as { n: number }).n
}

// ---------- Long-term memory ----------

const upsertMem = db.prepare(`
INSERT INTO memory (key, value, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, kind = excluded.kind, updated_at = excluded.updated_at
`)
const getMem = db.prepare(
  "SELECT id, key, value, kind, created_at as createdAt, updated_at as updatedAt FROM memory WHERE key = ?",
)
const listMem = db.prepare(
  "SELECT id, key, value, kind, created_at as createdAt, updated_at as updatedAt FROM memory ORDER BY updated_at DESC LIMIT ?",
)
const delMem = db.prepare("DELETE FROM memory WHERE key = ?")

export function remember(key: string, value: string, kind: MemoryEntry["kind"] = "fact"): void {
  const now = Date.now()
  upsertMem.run(key, value, kind, now, now)
  bus.emitEvent("MemoryUpdated", { key, kind })
  log.info(`remember(${kind}): ${key}`)
}

export function recall(key: string): MemoryEntry | undefined {
  return getMem.get(key) as MemoryEntry | undefined
}

export function listMemory(limit = 100): MemoryEntry[] {
  return listMem.all(limit) as MemoryEntry[]
}

export function forget(key: string): boolean {
  const res = delMem.run(key)
  if (res.changes > 0) bus.emitEvent("MemoryUpdated", { key, deleted: true })
  return res.changes > 0
}

export function searchMemory(query: string, limit = 20): MemoryEntry[] {
  try {
    const stmt = db.prepare(`
      SELECT m.id, m.key, m.value, m.kind, m.created_at as createdAt, m.updated_at as updatedAt
      FROM memory_fts f JOIN memory m ON m.id = f.rowid
      WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?
    `)
    return stmt.all(sanitizeFts(query), limit) as MemoryEntry[]
  } catch {
    // Fall back to LIKE search when FTS query syntax is invalid.
    const stmt = db.prepare(`
      SELECT id, key, value, kind, created_at as createdAt, updated_at as updatedAt
      FROM memory WHERE key LIKE ? OR value LIKE ? ORDER BY updated_at DESC LIMIT ?
    `)
    const like = `%${query}%`
    return stmt.all(like, like, limit) as MemoryEntry[]
  }
}

function sanitizeFts(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, "")}"`)
    .join(" ")
}

// ---------- Automatic summarization ----------

/**
 * If a session's history grows beyond `threshold` messages, the oldest chunk
 * is summarized by the model and stored as long-term memory, then trimmed.
 */
export async function summarizeIfNeeded(
  sessionId: string,
  summarize: (text: string) => Promise<string>,
  threshold = 60,
): Promise<void> {
  const count = db.prepare("SELECT COUNT(*) as n FROM messages WHERE session_id = ?").get(sessionId) as {
    n: number
  }
  if (count.n <= threshold) return

  const oldest = db
    .prepare("SELECT id, role, content FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT 30")
    .all(sessionId) as { id: number; role: string; content: string }[]

  const text = oldest.map((m) => `${m.role}: ${m.content}`).join("\n").slice(0, 8000)
  try {
    const summary = await summarize(text)
    remember(`summary:${sessionId}:${Date.now()}`, summary, "summary")
    const lastId = oldest[oldest.length - 1].id
    db.prepare("DELETE FROM messages WHERE session_id = ? AND id <= ?").run(sessionId, lastId)
    log.info(`Summarized and trimmed ${oldest.length} messages for ${sessionId}`)
  } catch (err) {
    log.warn(`Summarization failed: ${(err as Error).message}`)
  }
}

export function getDb(): Database.Database {
  return db
}
