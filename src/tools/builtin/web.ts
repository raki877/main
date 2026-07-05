import type { ToolDefinition } from "../../types/index.js"

/**
 * Network + data tools: HTTP requests, web search (DuckDuckGo HTML),
 * calculator, JSON/CSV helpers.
 */

export const webTools: ToolDefinition[] = [
  {
    name: "http_request",
    description: "Make an HTTP request and return status, headers, and body text (truncated).",
    category: "network",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"] },
        headers: { type: "object", description: "Optional request headers" },
        body: { type: "string", description: "Optional request body" },
      },
      required: ["url"],
    },
    execute: async (args) => {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 20_000)
      try {
        const res = await fetch(String(args.url), {
          method: String(args.method || "GET"),
          headers: (args.headers as Record<string, string>) ?? undefined,
          body: args.body ? String(args.body) : undefined,
          signal: ctl.signal,
        })
        const text = await res.text()
        return {
          status: res.status,
          contentType: res.headers.get("content-type"),
          body: text.slice(0, 20_000),
          truncated: text.length > 20_000,
        }
      } finally {
        clearTimeout(timer)
      }
    },
  },
  {
    name: "web_search",
    description:
      "Search the web (DuckDuckGo) and return the top result titles, URLs, and snippets as structured data. Use this to research facts, docs, or current information.",
    category: "network",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "number", description: "Default 5" },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const q = encodeURIComponent(String(args.query))
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
        headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" },
      })
      const html = await res.text()
      const results: { title: string; url: string; snippet: string }[] = []
      const linkRegex =
        /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
      let m: RegExpExecArray | null
      const max = Number(args.maxResults || 5)
      while ((m = linkRegex.exec(html)) && results.length < max) {
        const rawUrl = m[1]
        const uddg = rawUrl.match(/uddg=([^&]+)/)
        const url = uddg ? decodeURIComponent(uddg[1]) : rawUrl
        results.push({
          title: m[2].replace(/<[^>]+>/g, "").trim(),
          url,
          snippet: m[3].replace(/<[^>]+>/g, "").trim().slice(0, 300),
        })
      }
      return results
    },
  },
  {
    name: "read_webpage",
    description: "Fetch a web page and return its readable text content (HTML stripped).",
    category: "network",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    execute: async (args) => {
      const res = await fetch(String(args.url), {
        headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" },
        redirect: "follow",
      })
      const html = await res.text()
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
      return { url: String(args.url), text: text.slice(0, 15_000), truncated: text.length > 15_000 }
    },
  },
  {
    name: "calculator",
    description: "Evaluate a math expression safely (supports + - * / % ** parentheses, Math functions).",
    category: "utility",
    parameters: {
      type: "object",
      properties: { expression: { type: "string" } },
      required: ["expression"],
    },
    execute: async (args) => {
      const expr = String(args.expression)
      if (!/^[\d\s+\-*/%().,eE]|Math\.[a-z]+/.test(expr) || /[;={}[\]`'"]/.test(expr)) {
        throw new Error("Expression contains disallowed characters")
      }
      // eslint-disable-next-line no-new-func
      const value = new Function(`"use strict"; return (${expr})`)()
      if (typeof value !== "number" || Number.isNaN(value)) throw new Error("Not a numeric result")
      return { expression: expr, result: value }
    },
  },
  {
    name: "json_query",
    description: "Parse a JSON string and extract a value at a dot path (e.g. 'data.items.0.name').",
    category: "utility",
    parameters: {
      type: "object",
      properties: {
        json: { type: "string" },
        path: { type: "string", description: "Dot path; empty returns the whole parsed value" },
      },
      required: ["json"],
    },
    execute: async (args) => {
      let value: unknown = JSON.parse(String(args.json))
      const p = String(args.path || "")
      if (p) {
        for (const part of p.split(".")) {
          if (value == null) break
          value = (value as Record<string, unknown>)[part]
        }
      }
      return { value }
    },
  },
  {
    name: "csv_parse",
    description: "Parse CSV text into an array of row objects using the first row as headers.",
    category: "utility",
    parameters: {
      type: "object",
      properties: {
        csv: { type: "string" },
        delimiter: { type: "string", description: "Default comma" },
      },
      required: ["csv"],
    },
    execute: async (args) => {
      const delim = String(args.delimiter || ",")
      const lines = String(args.csv).split(/\r?\n/).filter(Boolean)
      if (lines.length === 0) return { rows: [] }
      const parseLine = (line: string): string[] => {
        const out: string[] = []
        let cur = ""
        let inQuotes = false
        for (let i = 0; i < line.length; i++) {
          const ch = line[i]
          if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
              cur += '"'
              i++
            } else inQuotes = !inQuotes
          } else if (ch === delim && !inQuotes) {
            out.push(cur)
            cur = ""
          } else cur += ch
        }
        out.push(cur)
        return out
      }
      const headers = parseLine(lines[0])
      const rows = lines.slice(1, 501).map((l) => {
        const cells = parseLine(l)
        const row: Record<string, string> = {}
        headers.forEach((h, i) => (row[h] = cells[i] ?? ""))
        return row
      })
      return { headers, rows, truncated: lines.length > 501 }
    },
  },
]
