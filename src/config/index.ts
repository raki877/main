import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const CONFIG_DIR = path.join(ROOT_DIR, "config");
export const LOGS_DIR = path.join(ROOT_DIR, "logs");
export const WORKSPACE_DIR = path.join(ROOT_DIR, "workspace");
export const SKILLS_DIR = path.join(ROOT_DIR, "skills");
export const PLUGINS_DIR = path.join(ROOT_DIR, "plugins");
export const DATA_DIR = path.join(ROOT_DIR, "data");

for (const dir of [
  CONFIG_DIR,
  LOGS_DIR,
  WORKSPACE_DIR,
  SKILLS_DIR,
  PLUGINS_DIR,
  DATA_DIR,
]) {
  fs.mkdirSync(dir, { recursive: true });
}

const ConfigSchema = z.object({
  model: z.string().default("openai/gpt-4o-mini"),
  fallbackModels: z
    .array(z.string())
    .default(["deepseek/deepseek-chat", "meta-llama/llama-3.3-70b-instruct"]),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().default(256),
  maxIterations: z.number().default(12),
  port: z.number().default(3000),
  openDashboardOnStart: z.boolean().default(true),
  telegram: z
    .object({
      enabled: z.boolean().default(true),
      allowedChatIds: z.array(z.number()).default([]),
    })
    .default({ enabled: true, allowedChatIds: [] }),
  browser: z
    .object({
      engine: z.enum(["chromium", "firefox", "chrome"]).default("chromium"),
      headless: z.boolean().default(true),
      persistSession: z.boolean().default(true),
    })
    .default({ engine: "chromium", headless: true, persistSession: true }),
  voice: z
    .object({
      enabled: z.boolean().default(false),
      piperModel: z.string().default(""),
      wakeWord: z.string().default("nova"),
    })
    .default({ enabled: false, piperModel: "", wakeWord: "nova" }),
  hotkeys: z
    .object({
      enabled: z.boolean().default(false),
      start: z.string().default("ctrl+alt+a"),
      stop: z.string().default("ctrl+alt+s"),
      restart: z.string().default("ctrl+alt+r"),
      terminal: z.string().default("ctrl+alt+t"),
      dashboard: z.string().default("ctrl+alt+l"),
    })
    .default({
      enabled: false,
      start: "ctrl+alt+a",
      stop: "ctrl+alt+s",
      restart: "ctrl+alt+r",
      terminal: "ctrl+alt+t",
      dashboard: "ctrl+alt+l",
    }),
  logging: z
    .object({
      level: z.enum(["debug", "info", "warn", "error"]).default("info"),
      maxFileSizeMb: z.number().default(5),
      maxFiles: z.number().default(3),
    })
    .default({ level: "info", maxFileSizeMb: 5, maxFiles: 3 }),
  security: z
    .object({
      confirmDangerous: z.boolean().default(true),
      blockedCommands: z
        .array(z.string())
        .default(["rm -rf /", "mkfs", ":(){ :|:& };:"]),
    })
    .default({
      confirmDangerous: true,
      blockedCommands: ["rm -rf /", "mkfs", ":(){ :|:& };:"],
    }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function loadConfigFile(): AppConfig {
  let raw: Record<string, unknown> = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    } catch {
      console.error("[config] Invalid config.json, using defaults");
    }
  }
  const parsed = ConfigSchema.safeParse(raw);
  const cfg = parsed.success ? parsed.data : ConfigSchema.parse({});
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  }
  return cfg;
}

let config: AppConfig = loadConfigFile();

export function getConfig(): AppConfig {
  return config;
}

export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  config = ConfigSchema.parse({ ...config, ...patch });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  return config;
}

export const env = {
  openRouterKey: process.env.OPENROUTER_API_KEY ?? "",
  telegramToken: process.env.TELEGRAM_TOKEN ?? "",
  port: Number(process.env.PORT ?? "") || undefined,
};
