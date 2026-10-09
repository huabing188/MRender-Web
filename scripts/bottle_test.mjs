// 瓶子实测：导入白酒瓶 OBJ，测试材质 + 灯光（HDR 环境 / area light），输出样张
import { chromium } from "/Users/huabinxu/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs";
import fs from "fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:5180/";
const BOTTLE = "/Users/huabinxu/Desktop/codex文件/MRender/Resources/baijiu_bottle.obj";
const OUT = "/Users/huabinxu/Desktop/workbuddy文档/MRender样张/瓶子实测";
fs.mkdirSync(OUT, { recursive: true });

// 放大 OBJ 到真实瓶身尺寸（原生约 2.8 单位 -> ×90 ≈ 252mm）
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 截图前隐藏 UI 只留全屏 canvas（避免 locator.screenshot 等待 WebGL 稳定的超时）
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
  await sleep(200);
  await page.screenshot({ path });
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--use-gl=swiftshader", "--no-sandbox", "--disable-gpu-sandbox", "--enable-unsafe-swiftshader","--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const logs = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.MRender && window.MRender.getStore && document.querySelector("canvas"));
  await sleep(1200);

  // 清空默认演示瓶
  await page.evaluate(() => {
    const st = window.MRender.getStore();
    [...st.scene.objects].forEach((o) => window.MRender.getStore().removeObject(o.id));
  });
  await sleep(300);

  // 导入白酒瓶
  await page.evaluate(async (objText) => {
    const file = new File([objText], "baijiu_bottle_scaled.obj", { type: "text/plain" });
    await window.MRender.importModel(file, { explode: false });
  }, scaled);

  await page.waitForFunction(() => {
    const o = window.MRender.getStore().scene.objects;
    return o.some((x) => (x.name || "").toLowerCase().includes("baijiu_bottle"));
  }, { timeout: 30000 });
  await sleep(800);

  // 取瓶子 id，抬升使其落在地面 (y=0)，隐藏网格/坐标轴
  const bottleId = await page.evaluate(() => {
    const st = window.MRender.getStore();
    const o = st.scene.objects.find((x) => (x.name || "").toLowerCase().includes("baijiu_bottle"));
    st.updateObject(o.id, { position: [0, 126, 0] });
    window.MRender.setGridVisible(false);
    window.MRender.setAxesVisible(false);
    return o.id;
  });
  console.log("bottle id:", bottleId);

  // 通用相机取景（瓶子约 252mm 高，中心 y≈126）
  const FRAME = { position: [0, 250, 470], target: [0, 126, 0], fov: 34 };

  // 添加一盏 area 补光（展示灯光系统）
  const lightId = `area_${Date.now()}`;
  await page.evaluate((id) => {
    window.MRender.getStore().addLight({
      id, name: "主光 Area", type: "area",
      position: [180, 320, 220], target: [0, 126, 0],
      intensity: 18, color: [1, 0.98, 0.95], size: [220, 220],
      visible: true,
    });
  }, lightId);

  const shots = [
    { name: "01-玻璃瓶-PH蓝棚", material: "mat_glass", env: { preset: "ph_blue_photo_studio", background: { mode: "color", color: [0.10,0.11,0.14] } }, caption: "玻璃材质 + PH 蓝棚 HDR + area 主光" },
    { name: "03-白瓷瓶-三面板光", material: "mat_ceramic_white", env: { preset: "panels_tilted", background: { mode: "color", color: [0.07,0.07,0.09] } }, caption: "白瓷材质 + 三面板光" },
    { name: "04-琥珀酒液瓶-Blocky棚", material: "mat_liquid_whiskey", env: { preset: "ph_blocky_photo_studio", background: { mode: "color", color: [0.09,0.08,0.07] } }, caption: "琥珀酒液材质 + PH Blocky 摄影棚" },
  ];

  const report = [];
  for (const s of shots) {
    await page.evaluate(({ id, mat, env, frame }) => {
      const st = window.MRender.getStore();
      st.assignMaterial(id, mat);
      st.updateEnvironment(env);
      st.updateCamera(frame);
    }, { id: bottleId, mat: s.material, env: s.env, frame: FRAME });
    await sleep(2200); // 等 HDR 加载 + 渲染稳定
    const path = `${OUT}/${s.name}.png`;
    await cleanShot(page, path);
    report.push({ ...s, path });
    console.log("shot:", s.name, "->", path);
  }

  // 额外：纯玻璃 + 白底灯箱（电商白底图）
  await page.evaluate(({ id, frame }) => {
    const st = window.MRender.getStore();
    st.assignMaterial(id, "mat_glass");
    st.updateEnvironment({ preset: "ph_blocky_photo_studio", background: { mode: "color", color: [0.96, 0.96, 0.97] } });
    st.updateCamera(frame);
  }, { id: bottleId, frame: FRAME });
  await sleep(2200);
  const whitePath = `${OUT}/05-玻璃瓶-白底灯箱.png`;
  await cleanShot(page, whitePath);
  report.push({ name: "05-玻璃瓶-白底灯箱", material: "mat_glass", caption: "玻璃 + 白底灯箱（电商白底图）", path: whitePath });

  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ bottleId, lightId, shots: report, logs: logs.slice(-30) }, null, 2));
  console.log("DONE. logs tail:", logs.slice(-8).join("\n"));
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
