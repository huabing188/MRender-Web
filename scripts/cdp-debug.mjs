import http from "http";
import WebSocket from "ws";

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

async function send(ws, method, params = {}) {
  const id = Date.now() + Math.random();
  return new Promise((resolve) => {
    const onMsg = (data) => {
      const msg = JSON.parse(data);
      if (msg.id === id) {
        ws.off("message", onMsg);
        resolve(msg);
      }
    };
    ws.on("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  const pages = await fetchJson("http://localhost:9222/json/list");
  // 关键修复：筛选 type === "page" 的页面 target，跳过 browser/other
  const page = pages.find((p) => p.type === "page") || pages[0];
  if (!page) {
    console.error("no page target", pages.map((p) => `${p.type}:${p.url}`));
    process.exit(1);
  }
  console.error("Connecting to", page.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  const events = [];
  ws.on("open", async () => {
    console.error("[open] connected OK");
    await send(ws, "Runtime.enable");
    await send(ws, "Log.enable");
    await send(ws, "Page.enable");
    await send(ws, "Page.navigate", { url: "http://localhost:5173/" });
    console.error("[open] navigate sent, waiting 6s...");
    setTimeout(async () => {
      const expr = `JSON.stringify({
        errors: document.getElementById('errors')?.textContent || '',
        rootLen: document.getElementById('root')?.innerHTML.length || 0,
        rootHtml: (document.getElementById('root')?.innerHTML || '').slice(0, 300),
        title: document.title,
        bodyLen: document.body.innerHTML.length,
        webgl: (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch(e){ return 'ERR:'+e.message; } })()
      })`;
      const r = await send(ws, "Runtime.evaluate", { expression: expr, returnByValue: true });
      console.log("STATE:", r.result?.result?.value);
      console.log("--- console/exception events (max 30) ---");
      for (const ev of events.slice(0, 30)) {
        if (ev.method === "Runtime.consoleAPICalled") {
          const args = (ev.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
          console.log(`[console.${ev.params.type}]`, args.slice(0, 500));
        } else if (ev.method === "Runtime.exceptionThrown") {
          const d = ev.params.exceptionDetails;
          console.log("[exception]", d.exception?.description || d.text, "@", d.url + ":" + d.lineNumber);
        } else if (ev.method === "Log.entryAdded") {
          console.log("[log]", ev.params.entry.level, ev.params.entry.text.slice(0, 500));
        }
      }
      if (events.length === 0) console.log("(no console events captured)");
      ws.close();
      process.exit(0);
    }, 6000);
  });

  ws.on("message", (data) => {
    const msg = JSON.parse(data);
    if (msg.method && msg.method !== "Runtime.consoleAPICalled" && msg.method !== "Log.entryAdded" && msg.method !== "Runtime.exceptionThrown") {
      // ignore most internal events
    }
    if (msg.method === "Runtime.consoleAPICalled" || msg.method === "Runtime.exceptionThrown" || msg.method === "Log.entryAdded") {
      events.push(msg);
    }
  });
  ws.on("error", (e) => console.error("[ws error]", e.message));
}
main().catch((e) => {
  console.error("MAIN ERROR", e);
  process.exit(1);
});
