// 敦和 PDF 风格自测渲染脚本 v2
// 用 Playwright 驱动 MRender-Web，输出样张到桌面 MRender样张/
import { chromium } from "/Users/huabinxu/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs";
import { writeFileSync, mkdirSync } from "fs";

const OUT_DIR = "/Users/huabinxu/Desktop/workbuddy文档/MRender样张";
mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = "http://localhost:5180/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForApp(page, timeout = 30000) {
  await page.waitForFunction(() => window.MRender && window.MRender.getStore() && window.MRender.getEngine(), { timeout });
  await sleep(600);
}

async function waitStable(page, maxMs = 20000) {
  await page.waitForFunction(() => {
    const eng = window.MRender.getEngine();
    return eng && eng.renderer && eng.composer;
  }, { timeout: 10000 });
  const start = Date.now();
  const hash = await page.evaluate(() => {
    const eng = window.MRender.getEngine();
    eng.composer.render();
    return eng.snapshotDataURL().slice(-80);
  });
  let last = hash;
  let same = 0;
  while (Date.now() - start < maxMs) {
    await sleep(700);
    const h = await page.evaluate(() => {
      const eng = window.MRender.getEngine();
      eng.composer.render();
      return eng.snapshotDataURL().slice(-80);
    });
    if (h === last) {
      same++;
      if (same >= 3) return;
    } else {
      same = 0;
      last = h;
    }
  }
}

async function applySetup(page, code) {
  await page.evaluate((c) => {
    const fn = new Function(c);
    fn();
  }, code);
  await waitStable(page, 22000);
}

