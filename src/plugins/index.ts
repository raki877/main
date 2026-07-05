import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import chokidar from "chokidar"
import { PLUGINS_DIR } from "../config/index.js"
import { bus } from "../events/bus.js"
import { createLogger } from "../logger/index.js"
import { registerTool, unregisterTool } from "../tools/registry.js"
import type { LoadedPlugin, PluginApi, PluginManifest, ToolDefinition } from "../types/index.js"

const log = createLogger("system")

/**
 * Plugin system. Each plugin lives in plugins/<name>/ with:
 *   - plugin.json (manifest: name, version, description, main, permissions)
 *   - <main>.mjs / .js  (default-exports a function receiving PluginApi)
 * Plugins can register tools and subscribe to agent events.
 * Hot reload: on file change the plugin's tools are unregistered and it is re-imported.
 */

const plugins = new Map<string, LoadedPlugin>()
const pluginTools = new Map<string, string[]>() // plugin name -> tool names

async function loadPluginDir(dir: string): Promise<void> {
  const manifestPath = path.join(dir, "plugin.json")
  if (!fs.existsSync(manifestPath)) return

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as PluginManifest
    if (manifest.enabled === false) return

    // Unregister previous tools for hot reload.
    for (const toolName of pluginTools.get(manifest.name) ?? []) unregisterTool(toolName)
    const registered: string[] = []

    const mainPath = path.join(dir, manifest.main)
    if (!fs.existsSync(mainPath)) throw new Error(`main file not found: ${manifest.main}`)

    const api: PluginApi = {
      registerTool: (tool: ToolDefinition) => {
        registerTool(tool)
        registered.push(tool.name)
      },
      on: (event, handler) => bus.on(event, handler),
      log: (msg) => log.info(`[plugin:${manifest.name}] ${msg}`),
      config: {},
    }

    // Cache-bust the import for hot reload.
    const mod = await import(`${pathToFileURL(mainPath).href}?t=${Date.now()}`)
    const init = mod.default
    if (typeof init === "function") await init(api)

    plugins.set(manifest.name, { manifest, dir })
    pluginTools.set(manifest.name, registered)
    bus.emitEvent("PluginLoaded", { name: manifest.name, version: manifest.version, tools: registered })
    log.info(`Plugin loaded: ${manifest.name}@${manifest.version} (${registered.length} tools)`)
  } catch (err) {
    log.error(`Failed to load plugin at ${dir}: ${(err as Error).message}`)
  }
}

export async function loadPlugins(): Promise<void> {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.isDirectory()) await loadPluginDir(path.join(PLUGINS_DIR, e.name))
  }
  log.info(`Loaded ${plugins.size} plugins`)
}

export function watchPlugins(): void {
  const watcher = chokidar.watch(PLUGINS_DIR, {
    ignoreInitial: true,
    depth: 2,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
  })
  watcher.on("all", (_event, file) => {
    const rel = path.relative(PLUGINS_DIR, file)
    const pluginName = rel.split(path.sep)[0]
    if (pluginName) {
      log.info(`Plugin change detected in ${pluginName}, reloading`)
      void loadPluginDir(path.join(PLUGINS_DIR, pluginName))
    }
  })
}

export function listPlugins(): LoadedPlugin[] {
  return [...plugins.values()]
}

export function pluginCount(): number {
  return plugins.size
}
