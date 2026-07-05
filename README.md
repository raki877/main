# Nova Agent

OpenClaw-inspired autonomous AI agent for your Linux laptop. One lightweight Node.js
process runs everything: terminal UI, localhost dashboard, REST API, WebSocket
event stream, Telegram bot, scheduler, skills, plugins, and browser automation.

## Quick start

```bash
pnpm install                 # or npm install
cp .env.example .env         # add your OPENROUTER_API_KEY
pnpm dev:local               # interactive terminal + dashboard at http://localhost:3000
```

For production (lowest RAM):

```bash
pnpm build
pnpm start                   # terminal UI + server
node dist/index.js --headless   # server only (background/systemd)
```

## Interfaces

| Interface | How |
|---|---|
| Terminal | `pnpm start`, then type tasks or `/help` |
| Dashboard | http://localhost:3000 (chat, status, memory, tools, jobs) |
| REST API | `POST /api/chat {"message":"..."}`, `GET /api/status`, `/api/memory`, `/api/tools`, `/api/jobs`, `/api/logs`, `/api/models`, `/api/config` |
| WebSocket | `ws://localhost:3000/ws` — send `{"type":"chat","message":"..."}`; receive all agent events (Token, ToolStarted, PlanUpdated, ...) |
| Telegram | Set `TELEGRAM_TOKEN` in `.env`; restrict access with `telegram.allowedChatIds` in `config/config.json` |

## The agent loop

Think → Plan (for multi-step tasks) → Act (tool calls) → Observe → Reflect → Continue/Finish.
The agent retries failures with different approaches, streams tokens live, and
saves important facts to long-term memory (SQLite with full-text search).

## Tools (35 built-in)

- **system**: run shell commands, processes, packages
- **files**: read, write, list, search files (workspace-sandboxed by default)
- **desktop**: open apps/websites, play YouTube music, search sites, close apps, clipboard, notifications, screenshots (migrated from the original Python assistant)
- **web**: HTTP requests, web search, page fetch
- **browser**: Playwright automation — navigate, read, click, fill, screenshot (lazy-loaded; ~0 RAM until first use). Requires `npx playwright install chromium` once, or set `browser.engine` to `"chrome"` in config to use your system Chrome.
- **memory**: save/recall/search long-term facts
- **code**: run Node.js snippets

Dangerous tools (shell, file deletion) ask for confirmation first. Configure in
`config/config.json` under `security`.

## Skills

Drop a folder into `skills/<name>/` containing `skill.json` (with `keywords`) and
`SKILL.md` (instructions). When a user message matches the keywords, the skill's
instructions are injected into the agent's prompt. Hot-reloads on change. See
`skills/git-helper/` for an example.

## Plugins

Drop a folder into `plugins/<name>/` containing `plugin.json` and an ES module
that default-exports `(api) => { api.registerTool({...}) }`. Plugins can register
new tools and subscribe to events. Hot-reloads on change. See `plugins/dice/`.

## Scheduler

Schedule recurring agent tasks from any interface:

- Terminal: `/schedule morning-brief | daily 08:30 | Summarize my day and check the weather`
- Telegram: `/schedule check-site | every 60 | Fetch https://mysite.com and alert me if it is down`
- Dashboard: Jobs tab

## Global hotkeys (GNOME / Ubuntu)

```bash
bash scripts/install-hotkeys.sh
```

Ctrl+Alt+A start, Ctrl+Alt+S stop current run, Ctrl+Alt+R restart,
Ctrl+Alt+T terminal, Ctrl+Alt+L dashboard. Zero extra RAM (uses GNOME keybindings).

## Configuration

`config/config.json` is created on first run: model, fallback models, temperature,
max iterations, port, telegram allowlist, browser engine/headless, logging levels,
security (dangerous-tool confirmation, blocked commands).

Model can be switched at runtime from every interface (`/model`, dashboard
dropdown, `POST /api/models`).

## Run at startup (systemd)

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/nova-agent.service <<EOF
[Unit]
Description=Nova Agent
[Service]
WorkingDirectory=%h/nova-agent
ExecStart=$(command -v node) dist/index.js --headless
Restart=on-failure
[Install]
WantedBy=default.target
EOF
systemctl --user enable --now nova-agent
```

## Layout

```
src/
  agent/      autonomous loop (think-plan-act-observe-reflect)
  planner/    multi-step task planning
  models/     OpenRouter client (streaming, tools, fallbacks)
  tools/      registry + built-in tools
  browser/    Playwright automation (lazy)
  memory/     SQLite: history, long-term memory, FTS, summarization
  skills/     skill loader + hot reload
  plugins/    plugin loader + hot reload
  scheduler/  SQLite-backed job scheduler
  server/     Express REST API + WebSocket + dashboard hosting
  terminal/   readline REPL with slash commands
  telegram/   grammY bot
public/       dashboard SPA (no build step)
skills/       your skills
plugins/      your plugins
workspace/    agent's sandboxed working directory
logs/         rotating channel logs
data/         SQLite database
```

## Resource usage

Idle: ~150 MB RAM, <1% CPU. The browser is only launched when a browser tool is
first used and can be closed by the agent afterwards.
# main
