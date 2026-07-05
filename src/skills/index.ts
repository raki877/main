import fs from "node:fs"
import path from "node:path"
import chokidar from "chokidar"
import { SKILLS_DIR } from "../config/index.js"
import { bus } from "../events/bus.js"
import { createLogger } from "../logger/index.js"
import type { LoadedSkill, SkillManifest } from "../types/index.js"

const log = createLogger("system")

/**
 * OpenClaw-style skills. Each skill lives in skills/<name>/ and contains:
 *   - skill.json  (manifest: name, version, description, keywords, priority...)
 *   - SKILL.md    (instructions injected into the system prompt when relevant)
 * Skills are discovered at startup and hot-reloaded on change.
 * Nested skills (skills/<parent>/<child>/) are supported.
 */

const skills = new Map<string, LoadedSkill>()

function loadSkillDir(dir: string): void {
  const manifestPath = path.join(dir, "skill.json")
  const mdPath = path.join(dir, "SKILL.md")
  if (!fs.existsSync(manifestPath)) return

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as SkillManifest
    if (manifest.enabled === false) {
      skills.delete(manifest.name)
      return
    }
    const instructions = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, "utf-8") : ""
    skills.set(manifest.name, { manifest, dir, instructions })
    bus.emitEvent("SkillLoaded", { name: manifest.name, version: manifest.version })
    log.info(`Skill loaded: ${manifest.name}@${manifest.version}`)
  } catch (err) {
    log.error(`Failed to load skill at ${dir}: ${(err as Error).message}`)
  }
}

function scanSkills(root: string, depth = 0): void {
  if (depth > 2) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const dir = path.join(root, e.name)
    loadSkillDir(dir)
    scanSkills(dir, depth + 1) // nested skills
  }
}

export function loadSkills(): void {
  skills.clear()
  scanSkills(SKILLS_DIR)
  log.info(`Loaded ${skills.size} skills`)
}

export function watchSkills(): void {
  const watcher = chokidar.watch(SKILLS_DIR, {
    ignoreInitial: true,
    depth: 3,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
  })
  watcher.on("all", () => {
    log.info("Skill change detected, reloading skills")
    loadSkills()
  })
}

export function listSkills(): LoadedSkill[] {
  return [...skills.values()].sort((a, b) => (b.manifest.priority ?? 0) - (a.manifest.priority ?? 0))
}

export function skillCount(): number {
  return skills.size
}

/**
 * Return instructions from skills whose keywords match the user's input.
 * The agent automatically decides to apply relevant skills this way.
 */
export function getSkillInstructionsFor(input: string): string {
  const lower = input.toLowerCase()
  const matched = listSkills().filter((s) => {
    const kws = s.manifest.keywords ?? []
    return kws.some((k) => lower.includes(k.toLowerCase()))
  })
  if (matched.length === 0) return ""
  const blocks = matched
    .slice(0, 3)
    .map((s) => `## Skill: ${s.manifest.name}\n${s.instructions.slice(0, 2000)}`)
    .join("\n\n")
  return `\n\nApplicable skills:\n${blocks}`
}
