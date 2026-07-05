import { registerTool } from "./registry.js"
import { shellTools } from "./builtin/shell.js"
import { fsTools } from "./builtin/filesystem.js"
import { desktopTools } from "./builtin/desktop.js"
import { webTools } from "./builtin/web.js"
import { memoryTools } from "./builtin/memory.js"
import { browserTools } from "../browser/index.js"
import { createLogger } from "../logger/index.js"

const log = createLogger("tools")

export function loadBuiltinTools(): void {
  const all = [...shellTools, ...fsTools, ...desktopTools, ...webTools, ...memoryTools, ...browserTools]
  for (const tool of all) registerTool(tool)
  log.info(`Registered ${all.length} builtin tools`)
}

export * from "./registry.js"
