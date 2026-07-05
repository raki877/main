# Agent — Full Documentation

A local-first, autonomous AI agent that runs on your own machine. It thinks with an LLM (via OpenRouter), acts through 35+ tools (shell, files, web, desktop, browser automation), remembers things in a local SQLite database, and can be driven from a terminal, a web dashboard, or Telegram.

---

## 1. Quick Reference Table

| Part             | What it is                       | How to use it                                                          | How it works                                                                                     |
| ---------------- | -------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Agent loop**   | The "brain" that plans and acts  | Send a message from terminal / dashboard / Telegram                    | Reads your message → plans steps → calls tools → responds, looping until the task is done        |
| **Tools**        | Actions the agent can take (35+) | Ask in plain language ("open youtube") or call `POST /api/tools/:name` | Each tool has a schema; the model picks one, the registry runs it, result goes back to the model |
| **Memory**       | Long-term storage                | "remember my name is X" / Memory tab                                   | Saved as key/value rows in SQLite, recalled automatically into the prompt                        |
| **Terminal UI**  | Chat in your console             | `pnpm dev:local`, then type                                            | Streams tokens live, supports `/help`, `/tools`, `/memory`, etc.                                 |
| **Dashboard**    | Web control panel                | Open `http://localhost:3000`                                           | Static HTML/JS talking to the REST API + a live WebSocket feed                                   |
| **Telegram bot** | Chat from your phone             | Set `TELEGRAM_BOT_TOKEN`, message the bot                              | Long-polls Telegram, pipes messages through the same agent loop                                  |
| **Skills**       | Reusable instruction packs       | Drop a folder in `skills/`                                             | Hot-loaded `SKILL.md` text injected into the system prompt when relevant                         |
| **Plugins**      | Custom tools you write           | Drop a folder in `plugins/`                                            | Each `.mjs` registers new tools at startup                                                       |
| **Scheduler**    | Timed / recurring tasks          | Jobs tab or `POST /api/jobs`                                           | SQLite-backed job table checked on an interval                                                   |
| **Hotkeys**      | Global keyboard shortcuts        | `bash scripts/install-hotkeys.sh`                                      | Registers GNOME `Ctrl+Alt` shortcuts that hit the API                                            |

---

## 2. Folder Structure — What Lives Where

```
.
├── src/                    # All the agent source code (TypeScript)
│   ├── index.ts            # Entry point — boots everything, parses CLI flags
│   │
│   ├── agent/              # THE BRAIN: the autonomous think→act→observe loop
│   ├── planner/            # Breaks a big request into ordered steps
│   ├── models/             # OpenRouter LLM client (streaming + tool-calling)
│   │
│   ├── tools/              # Everything the agent can DO
│   │   ├── registry.ts     # Central list of tools; runs them + handles confirms
│   │   ├── index.ts        # Registers all built-in tools on startup
│   │   └── builtin/        # The actual tool implementations
│   │       ├── shell.ts       # shell_run, node_eval, python_run, git, clipboard, screenshot
│   │       ├── filesystem.ts  # fs_read/write/list/delete/move/copy/search
│   │       ├── desktop.ts     # open_website, play_youtube, search_site, open_app, close_app, notify  (migrated from main.py)
│   │       ├── web.ts         # http_request, web_search, read_webpage, calculator, json_query, csv_parse
│   │       └── memory.ts      # memory_save / memory_recall / memory_forget
│   │
│   ├── browser/            # Playwright browser-automation tools (goto, click, fill, read, screenshot, tabs)
│   ├── memory/             # SQLite long-term memory store (facts, prefs, history)
│   ├── skills/             # Loads + hot-reloads skill packs from /skills
│   ├── plugins/            # Loads + hot-reloads custom tool plugins from /plugins
│   ├── scheduler/          # SQLite-backed timed/recurring job runner
│   │
│   ├── server/             # REST API + WebSocket + serves the dashboard
│   ├── terminal/           # Interactive console chat UI
│   ├── telegram/           # Telegram bot integration
│   │
│   ├── config/             # Loads .env + config.json, paths (ROOT_DIR, WORKSPACE_DIR)
│   ├── events/             # Internal event bus (glue between subsystems)
│   ├── logger/             # Channel-based logging (stored + streamed to dashboard)
│   ├── status/             # Live system status (uptime, RAM, counts)
│   └── types/              # Shared TypeScript types (Tool, Message, Job, etc.)
│
├── public/                 # The web dashboard (no build step — plain files)
│   ├── index.html          # Dashboard markup + tabs
│   ├── style.css           # Dark terminal-style theme
│   ├── app.js              # Talks to the API, renders chat/tools/memory/logs
│   └── icon*.png / icon.svg# Favicons
│
├── skills/                 # YOUR skill packs (instructions, not code)
│   └── git-helper/
│       ├── skill.json      # Metadata: name, description, triggers
│       └── SKILL.md        # Instructions injected into the prompt
│
├── plugins/                # YOUR custom tools (code)
│   └── dice/
│       ├── plugin.json     # Metadata: name, entry file
│       └── index.mjs       # Registers the `roll_dice` tool
│
├── scripts/
│   └── install-hotkeys.sh  # Installs GNOME global keyboard shortcuts
│
├── tests/
│   └── core.test.ts        # Unit tests (memory, tools, registry, config)
│
├── .env.example            # Copy to .env and fill in your keys
├── package.json            # Scripts + dependencies
├── tsconfig.json           # TypeScript config
├── README.md               # Short getting-started
└── DOCUMENTATION.md         # This file
```

