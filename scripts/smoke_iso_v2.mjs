// Headless smoke test for regenerated isoEnvironments.ts (200 presets)
import { chromium } from "/Users/huabinxu/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:5180/";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
const failed = [];
const allResp = [];
page.on("console", (m) => {
  if (m.type() === "error") {
    let loc = "";
    try { const l = m.location(); loc = ` [${l.url}:${l.lineNumber}]`; } catch {}
    errors.push(m.text() + loc);
  }
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("response", (r) => { allResp.push(r.status() + " " + r.url()); if (r.status() >= 400) failed.push(r.status() + " " + r.url()); });
page.on("requestfailed", (r) => failed.push("REQFAIL " + (r.failure()?.errorText || "") + " " + r.url()));

// also log every request URL to catch the 404 source
const reqs = [];
page.on("request", (r) => reqs.push(r.url()));

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForFunction(() => window.MRender && window.MRender.getStore, null, { timeout: 20000 });

// count environments
const envCount = await page.evaluate(() => {
  const s = window.MRender.getStore();
  // ENV_PRESETS is a module constant; expose via store scene if available, else count via getStore
  return s.render ? Object.keys(s.render).length : -1;
});

// Try applying an ISO preset (known id from regenerated ts) and confirm no crash
const applyResult = await page.evaluate(async () => {
  const s = window.MRender.getStore();
  const isoId = "iso_dosch_HC_DH-301HC";
  try {
    s.updateEnvironment({ preset: isoId, intensity: 1 });
    // give the HDR loader time
    await new Promise((r) => setTimeout(r, 4000));
    const env = s.scene ? s.scene.environment : null;
    return { ok: true, id: isoId, envAfter: env ? env.preset : null };
  } catch (e) { return { ok: false, err: String(e) }; }
});

// poll canvas stability ~2s
await page.waitForTimeout(2500);
const shot = await page.screenshot({ path: "/tmp/iso_v2_smoke.png" });

console.log(JSON.stringify({
  envCount,
  applyResult,
  errorCount: errors.length,
  errors: errors.slice(0, 10),
  failedRequests: failed,
  allResponsesNon200: allResp.filter((x) => !x.startsWith("200 ")),
  requestUrls: reqs,
}, null, 2));

await browser.close();
