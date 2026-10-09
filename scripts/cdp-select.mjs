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
      if (msg.id === id) { ws.off("message", onMsg); resolve(msg); }
    };
    ws.on("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function main() {
  const pages = await fetchJson("http://localhost:9222/json/list");
  const page = pages.find((p) => p.type === "page") || pages[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.on("open", async () => {
    await send(ws, "Runtime.enable");
    await send(ws, "Page.enable");
    await send(ws, "Page.navigate", { url: "http://localhost:5173/" });
    setTimeout(async () => {
      // 选中酒瓶并切换到移动 Gizmo
      await send(ws, "Runtime.evaluate", { expression: `
        const store = window.__STORE_HACK || (() => {
          const el = document.createElement('script');
          el.textContent = 'window.__STORE_HACK = useSceneStore.getState();';
          document.head.appendChild(el);
          return window.__STORE_HACK;
        })();
        const st = window.__STORE_HACK || useSceneStore.getState();
        st.selectObject('obj_bottle');
        st.setGizmoMode('translate');
        'ok';
      `, returnByValue: true });
      setTimeout(async () => {
        await send(ws, "Page.captureScreenshot", { format: "png" });
        ws.close();
        process.exit(0);
      }, 3000);
    }, 6000);
  });
}
main().catch(console.error);
