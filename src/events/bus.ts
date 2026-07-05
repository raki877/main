import { EventEmitter } from "node:events"
import type { AgentEvent } from "../types/index.js"

/**
 * Global typed event bus. Every subsystem (agent, tools, memory, plugins,
 * websocket, telegram) communicates through this bus so they stay decoupled.
 */
class Bus extends EventEmitter {
  emitEvent(event: AgentEvent, payload: unknown = {}): void {
    this.emit(event, payload)
    // Also emit a wildcard so the websocket layer can fan everything out.
    this.emit("*", { event, payload, ts: Date.now() })
  }

  onEvent(event: AgentEvent | "*", handler: (payload: unknown) => void): void {
    this.on(event, handler)
  }

  offEvent(event: AgentEvent | "*", handler: (payload: unknown) => void): void {
    this.off(event, handler)
  }
}

export const bus = new Bus()
bus.setMaxListeners(100)
