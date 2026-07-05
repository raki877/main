/* Nova Agent dashboard client. Vanilla JS, no build step. */
(() => {
  const $ = (id) => document.getElementById(id);
  const sessionId = "dashboard";

  // ---------- WebSocket ----------
  let ws = null;
  let streamEl = null;

  function connect() {
    ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => $("conn-dot").classList.add("on");
    ws.onclose = () => {
      $("conn-dot").classList.remove("on");
      setTimeout(connect, 2000);
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      handleEvent(m);
    };
  }

  function handleEvent({ event, payload }) {
    switch (event) {
      case "Hello":
        renderStatus(payload);
        break;
      case "Token":
        appendToken(payload.token);
        break;
      case "ChatResult":
        finishStream(payload.answer);
        break;
      case "ChatError":
        finishStream(null);
        addMsg("error", "Error: " + payload.error);
        break;
      case "ToolStarted":
        addActivity(`→ <strong>${esc(payload.name)}</strong> ${esc(JSON.stringify(payload.args).slice(0, 120))}`);
        addMsg("tool", `⚙ ${payload.name}`);
        break;
      case "ToolCompleted":
        addActivity(
          payload.ok
            ? `<span class="ok">✓</span> ${esc(payload.name)} (${payload.durationMs}ms)`
            : `<span class="err">✗</span> ${esc(payload.name)}: ${esc(payload.error || "")}`
        );
        break;
      case "PlanCreated":
      case "PlanUpdated":
        renderPlan(payload);
        break;
      case "StatusChanged":
        $("st-phase").textContent = payload.phase;
        break;
      case "TaskCompleted":
        refreshStatus();
        loadMemory();
        break;
      case "Log":
        if (payload.level === "error") addActivity(`<span class="err">${esc(payload.msg?.slice(0, 140) || "")}</span>`);
        break;
    }
  }

  // ---------- Chat ----------
  function addMsg(kind, text) {
    const div = document.createElement("div");
    div.className = "msg " + kind;
    div.textContent = text;
    $("chat-log").appendChild(div);
    $("chat-log").scrollTop = $("chat-log").scrollHeight;
    return div;
  }

  function appendToken(token) {
    if (!streamEl) streamEl = addMsg("agent", "");
    streamEl.textContent += token;
    $("chat-log").scrollTop = $("chat-log").scrollHeight;
  }

  function finishStream(answer) {
    if (streamEl && answer) streamEl.textContent = answer;
    else if (!streamEl && answer) addMsg("agent", answer);
    streamEl = null;
  }

  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    send();
  });
  $("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      send();
    }
  });

  function send() {
    const input = $("chat-input");
    const text = input.value.trim();
    if (!text || !ws || ws.readyState !== 1) return;
    addMsg("user", text);
    streamEl = null;
    $("plan-box").hidden = true;
    ws.send(JSON.stringify({ type: "chat", message: text, sessionId }));
    input.value = "";
  }

  $("stop-btn").addEventListener("click", () => fetch("/api/stop", { method: "POST" }));
  $("clear-btn").addEventListener("click", async () => {
    await fetch(`/api/history/${sessionId}`, { method: "DELETE" });
    $("chat-log").innerHTML = "";
    $("plan-box").hidden = true;
  });

  // ---------- Plan ----------
  function renderPlan(plan) {
    if (!plan || !plan.steps || plan.steps.length < 2) return;
    const box = $("plan-box");
    box.hidden = false;
    box.innerHTML = plan.steps
      .map((s) => {
        const icon = s.status === "done" ? "✓" : s.status === "failed" ? "✗" : s.status === "running" ? "▸" : "·";
        return `<div class="step ${s.status}">${icon} ${esc(s.title)}</div>`;
      })
      .join("");
  }

  // ---------- Status ----------
  function renderStatus(s) {
    $("st-phase").textContent = s.phase;
    $("st-model").textContent = s.model.split("/").pop();
    $("st-uptime").textContent = fmtUptime(s.uptimeSec);
    $("st-ram").textContent = s.memoryUsageMb + " MB";
    $("st-cpu").textContent = s.cpuPercent + "%";
    $("st-tools").textContent = s.toolCount;
    $("st-skills").textContent = s.skillCount + " / " + s.pluginCount + "p";
    $("st-telegram").textContent = s.telegramConnected ? "connected" : "off";
  }

  async function refreshStatus() {
    try {
      renderStatus(await (await fetch("/api/status")).json());
    } catch { /* server restarting */ }
  }
  setInterval(refreshStatus, 5000);

  function fmtUptime(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m ${sec % 60}s`;
  }

  // ---------- Activity feed ----------
  function addActivity(html) {
    const li = document.createElement("li");
    li.innerHTML = html;
    const list = $("activity-list");
    list.prepend(li);
    while (list.children.length > 80) list.removeChild(list.lastChild);
  }

  // ---------- Tabs ----------
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      document.querySelectorAll(".tab-body").forEach((b) => (b.hidden = true));
      $("tab-" + tab.dataset.tab).hidden = false;
      if (tab.dataset.tab === "memory") loadMemory();
      if (tab.dataset.tab === "tools") loadTools();
      if (tab.dataset.tab === "jobs") loadJobs();
    });
  });

  // ---------- Memory ----------
  async function loadMemory(q) {
    const url = q ? `/api/memory?q=${encodeURIComponent(q)}` : "/api/memory";
    const items = await (await fetch(url)).json();
    $("memory-list").innerHTML = items
      .map(
        (m) =>
          `<li><button data-key="${esc(m.key)}" aria-label="Delete">×</button><strong>${esc(m.key)}</strong> <em>(${m.kind})</em><br>${esc(m.value.slice(0, 200))}</li>`
      )
      .join("");
    $("memory-list").querySelectorAll("button").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await fetch(`/api/memory/${encodeURIComponent(btn.dataset.key)}`, { method: "DELETE" });
        loadMemory($("memory-search").value.trim() || undefined);
      })
    );
  }
  let searchTimer;
  $("memory-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadMemory(e.target.value.trim() || undefined), 300);
  });

  // ---------- Tools ----------
  async function loadTools() {
    const tools = await (await fetch("/api/tools")).json();
    const byCat = {};
    tools.forEach((t) => ((byCat[t.category] ??= []).push(t)));
    $("tools-list").innerHTML = Object.entries(byCat)
      .map(
        ([cat, list]) =>
          `<li><strong>${esc(cat)}</strong><br>${list.map((t) => esc(t.name) + (t.dangerous ? ' <span class="err">!</span>' : "")).join(", ")}</li>`
      )
      .join("");
  }

  // ---------- Jobs ----------
  async function loadJobs() {
    const jobs = await (await fetch("/api/jobs")).json();
    $("jobs-list").innerHTML = jobs
      .map(
        (j) =>
          `<li><button data-id="${j.id}" aria-label="Delete">×</button><strong>${esc(j.name)}</strong> (${j.kind}${j.intervalMin ? " " + j.intervalMin + "m" : ""}${j.atTime ? " @ " + j.atTime : ""})<br>next: ${new Date(j.nextRunAt).toLocaleString()}<br>${esc(j.prompt.slice(0, 100))}</li>`
      )
      .join("");
    $("jobs-list").querySelectorAll("button").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await fetch(`/api/jobs/${btn.dataset.id}`, { method: "DELETE" });
        loadJobs();
      })
    );
  }

  $("job-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const kind = $("job-kind").value;
    const when = $("job-when").value.trim();
    const body = { name: $("job-name").value.trim(), prompt: $("job-prompt").value.trim(), kind };
    if (kind === "once") body.delayMin = Number(when) || 0;
    if (kind === "interval") body.intervalMin = Number(when) || 60;
    if (kind === "daily") body.atTime = when || "09:00";
    await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    $("job-name").value = ""; $("job-prompt").value = ""; $("job-when").value = "";
    loadJobs();
  });

  // ---------- Models ----------
  async function loadModels() {
    const { current, available } = await (await fetch("/api/models")).json();
    $("model-select").innerHTML = available
      .map((m) => `<option value="${esc(m.id)}" ${m.id === current ? "selected" : ""}>${esc(m.label)}</option>`)
      .join("");
  }
  $("model-select").addEventListener("change", (e) =>
    fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: e.target.value }),
    })
  );

  // ---------- History restore ----------
  async function loadHistory() {
    try {
      const msgs = await (await fetch(`/api/history/${sessionId}`)).json();
      msgs.forEach((m) => {
        if (m.role === "user") addMsg("user", m.content);
        else if (m.role === "assistant") addMsg("agent", m.content);
      });
    } catch { /* ignore */ }
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  connect();
  refreshStatus();
  loadModels();
  loadHistory();
})();
