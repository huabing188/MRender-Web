// 真实感渲染验证：导入白酒瓶，切换 GPU，对比光栅 vs 路径追踪出图
// 重点验证：(1) 影棚渐变背景 (2) 实体地面+接触阴影 (3) 玻璃/瓷真实材质 (4) 路径追踪可见差异
import { chromium } from "/Users/huabinxu/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs";
import fs from "fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:5180/";
const BOTTLE = "/Users/huabinxu/Desktop/codex文件/MRender/Resources/baijiu_bottle.obj";
const OUT = "/Users/huabinxu/Desktop/workbuddy文档/MRender-Web/verify";
fs.mkdirSync(OUT, { recursive: true });

function scaleObj(text, s) {
  return text.split("\n").map((line) => {
    if (line.startsWith("v ")) {
      const p = line.slice(2).trim().split(/\s+/).map(Number);
      return `v ${(p[0] * s).toFixed(4)} ${(p[1] * s).toFixed(4)} ${(p[2] * s).toFixed(4)}`;
    }
    return line;
  }).join("\n");
}
const raw = fs.readFileSync(BOTTLE, "utf8");
const scaled = scaleObj(raw, 90);
const verts = scaled.split("\n").filter((l) => l.startsWith("v ")).map((l) => l.slice(2).trim().split(/\s+/).map(Number));
const minY = Math.min(...verts.map((p) => p[1]));
const maxY = Math.max(...verts.map((p) => p[1]));
const height = maxY - minY;
console.log("模型顶点 Y 范围:", { minY: minY.toFixed(2), maxY: maxY.toFixed(2), height: height.toFixed(2) });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cleanShot(page, path) {
  await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return;
    const all = document.body.getElementsByTagName("*");
    for (const el of all) {
      if (el === c) continue;
      if (c.contains(el) || el.contains(c)) continue;
      el.style.display = "none";
    }
    c.style.position = "fixed";
    c.style.left = "0"; c.style.top = "0";
    c.style.width = "100vw"; c.style.height = "100vh";
    c.style.zIndex = "99999";
  });
  await sleep(500);
  await page.screenshot({ path, timeout: 120000 });
}

