import { spawn, exec } from "node:child_process"
import { promisify } from "node:util"
import type { ToolDefinition } from "../../types/index.js"
import { complete } from "../../models/openrouter.js"

const execAsync = promisify(exec)

/**
 * Desktop tools migrated from the original Python assistant (main.py):
 *  - website resolution pipeline (known list -> domain -> guess -> AI -> search)
 *  - YouTube direct playback (scrape first video id)
 *  - site-specific search shortcuts
 *  - application launching and closing (Linux / GNOME)
 */

const HTTP_UA = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
}

export const KNOWN_WEBSITES: Record<string, string> = {
  youtube: "https://www.youtube.com",
  google: "https://www.google.com",
  github: "https://www.github.com",
  gmail: "https://mail.google.com",
  chatgpt: "https://chatgpt.com",
  wikipedia: "https://www.wikipedia.org",
  reddit: "https://www.reddit.com",
  twitter: "https://twitter.com",
  x: "https://x.com",
  facebook: "https://www.facebook.com",
  instagram: "https://www.instagram.com",
  linkedin: "https://www.linkedin.com",
  stackoverflow: "https://stackoverflow.com",
  amazon: "https://www.amazon.com",
  netflix: "https://www.netflix.com",
  "spotify web": "https://open.spotify.com",
  twitch: "https://www.twitch.tv",
  whatsapp: "https://web.whatsapp.com",
  maps: "https://maps.google.com",
  "google maps": "https://maps.google.com",
  drive: "https://drive.google.com",
  translate: "https://translate.google.com",
  news: "https://news.google.com",
  "hacker news": "https://news.ycombinator.com",
  duckduckgo: "https://duckduckgo.com",
  bing: "https://www.bing.com",
  quora: "https://www.quora.com",
  pinterest: "https://www.pinterest.com",
  medium: "https://medium.com",
  notion: "https://www.notion.so",
  figma: "https://www.figma.com",
  canva: "https://www.canva.com",
  leetcode: "https://leetcode.com",
  geeksforgeeks: "https://www.geeksforgeeks.org",
  w3schools: "https://www.w3schools.com",
  mdn: "https://developer.mozilla.org",
  vercel: "https://vercel.com",
  flipkart: "https://www.flipkart.com",
  hotstar: "https://www.hotstar.com",
  "prime video": "https://www.primevideo.com",
  "telegram web": "https://web.telegram.org",
}

export const SEARCH_SITES: Record<string, { label: string; template: string }> = {
  google: { label: "Google", template: "https://www.google.com/search?q={q}" },
  youtube: { label: "YouTube", template: "https://www.youtube.com/results?search_query={q}" },
  bing: { label: "Bing", template: "https://www.bing.com/search?q={q}" },
  duckduckgo: { label: "DuckDuckGo", template: "https://duckduckgo.com/?q={q}" },
  wikipedia: { label: "Wikipedia", template: "https://en.wikipedia.org/w/index.php?search={q}" },
  amazon: { label: "Amazon", template: "https://www.amazon.in/s?k={q}" },
  flipkart: { label: "Flipkart", template: "https://www.flipkart.com/search?q={q}" },
  github: { label: "GitHub", template: "https://github.com/search?q={q}" },
  stackoverflow: { label: "Stack Overflow", template: "https://stackoverflow.com/search?q={q}" },
  reddit: { label: "Reddit", template: "https://www.reddit.com/search/?q={q}" },
  x: { label: "Twitter/X", template: "https://x.com/search?q={q}" },
  spotify: { label: "Spotify", template: "https://open.spotify.com/search/{q}" },
  maps: { label: "Google Maps", template: "https://www.google.com/maps/search/{q}" },
  images: { label: "Google Images", template: "https://www.google.com/search?tbm=isch&q={q}" },
  news: { label: "Google News", template: "https://news.google.com/search?q={q}" },
  ebay: { label: "eBay", template: "https://www.ebay.com/sch/i.html?_nkw={q}" },
}