### What kind of information each folder holds

| Folder                           | Type of content                  | You edit it?               |
| -------------------------------- | -------------------------------- | -------------------------- |
| `src/`                           | Core TypeScript logic            | Only to change behavior    |
| `src/tools/builtin/`             | Built-in tool code               | To add/modify native tools |
| `public/`                        | Dashboard UI (HTML/CSS/JS)       | To restyle the dashboard   |
| `skills/`                        | Plain-text instruction packs     | **Yes** — your own skills  |
| `plugins/`                       | Custom tool code (`.mjs`)        | **Yes** — your own tools   |
| `scripts/`                       | Shell setup scripts              | Rarely                     |
| `tests/`                         | Test files                       | To add tests               |
| `.env`                           | Secrets (API keys)               | **Yes** — required         |
| root configs                     | Build/runtime config             | Rarely                     |
| `~/.agent/` (created at runtime) | SQLite DB, logs, workspace files | No — managed automatically |

---

## 3. How To Use It

### 3.1 First-time setup

```bash
pnpm install                 # install dependencies
cp .env.example .env         # create your env file
# edit .env and set at minimum:
#   OPENROUTER_API_KEY=sk-or-...   (get one at openrouter.ai/keys)
```

Optional:

```bash
pnpm exec playwright install chromium   # enables browser_* tools
bash scripts/install-hotkeys.sh         # GNOME global hotkeys
```

### 3.2 Running

| Command          | What it starts                                                           |
| ---------------- | ------------------------------------------------------------------------ |
| `pnpm dev:local` | Terminal UI **+** dashboard **+** Telegram (localhost only) — normal use |
| `pnpm dev`       | Headless, bound to all interfaces (used for the hosted preview)          |
| `pnpm test`      | Runs the unit test suite                                                 |

Then open the dashboard at **http://localhost:3000**.

### 3.3 Ways to talk to the agent

- **Terminal**: just type. Slash commands: `/help`, `/tools`, `/memory`, `/tasks`, `/clear`, `/quit`.
- **Dashboard**: use the **Chat** tab; other tabs show Tools, Memory, Tasks/Jobs, and Logs live.
- **Telegram**: set `TELEGRAM_BOT_TOKEN` (from `@BotFather`), then `/start` the bot and message it.

### 3.4 Example requests

```
open youtube and play lofi hip hop
list the files in my workspace
search the web for the latest node.js LTS version
remember that my github username is octocat
create a file notes.txt with my meeting agenda
take a screenshot
```

### 3.5 Adding your own capabilities

**A skill (instructions only):**

```
skills/my-skill/
  skill.json   → { "name": "my-skill", "description": "...", "triggers": ["keyword"] }
  SKILL.md     → free-form instructions the agent follows
```

**A plugin (a real new tool):**

```
plugins/my-plugin/
  plugin.json  → { "name": "my-plugin", "entry": "index.mjs" }
  index.mjs    → export default (register) => register({ name, description, parameters, execute })
```

Both are picked up automatically on the next start (and hot-reloaded).

---

## 4. How It Works (Architecture)

### 4.1 The request lifecycle

```
You (terminal / dashboard / telegram)
        │  message
        ▼
   Agent loop  ──►  Planner (optional: split into steps)
        │
        ▼
   Model client (OpenRouter)  ──►  returns text OR a tool call
        │
        ├── tool call ──► Tool Registry ──► runs the tool ──► result
        │        ▲                                              │
        │        └──────────── fed back to the model ◄─────────┘
        │
        ▼
   Final answer  ──►  streamed back to you
        │
        ▼
   Memory + Logs + Event bus (dashboard updates live over WebSocket)
```

