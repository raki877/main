/**
 * Example Nova Agent plugin.
 * Default-export a function that receives the PluginApi.
 * Edit this file while the agent runs — it hot-reloads automatically.
 */
export default function init(api) {
  api.registerTool({
    name: "roll_dice",
    description: "Roll one or more dice. Returns the individual rolls and the total.",
    category: "fun",
    parameters: {
      type: "object",
      properties: {
        sides: { type: "number", description: "Number of sides per die (default 6)" },
        count: { type: "number", description: "Number of dice to roll (default 1)" },
      },
    },
    async execute(args) {
      const sides = Math.max(2, Number(args.sides) || 6)
      const count = Math.min(100, Math.max(1, Number(args.count) || 1))
      const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides))
      return { rolls, total: rolls.reduce((a, b) => a + b, 0) }
    },
  })

  api.on("TaskCompleted", () => api.log("a task finished"))
  api.log("dice plugin loaded")
}