// 切到 GPU（开阴影+高像素比），关网格坐标轴，等渲染稳定
async function settle(page, ms = 2500) {
  await page.evaluate(() => {
    const st = window.MRender.getStore();
    st.updateRender({ device: "gpu", autoFallback: false });
    window.MRender.setGridVisible(false);
    window.MRender.setAxesVisible(false);
  });
  await sleep(ms);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: [
      "--use-gl=swiftshader",
      "--no-sandbox",
      "--disable-gpu-sandbox",
      "--enable-unsafe-swiftshader",
      "--disable-dev-shm-usage",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on("console", (m) => { const t = `[${m.type()}] ${m.text()}`; logs.push(t); });
  page.on("pageerror", (e) => { const t = `[pageerror] ${e.message}`; logs.push(t); });

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.MRender && window.MRender.getStore && document.querySelector("canvas"));
  await sleep(1500);

  // 清掉默认演示瓶
  await page.evaluate(() => {
    const st = window.MRender.getStore();
    [...st.scene.objects].forEach((o) => st.removeObject(o.id));
  });
  await sleep(500);

  // 导入瓶子
  await page.evaluate(async (objText) => {
    const file = new File([objText], "baijiu_bottle_scaled.obj", { type: "text/plain" });
    await window.MRender.importModel(file, { explode: false });
  }, scaled);

  await page.waitForFunction(() => {
    const o = window.MRender.getStore().scene.objects;
    return o.some((x) => (x.name || "").toLowerCase().includes("baijiu_bottle"));
  }, { timeout: 120000 });
  await sleep(1000);

  const centerY0 = (minY + maxY) / 2;
  const info = await page.evaluate(({ minY }) => {
    const st = window.MRender.getStore();
    const o = st.scene.objects.find((x) => (x.name || "").toLowerCase().includes("baijiu_bottle"));
    if (!o) throw new Error("bottle not found");
    // 把模型底面精准放到地面 y=0，避免悬空/穿地
    st.updateObject(o.id, { position: [0, -minY, 0] });
    return { bottleId: o.id, triCount: o.triangleCount || 0, objectCount: st.scene.objects.length };
  }, { minY });
  console.log("导入信息:", JSON.stringify(info));

  const centerY = (minY + maxY) / 2 - minY; // 模型中心相对底面的高度
  const FRAME = { position: [0, 250, 470], target: [0, centerY, 0], fov: 34 };

  // 影棚灯光：主光(强)+辅光(弱)+轮廓光(冷)，强度用物理单位，配合引擎常驻阴影灯产生接触阴影
  const mainId = `area_${Date.now()}`;
  const fillId = `area_fill_${Date.now()}`;
  const rimId = `area_rim_${Date.now()}`;
  await page.evaluate(({ mainId, fillId, rimId, centerY }) => {
    const st = window.MRender.getStore();
    // 先清掉默认三盏灯，避免叠加过曝
    st.scene.lights.forEach((l) => st.removeLight(l.id));
    st.addLight({ id: mainId, name: "主光 Key", type: "area", position: [240, 420, 300], target: [0, centerY, 0], intensity: 12, color: [1, 0.98, 0.93], size: [320, 320], visible: true });
    st.addLight({ id: fillId, name: "辅光 Fill", type: "area", position: [-300, 220, 260], target: [0, centerY, 0], intensity: 4, color: [0.9, 0.95, 1.0], size: [260, 260], visible: true });
    st.addLight({ id: rimId, name: "轮廓光 Rim", type: "area", position: [-220, 320, -300], target: [0, centerY, 0], intensity: 6, color: [0.85, 0.92, 1.0], size: [220, 220], visible: true });
  }, { mainId, fillId, rimId, centerY });

  await settle(page, 2500);
  const report = [];

  // 第一组：白瓷瓶 + 威尼斯 HDR + 亮灰影棚渐变背景（磨砂地面），压曝光避免白瓷过曝
  await page.evaluate(({ id, frame, mainId, fillId, rimId }) => {
    const st = window.MRender.getStore();
    st.updateLight(mainId, { intensity: 12 });
    st.updateLight(fillId, { intensity: 3 });
    st.updateLight(rimId, { intensity: 5 });
    st.assignMaterial(id, "mat_ceramic_white");
    st.updateEnvironment({
      preset: "env_venice", hdrUrl: null, hdrKey: null,
      brightness: 0.55, contrast: 1.0, rotation: -25, height: 4, size: 1.0, intensity: 1.0,
      background: { mode: "color", color: [0.28, 0.29, 0.32] },
      ground: { enabled: true, shadow: true, color: [0.22, 0.23, 0.26], reflection: false, flatten: false, size: 800 },
    });
    st.updateCamera({ ...frame, exposure: -0.5 });
  }, { id: info.bottleId, frame: FRAME, mainId, fillId, rimId });
  await settle(page, 3000);
  const r1 = `${OUT}/A1-白瓷瓶-光栅.png`;
  await cleanShot(page, r1);
  report.push({ name: "A1-白瓷瓶-光栅", path: r1, mode: "raster", material: "mat_ceramic_white", env: "env_venice" });
  console.log("已出 A1:", r1);

  // 第二组：玻璃瓶 + PH 蓝棚（光栅，镜面地面反射）
  await page.evaluate(({ id, frame, mainId, fillId, rimId }) => {
    const st = window.MRender.getStore();
    st.updateLight(mainId, { intensity: 12 });
    st.updateLight(fillId, { intensity: 4 });
    st.updateLight(rimId, { intensity: 8 });
    st.assignMaterial(id, "mat_glass_clear");
    st.updateEnvironment({
      preset: "ph_blue_photo_studio", hdrUrl: null, hdrKey: null,
      brightness: 1.25, contrast: 1.0, rotation: -15, height: 0, size: 1.0, intensity: 1.1,
      background: { mode: "color", color: [0.07, 0.09, 0.14] },
      ground: { enabled: true, shadow: true, color: [0.06, 0.07, 0.1], reflection: true, flatten: false, size: 800 },
    });
    st.updateCamera({ ...frame, exposure: 0 });
  }, { id: info.bottleId, frame: FRAME, mainId, fillId, rimId });
  await settle(page, 3000);
  const r2 = `${OUT}/A2-玻璃瓶-光栅.png`;
  await cleanShot(page, r2);
  report.push({ name: "A2-玻璃瓶-光栅", path: r2, mode: "raster", material: "mat_glass_clear", env: "ph_blue_photo_studio" });
  console.log("已出 A2:", r2);

  // 第三组：同样玻璃场景 → 路径追踪（更高采样/反弹，物理折射+接触阴影）
  let r3 = null;
  try {
    await page.evaluate(({ id, frame }) => {
      const st = window.MRender.getStore();
      st.assignMaterial(id, "mat_glass_clear");
      st.updateEnvironment({
        preset: "ph_blue_photo_studio", hdrUrl: null, hdrKey: null,
        brightness: 1.25, contrast: 1.0, rotation: -15, height: 0, size: 1.0, intensity: 1.1,
        background: { mode: "color", color: [0.07, 0.09, 0.14] },
        ground: { enabled: true, shadow: true, color: [0.06, 0.07, 0.1], reflection: true, flatten: false, size: 800 },
      });
      st.updateCamera(frame);
      st.updateRender({ mode: "pathtrace", samples: 64, bounces: 6, denoise: true });
    }, { id: info.bottleId, frame: FRAME });
    await sleep(800);
    r3 = `${OUT}/A3-玻璃瓶-路径追踪.png`;
    await page.evaluate(async () => {
      const eng = window.MRender.getEngine();
      if (!eng) throw new Error("engine not ready");
      // 分辨率略降、采样翻倍：在 SwiftShader 内存可承受的前提下获得更干净的路径追踪差异
      await eng.renderPathTrace([900, 560], 64, 6, true);
    });
    await cleanShot(page, r3);
    report.push({ name: "A3-玻璃瓶-路径追踪", path: r3, mode: "pathtrace", material: "mat_glass_clear", env: "ph_blue_photo_studio" });
    console.log("已出 A3:", r3);
    await page.evaluate(() => window.MRender.getEngine().restoreRasterPreview());
  } catch (e) {
    console.log("路径追踪失败:", e.message);
    report.push({ name: "A3-玻璃瓶-路径追踪", path: null, mode: "pathtrace", error: e.message });
  }

  fs.writeFileSync(`${OUT}/report_A.json`, JSON.stringify({ info, mainId, fillId, rimId, shots: report, logs: logs.slice(-50) }, null, 2));
  console.log("完成。报告:", `${OUT}/report_A.json`);
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