const APP_MAPPINGS: Record<string, string[]> = {
  chrome: ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"],
  firefox: ["firefox", "firefox-esr"],
  brave: ["brave-browser", "brave"],
  opera: ["opera"],
  edge: ["microsoft-edge", "microsoft-edge-stable", "msedge"],
  calculator: ["gnome-calculator", "kcalc"],
  terminal: ["gnome-terminal", "xterm", "konsole"],
  files: ["nautilus", "dolphin", "thunar"],
  "vs code": ["code"],
  vscode: ["code"],
  code: ["code"],
  "text editor": ["gedit", "gnome-text-editor", "kate"],
  vlc: ["vlc"],
  spotify: ["spotify"],
  discord: ["discord"],
  "telegram desktop": ["telegram-desktop", "Telegram"],
  settings: ["gnome-control-center"],
}

const siteCache = new Map<string, { url: string; how: string }>()

function popenDetached(cmd: string[], extraEnv: Record<string, string> = {}): void {
  const child = spawn(cmd[0], cmd.slice(1), {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ":0", ...extraEnv },
  })
  child.unref()
}

async function which(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`which ${JSON.stringify(bin)}`)
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function urlIsAlive(url: string, timeoutMs = 4000): Promise<boolean> {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    const res = await fetch(url, { method: "HEAD", headers: HTTP_UA, redirect: "follow", signal: ctl.signal })
    clearTimeout(timer)
    return res.status < 400
  } catch {
    return false
  }
}

