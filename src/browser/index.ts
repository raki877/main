import path from "node:path"
import { DATA_DIR, getConfig } from "../config/index.js"
import { createLogger } from "../logger/index.js"
import type { ToolDefinition } from "../types/index.js"

const log = createLogger("tools")

/**
 * Playwright-powered browser automation.
 * The browser is lazy-launched on first use and auto-closed after idle
 * timeout to keep RAM under control on the 8GB target machine.
 */

type PlaywrightModule = typeof import("playwright-core")
type Browser = import("playwright-core").Browser
type BrowserContext = import("playwright-core").BrowserContext
type Page = import("playwright-core").Page

let browser: Browser | null = null
let context: BrowserContext | null = null
const pages = new Map<string, Page>()
let idleTimer: NodeJS.Timeout | null = null

const IDLE_CLOSE_MS = 5 * 60 * 1000

function touchIdle(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    void closeBrowser()
  }, IDLE_CLOSE_MS)
}

async function getContext(): Promise<BrowserContext> {
  if (context) {
    touchIdle()
    return context
  }
  const cfg = getConfig()
  const pw: PlaywrightModule = await import("playwright-core")
  const engine = cfg.browser.engine === "firefox" ? pw.firefox : pw.chromium

  if (cfg.browser.persistSession) {
    context = await engine.launchPersistentContext(path.join(DATA_DIR, "browser-profile"), {
      headless: cfg.browser.headless,
      channel: cfg.browser.engine === "chrome" ? "chrome" : undefined,
      viewport: { width: 1280, height: 800 },
    })
  } else {
    browser = await engine.launch({
      headless: cfg.browser.headless,
      channel: cfg.browser.engine === "chrome" ? "chrome" : undefined,
    })
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  }
  log.info(`Browser launched (${cfg.browser.engine}, headless=${cfg.browser.headless})`)
  touchIdle()
  return context
}

async function getPage(tabId = "main"): Promise<Page> {
  const ctx = await getContext()
  let page = pages.get(tabId)
  if (!page || page.isClosed()) {
    page = await ctx.newPage()
    pages.set(tabId, page)
  }
  touchIdle()
  return page
}

export async function closeBrowser(): Promise<void> {
  try {
    pages.clear()
    await context?.close()
    await browser?.close()
  } catch {
    /* already closed */
  }
  context = null
  browser = null
  if (idleTimer) clearTimeout(idleTimer)
  log.info("Browser closed (idle)")
}

export const browserTools: ToolDefinition[] = [
  {
    name: "browser_goto",
    description:
      "Navigate the automated browser to a URL and return the page title. Use tabId to manage multiple tabs.",
    category: "browser",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        tabId: { type: "string", description: "Tab identifier, default 'main'" },
      },
      required: ["url"],
    },
    execute: async (args) => {
      const page = await getPage(String(args.tabId || "main"))
      await page.goto(String(args.url), { waitUntil: "domcontentloaded", timeout: 30_000 })
      return { title: await page.title(), url: page.url() }
    },
  },
  {
    name: "browser_read",
    description: "Extract the visible text content of the current page (truncated to 15000 chars).",
    category: "browser",
    parameters: {
      type: "object",
      properties: { tabId: { type: "string" } },
    },
    execute: async (args) => {
      const page = await getPage(String(args.tabId || "main"))
      // Evaluated in the browser page context, where `document` exists.
      const text = (await page.evaluate("document.body ? document.body.innerText : ''")) as string
      return { url: page.url(), text: text.slice(0, 15_000), truncated: text.length > 15_000 }
    },
  },
  {
    name: "browser_click",
    description: "Click an element on the page identified by a CSS selector or visible text.",
    category: "browser",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector (optional if text given)" },
        text: { type: "string", description: "Visible text of element to click (optional)" },
        tabId: { type: "string" },
      },
    },
    execute: async (args) => {
      const page = await getPage(String(args.tabId || "main"))
      if (args.selector) {
        await page.click(String(args.selector), { timeout: 10_000 })
      } else if (args.text) {
        await page.getByText(String(args.text), { exact: false }).first().click({ timeout: 10_000 })
      } else {
        throw new Error("Provide selector or text")
      }
      await page.waitForLoadState("domcontentloaded").catch(() => {})
      return { clicked: true, url: page.url() }
    },
  },
  {
    name: "browser_fill",
    description: "Fill a form field (input/textarea) with a value using a CSS selector or label.",
    category: "browser",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string" },
        label: { type: "string", description: "Field label text (alternative to selector)" },
        value: { type: "string" },
        pressEnter: { type: "boolean" },
        tabId: { type: "string" },
      },
      required: ["value"],
    },
    execute: async (args) => {
      const page = await getPage(String(args.tabId || "main"))
      if (args.selector) {
        await page.fill(String(args.selector), String(args.value), { timeout: 10_000 })
      } else if (args.label) {
        await page.getByLabel(String(args.label)).fill(String(args.value), { timeout: 10_000 })
      } else {
        throw new Error("Provide selector or label")
      }
      if (args.pressEnter) await page.keyboard.press("Enter")
      return { filled: true }
    },
  },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of the current browser page and save it into the workspace.",
    category: "browser",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Default page.png" },
        fullPage: { type: "boolean" },
        tabId: { type: "string" },
      },
    },
    execute: async (args, ctx) => {
      const page = await getPage(String(args.tabId || "main"))
      const file = path.join(ctx.workspaceDir, String(args.filename || "page.png"))
      await page.screenshot({ path: file, fullPage: Boolean(args.fullPage) })
      return { saved: file }
    },
  },
  {
    name: "browser_tabs",
    description: "List open browser tabs, or close a tab by id.",
    category: "browser",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "close"] },
        tabId: { type: "string" },
      },
      required: ["action"],
    },
    execute: async (args) => {
      if (args.action === "close" && args.tabId) {
        const page = pages.get(String(args.tabId))
        if (page) {
          await page.close()
          pages.delete(String(args.tabId))
          return { closed: String(args.tabId) }
        }
        return { closed: null }
      }
      const list = [...pages.entries()]
        .filter(([, p]) => !p.isClosed())
        .map(([id, p]) => ({ tabId: id, url: p.url() }))
      return { tabs: list }
    },
  },
]