### 4.2 Key mechanics

- **Tool-calling loop**: the model is given every tool's JSON schema. When it wants to act, it emits a tool call; the registry executes it and returns the output, and the loop repeats until the model produces a final answer.
- **Confirmation for dangerous tools**: tools marked `dangerous` (e.g. `fs_delete`, `close_app`) require explicit confirmation before running. Over the HTTP API, pass `{"confirmDangerous": true}`.
- **Memory**: stored in SQLite under `~/.agent/`. Facts/preferences are pulled into the system prompt so the agent "remembers" across sessions.
- **Event bus**: subsystems don't call each other directly — they emit events (e.g. `tool.run`, `agent.token`, `log`). The server relays these to the dashboard over WebSocket for the live feed.
- **Config resolution**: `.env` → `config.json` → sensible defaults, exposed through `src/config`. Data lives under `WORKSPACE_DIR` / `ROOT_DIR` (default `~/.agent/`).
- **Low idle footprint**: heavy pieces (Playwright browser) are lazy-loaded only when a `browser_*` tool is first used, keeping baseline RAM low.

### 4.3 REST API (served by `src/server`)

| Method & path                                               | Purpose                                   |
| ----------------------------------------------------------- | ----------------------------------------- |
| `GET /api/status`                                           | Uptime, memory usage, counts              |
| `POST /api/chat`                                            | Send a message to the agent               |
| `POST /api/stop`                                            | Stop the current run                      |
| `GET /api/history/:sessionId`                               | Get a conversation                        |
| `DELETE /api/history/:sessionId`                            | Clear a conversation                      |
| `GET /api/memory`                                           | List memory entries                       |
| `POST /api/memory`                                          | Save a memory entry                       |
| `DELETE /api/memory/:key`                                   | Delete a memory entry                     |
| `GET /api/tools`                                            | List all tools                            |
| `POST /api/tools/:name`                                     | Run a tool directly (`{ "args": {...} }`) |
| `GET /api/skills`                                           | List loaded skills                        |
| `GET /api/plugins`                                          | List loaded plugins                       |
| `GET /api/models` / `POST /api/models`                      | Get / switch the active model             |
| `GET /api/config`                                           | Current config                            |
| `GET /api/jobs` / `POST /api/jobs` / `DELETE /api/jobs/:id` | Manage scheduled jobs                     |
| `GET /api/logs`                                             | Recent logs (optionally by channel)       |

Plus a **WebSocket** on the same port that streams tokens, tool activity, and logs to the dashboard in real time.

### 4.4 The 35 built-in tools by category

| Category                     | Tools                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Shell / system**           | `shell_run`, `node_eval`, `python_run`, `git`, `clipboard`, `screenshot`                              |
| **Files**                    | `fs_read`, `fs_write`, `fs_list`, `fs_delete`\*, `fs_move`, `fs_copy`, `fs_search`                    |
| **Desktop** (from `main.py`) | `open_website`, `play_youtube`, `search_site`, `open_app`, `close_app`\*, `notify`                    |
| **Web / data**               | `http_request`, `web_search`, `read_webpage`, `calculator`, `json_query`, `csv_parse`                 |
| **Memory**                   | `memory_save`, `memory_recall`, `memory_forget`                                                       |
| **Browser** (Playwright)     | `browser_goto`, `browser_read`, `browser_click`, `browser_fill`, `browser_screenshot`, `browser_tabs` |
| **Example plugin**           | `roll_dice`                                                                                           |

`*` = dangerous, requires confirmation.

---

## 5. Troubleshooting

| Symptom                                            | Fix                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Agent doesn't respond / errors on chat             | `OPENROUTER_API_KEY` missing or invalid in `.env`                                     |
| `browser_*` tools fail                             | Run `pnpm exec playwright install chromium`                                           |
| `open_app` / `screenshot` / `clipboard` don't work | Linux desktop utilities needed (`xclip`, `wmctrl`, `notify-send`, `gnome-screenshot`) |
| Telegram bot silent                                | `TELEGRAM_BOT_TOKEN` not set, or you didn't `/start` the bot                          |
| Hotkeys not firing                                 | Re-run `bash scripts/install-hotkeys.sh` (GNOME only)                                 |
| Dashboard blank                                    | Make sure the server is running and open `http://localhost:3000`                      |

---

## 6. Requirements

- **Node.js 18+** and **pnpm**
- An **OpenRouter API key** (required for the agent to think)
- **Linux desktop** for the desktop/hotkey tools (GNOME assumed for notifications/hotkeys)
- Optional: **Chromium** via Playwright for browser automation, **Telegram bot token** for phone access