export async function resolveWebsite(name: string): Promise<{ url: string; how: string }> {
  const key = name.toLowerCase().trim()
  const cached = siteCache.get(key)
  if (cached) return cached

  if (KNOWN_WEBSITES[key]) {
    const r = { url: KNOWN_WEBSITES[key], how: "known" }
    siteCache.set(key, r)
    return r
  }
  if (/^https?:\/\//.test(key)) return { url: name.trim(), how: "direct" }
  if (/^[\w.-]+\.(com|org|net|io|in|co|dev|app|ai|edu|gov|tv|me)(\/.*)?$/.test(key)) {
    const r = { url: `https://${key}`, how: "domain" }
    siteCache.set(key, r)
    return r
  }

  const slug = key.replace(/[^a-z0-9]/g, "")
  if (slug) {
    for (const candidate of [
      `https://www.${slug}.com`,
      `https://${slug}.com`,
      `https://www.${slug}.org`,
      `https://${slug}.io`,
      `https://${slug}.in`,
    ]) {
      if (await urlIsAlive(candidate)) {
        const r = { url: candidate, how: "guessed" }
        siteCache.set(key, r)
        return r
      }
    }
  }

  // Ask the model for the official URL.
  try {
    const result = await complete(
      [
        {
          role: "system",
          content:
            "You resolve website names to their official homepage URL. Reply with ONLY the full https URL, nothing else. If unknown, reply exactly: UNKNOWN",
        },
        { role: "user", content: `Official homepage URL of: ${name}` },
      ],
      { maxTokens: 60 },
    )
    const match = result.content.match(/https?:\/\/[^\s"'<>)]+/)
    if (match) {
      const url = match[0].replace(/[.,;]+$/, "")
      if (await urlIsAlive(url)) {
        const r = { url, how: "ai" }
        siteCache.set(key, r)
        return r
      }
    }
  } catch {
    /* fall through to search */
  }

  return { url: `https://www.google.com/search?q=${encodeURIComponent(name)}`, how: "search" }
}

export async function getFirstYouTubeVideo(query: string): Promise<{ url: string; title: string } | null> {
  try {
    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
      headers: HTTP_UA,
    })
    if (!res.ok) return null
    const html = await res.text()
    const match = html.match(/"videoRenderer":\{"videoId":"([\w-]{11})".*?"title":\{"runs":\[\{"text":"(.*?)"\}/)
    if (match) {
      return { url: `https://www.youtube.com/watch?v=${match[1]}`, title: match[2] }
    }
    const simple = html.match(/"videoId":"([\w-]{11})"/)
    if (simple) return { url: `https://www.youtube.com/watch?v=${simple[1]}`, title: query }
  } catch {
    /* ignore */
  }
  return null
}

async function openUrl(url: string, browser?: string): Promise<string> {
  if (browser) {
    for (const bin of APP_MAPPINGS[browser.toLowerCase()] ?? [browser]) {
      const found = await which(bin)
      if (found) {
        popenDetached([found, url])
        return `Opened ${url} in ${browser}`
      }
    }
  }
  popenDetached(["xdg-open", url])
  return `Opened ${url} in default browser${browser ? ` ('${browser}' not found)` : ""}`
}

export const desktopTools: ToolDefinition[] = [
  {
    name: "open_website",
    description:
      "Open any website by name or URL in the user's browser. Resolves names like 'youtube', 'hacker news', or arbitrary sites to real URLs automatically.",
    category: "desktop",
    parameters: {
      type: "object",
      properties: {
        site: { type: "string", description: "Website name or URL" },
        browser: { type: "string", description: "Optional browser: chrome, firefox, brave, edge, opera" },
      },
      required: ["site"],
    },
    execute: async (args) => {
      const { url, how } = await resolveWebsite(String(args.site))
      const msg = await openUrl(url, args.browser ? String(args.browser) : undefined)
      return { url, resolvedVia: how, message: msg }
    },
  },
  {
    name: "play_youtube",
    description:
      "Play a song or video on YouTube: finds the first matching video and opens it directly so it plays immediately.",
    category: "desktop",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Song or video to play" },
        browser: { type: "string", description: "Optional browser name" },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const query = String(args.query)
      const video = await getFirstYouTubeVideo(query)
      if (video) {
        const msg = await openUrl(video.url, args.browser ? String(args.browser) : undefined)
        return { playing: video.title, url: video.url, message: msg }
      }
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
      const msg = await openUrl(searchUrl, args.browser ? String(args.browser) : undefined)
      return { playing: null, url: searchUrl, message: `Couldn't auto-play; opened results. ${msg}` }
    },
  },
  {
    name: "search_site",
    description:
      "Search a query directly on a specific site (google, youtube, amazon, github, wikipedia, maps, images, news, reddit, etc.) and open the results in the browser.",
    category: "desktop",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        site: { type: "string", description: "Site key, default google" },
        browser: { type: "string" },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const siteKey = String(args.site || "google").toLowerCase()
      const site = SEARCH_SITES[siteKey] ?? SEARCH_SITES.google
      const url = site.template.replace("{q}", encodeURIComponent(String(args.query)))
      const msg = await openUrl(url, args.browser ? String(args.browser) : undefined)
      return { site: site.label, url, message: msg }
    },
  },
  {
    name: "open_app",
    description:
      "Launch a desktop application on the Linux host (chrome, firefox, vs code, calculator, terminal, files, vlc, spotify, discord, settings...).",
    category: "desktop",
    parameters: {
      type: "object",
      properties: { app: { type: "string", description: "Application name" } },
      required: ["app"],
    },
    execute: async (args) => {
      const app = String(args.app).toLowerCase().trim()
      const candidates = APP_MAPPINGS[app] ?? [app]
      for (const bin of candidates) {
        const found = await which(bin)
        if (found) {
          popenDetached([found])
          return { launched: bin }
        }
      }
      // Not installed locally: open its website instead (main.py behavior).
      const { url } = await resolveWebsite(app)
      const msg = await openUrl(url)
      return { launched: null, fallback: url, message: `'${app}' not installed; ${msg}` }
    },
  },
  {
    name: "close_app",
    description: "Close a running application by name (uses pkill/wmctrl). Requires confirmation.",
    category: "desktop",
    dangerous: true,
    parameters: {
      type: "object",
      properties: { app: { type: "string" } },
      required: ["app"],
    },
    execute: async (args) => {
      const app = String(args.app).toLowerCase().trim()
      const candidates = APP_MAPPINGS[app] ?? [app]
      for (const bin of candidates) {
        try {
          await execAsync(`pkill -f ${JSON.stringify(bin)}`)
          return { closed: bin }
        } catch {
          /* try next candidate */
        }
      }
      throw new Error(`No running process matched '${app}'`)
    },
  },
  {
    name: "notify",
    description: "Show a desktop notification (notify-send on GNOME).",
    category: "desktop",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["title"],
    },
    execute: async (args) => {
      await execAsync(
        `notify-send ${JSON.stringify(String(args.title))} ${JSON.stringify(String(args.body ?? ""))}`,
        { env: { ...process.env, DISPLAY: process.env.DISPLAY || ":0" } },
      )
      return { shown: true }
    },
  },
]
