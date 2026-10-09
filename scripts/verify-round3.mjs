import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUTDIR = "/Users/huabinxu/Desktop/workbuddy文档/MRender-Web/verify/round3";
fs.mkdirSync(OUTDIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader", "--use-gl=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", (err) => errors.push("PAGEERROR: " + err.message));

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await sleep(2000);

const diag = async (label) => {
  const S = await page.evaluate(() => {
    const s = window.MRender.getStore();
    return {
      objects: s.scene.objects.length,
      selected: s.selectedObjectId,
      customEnvs: s.scene.customEnvironments?.length ?? 0,
      envPreset: s.scene.environment.preset,
      hdrKey: s.scene.environment.hdrKey ? `${s.scene.environment.hdrKey.slice(0, 24)}...` : null,
      status: s.status,
      names: s.scene.objects.map((o) => o.name),
    };
  });
  return { label, ...S };
};

const shot = async (name) => {
  const p = path.join(OUTDIR, `${name}.png`);
  await page.screenshot({ path: p });
  return p;
};

const report = { states: [], jsErrors: [] };
report.states.push(await diag("init"));
await shot("01-init");

// 选中默认酒瓶
await page.click("canvas");
await sleep(600);
report.states.push(await diag("selected-bottle"));
await shot("02-selected-bottle");

// 打散（ungroup）
const bottleId = (await page.evaluate(() => window.MRender.getStore())).scene.objects[0]?.id;
if (bottleId) {
  await page.evaluate((id) => window.MRender.getEngine().ungroupObject(id), bottleId);
  await sleep(1800);
  report.states.push(await diag("exploded"));
  await shot("03-exploded");
  const partId = (await page.evaluate(() => window.MRender.getStore())).scene.objects.find((o) => o.partName)?.id;
  if (partId) {
    await page.evaluate((id) => window.MRender.getStore().selectObject(id), partId);
    await sleep(700);
    await shot("04-selected-part");
    report.states.push(await diag("selected-part"));
  }
}

// 通过 window drop 事件导入（走真实导入链路）
async function dropFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString("base64");
  const name = path.basename(filePath);
  await page.evaluate(({ b64, name }) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], name, { type: "application/octet-stream" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const ev = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
    window.dispatchEvent(ev);
  }, { b64, name });
}

// 导入 3DM（翻盖盒，最小样本）
const threeDmPath = "/Users/huabinxu/Desktop/工作/仁怀酱香酒/渲染/翻盖盒.3dm";
const beforeObjs = (await page.evaluate(() => window.MRender.getStore())).scene.objects.length;
if (fs.existsSync(threeDmPath)) {
  await dropFile(threeDmPath);
  // 轮询等待 3DM 解析（wasm 较慢）
  let ok = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const n = (await page.evaluate(() => window.MRender.getStore())).scene.objects.length;
    if (n > beforeObjs) { ok = true; break; }
  }
  report.states.push(await diag("imported-3dm"));
  await shot("05-imported-3dm");
  report.states[report.states.length - 1].imported3dm = ok;
}

// 导入 HDR（startup.hdr）
const hdrPath = "/Users/huabinxu/Desktop/HDR/startup.hdr";
const beforeEnv = (await page.evaluate(() => window.MRender.getStore())).scene.customEnvironments?.length ?? 0;
if (fs.existsSync(hdrPath)) {
  await dropFile(hdrPath);
  let ok = false;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const S = await page.evaluate(() => window.MRender.getStore());
    if ((S.scene.customEnvironments?.length ?? 0) > beforeEnv && S.scene.environment.preset === "custom") { ok = true; break; }
  }
  report.states.push(await diag("imported-hdr"));
  await shot("06-imported-hdr");
  report.states[report.states.length - 1].importedHdr = ok;
  // 切到环境页签，验证 HDR 名称/预览卡 UI
  await page.click("text=环境");
  await sleep(500);
  await shot("07-environment-panel");
}

report.jsErrors = errors.slice();
report.pass = errors.length === 0 && report.states.some((s) => s.imported3dm) && report.states.some((s) => s.importedHdr);
fs.writeFileSync(path.join(OUTDIR, "report.json"), JSON.stringify(report, null, 2));

await browser.close();
console.log(JSON.stringify(report, null, 2));