async function renderPNG(page, name, resolution = [1920, 1080]) {
  const dataUrl = await page.evaluate(([w, h, n]) => {
    return window.MRender.getEngine().exportPNG([w, h], false, n);
  }, [resolution[0], resolution[1], name]);
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  const path = `${OUT_DIR}/${name}.png`;
  writeFileSync(path, Buffer.from(base64, "base64"));
  return path;
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--use-gl=swiftshader", "--no-sandbox", "--disable-gpu-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await waitForApp(page);

  const report = {
    date: new Date().toISOString(),
    baseUrl: BASE_URL,
    shots: [],
    errors: [],
  };

  // ========== 镜头 1：深蓝暗调 · 全高玻璃瓶（PDF p12 风格） ==========
  await applySetup(page, `
    const s = window.MRender.getStore();
    s.resetScene();
    s.updateEnvironment({
      preset: "panels_tilted",
      intensity: 1.15,
      background: { mode: "color", color: [0.045, 0.055, 0.10] },
      ground: { enabled: true, shadow: true, color: [0.06, 0.065, 0.085] }
    });
    // 酒瓶坐在地面上（group y=0，局部高 0~256），相机压低对准瓶身中上部
    s.updateCamera({ position: [110, 150, 680], target: [0, 130, 0], fov: 30, focalLength: 55 });
    s.updateLight("light_key", { intensity: 22, position: [160, 220, 200], size: [90, 60] });
    s.updateLight("light_fill", { intensity: 9, color: [0.9, 0.95, 1], position: [-180, 160, 140], size: [70, 50] });
    s.updateLight("light_rim", { intensity: 18, color: [1, 0.96, 0.88], position: [-80, 260, -200], size: [100, 45] });
  `);
  const p1 = await renderPNG(page, "01-深蓝暗调-玻璃瓶", [1080, 1440]);
  report.shots.push({ name: "深蓝暗调玻璃瓶", file: p1, env: "panels_tilted", desc: "敦和 PDF p12 风格：深色背景、金盖蓝液玻璃瓶、三面板摄影棚光" });

  // ========== 镜头 2：白底产品照 · 白瓷球（PDF p40 风格） ==========
  await applySetup(page, `
    const s = window.MRender.getStore();
    s.resetScene();
    s.removeObject("obj_bottle");
    // 白底但用 HDR 做主照明，否则金属瓶盖会全黑
    s.updateEnvironment({
      preset: "panels_tilted",
      intensity: 1.25,
      background: { mode: "color", color: [0.985, 0.985, 0.985] },
      ground: { enabled: true, shadow: true, color: [0.985, 0.985, 0.985] }
    });
    s.updateCamera({ position: [180, 80, 260], target: [135, 34, 0], fov: 28, focalLength: 50 });
    s.updateLight("light_key", { intensity: 22, color: [1, 1, 1], position: [160, 260, 200], size: [90, 60] });
    s.updateLight("light_fill", { intensity: 14, color: [0.95, 0.97, 1], position: [-180, 200, 150], size: [70, 50] });
    s.updateLight("light_rim", { intensity: 10, color: [1, 1, 1], position: [-60, 260, -180], size: [90, 40] });
    s.addObject({
      id: "obj_ceramic_ball", name: "白瓷球", type: "mesh", source: "builtin:sphere",
      transform: { position: [100, 34, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      materialId: "mat_ceramic_gloss", visible: true
    });
    s.addObject({
      id: "obj_gold_ball", name: "金球", type: "mesh", source: "builtin:sphere",
      transform: { position: [170, 34, 0], rotation: [0, 0, 0], scale: [0.8, 0.8, 0.8] },
      materialId: "mat_gold", visible: true
    });
  `);
  const p2 = await renderPNG(page, "02-白底产品照-白瓷球", [1080, 1440]);
  report.shots.push({ name: "白底产品照", file: p2, env: "panels_tilted+white_bg", desc: "纯白背景产品摄影风格，HDR 照明保证金属反射，加白瓷球/金球测试材质指派" });

  // ========== 镜头 3：ISO HDR 真实棚拍 ==========
  await applySetup(page, `
    const s = window.MRender.getStore();
    s.resetScene();
    s.updateEnvironment({
      preset: "iso_dosch_HC_DH-301HC",
      intensity: 1.25,
      background: { mode: "color", color: [0.03, 0.032, 0.038] },
      ground: { enabled: true, shadow: true, color: [0.045, 0.048, 0.055] }
    });
    s.updateCamera({ position: [110, 150, 680], target: [0, 130, 0], fov: 30, focalLength: 52 });
    // HDR 做主光，area light 仅补轮廓
    s.updateLight("light_key", { intensity: 5 });
    s.updateLight("light_fill", { intensity: 2 });
    s.updateLight("light_rim", { intensity: 8, color: [1, 0.96, 0.9] });
  `);
  const p3 = await renderPNG(page, "03-ISO-HDR-真实棚拍", [1080, 1440]);
  report.shots.push({ name: "ISO HDR 棚拍", file: p3, env: "iso_dosch_HC_DH-301HC", desc: "200 张精选 HDR 之一做主照明，真实摄影棚反射" });

  // ========== 镜头 4：材质球阵列 ==========
  await applySetup(page, `
    const s = window.MRender.getStore();
    s.resetScene();
    s.removeObject("obj_bottle");
    // 用 panels_tilted 让金属/清漆有真实反射内容
    s.updateEnvironment({
      preset: "panels_tilted",
      intensity: 1.2,
      background: { mode: "color", color: [0.08, 0.08, 0.085] },
      ground: { enabled: true, shadow: true, color: [0.10, 0.10, 0.105] }
    });
    s.updateCamera({ position: [0, 70, 340], target: [0, 40, 0], fov: 34, focalLength: 45 });
    s.updateLight("light_key", { intensity: 20, position: [80, 110, 120], size: [60, 40] });
    s.updateLight("light_fill", { intensity: 8, position: [-80, 80, 80], color: [0.9, 0.95, 1] });
    s.updateLight("light_rim", { intensity: 14, position: [0, 120, -90], color: [1, 0.95, 0.85] });
    const spheres = [
      { id: "obj_ball_gold", x: -75, mat: "mat_gold" },
      { id: "obj_ball_ceramic", x: -25, mat: "mat_ceramic_gloss" },
      { id: "obj_ball_chrome", x: 25, mat: "mat_metal_chrome" },
      { id: "obj_ball_wood", x: 75, mat: "mat_ac_wood" },
    ];
    for (const b of spheres) {
      s.addObject({
        id: b.id, name: b.mat, type: "mesh", source: "builtin:sphere",
        transform: { position: [b.x, 24, 0], rotation: [0, 0, 0], scale: [0.85, 0.85, 0.85] },
        materialId: b.mat, visible: true
      });
    }
  `);
  const p4 = await renderPNG(page, "04-材质球阵列-PBR", [1920, 1080]);
  report.shots.push({ name: "材质球阵列", file: p4, env: "panels_tilted", desc: "金/白瓷/铬/实木 PBR 材质对比" });

  report.errors = errors.slice(0, 20);
  writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2));

  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  return report;
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
