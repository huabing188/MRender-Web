// Cyclorama + 透明接影地面验证：
// 1) 默认状态（实体地面关 + 接影开）：物体应落地、有接触阴影、无可见地面。
// 2) 实体地面开：显示曲面影棚地面。
// 3) 玻璃材质 + 接影开：验证透明物体也能投射接触阴影。
import { chromium } from "/Users/huabinxu/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs";
import fs from "fs";

const OUT = "/Users/huabinxu/Desktop/workbuddy文档/MRender-Web/verify";
fs.mkdirSync(OUT, { recursive: true });

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MODEL_3DM = "/Users/huabinxu/Desktop/工作/沱牌传承/瓶.3dm";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function importInBrowser(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "model/3dm" });
  const file = new File([blob], "瓶.3dm", { type: "model/3dm" });
  return await window.MRender.importModel(file);
}

async function takeCleanShot(page, path) {
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
  await sleep(900);
  await page.screenshot({ path, timeout: 120000 });
}

async function main() {
  const b64 = fs.readFileSync(MODEL_3DM).toString("base64");
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("console", (m) => { const t = m.text(); if (t.startsWith("[cyc")) console.log(t); });
  await page.goto("http://localhost:5180/", { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForFunction(() => !!(window.MRender && window.MRender.getEngine && window.MRender.getEngine()), null, { timeout: 60000 });
  await sleep(1500);

  const imp = await page.evaluate(importInBrowser, b64);
  console.log("[cyc] import:", JSON.stringify(imp));
  await sleep(2000);

  // 把瓶子立起来、稍微转身
  await page.evaluate(() => {
    const st = window.MRender.getStore();
    const bottleId = st.scene.objects.find((o) => o.name === "瓶")?.id;
    if (bottleId) {
      st.updateObject(bottleId, { transform: { position: [0, 0, 0], rotation: [0, 25, -90], scale: [1, 1, 1] } });
    }
  });
  await sleep(500);

  // 把取景函数注册到 window，供后续 evaluate 复用
  await page.evaluate(() => {
    window.frameProduct = function () {
      const eng = window.MRender.getEngine();
      eng.setViewMode("查看全部");
      const cam = eng.camera;
      const target = eng.controls.target;
      const THREE = window.THREE;
      const dir = new THREE.Vector3().subVectors(cam.position, target);
      dir.multiplyScalar(0.5);
      cam.position.copy(target).add(dir);
      cam.position.y = Math.max(cam.position.y, target.y + dir.length() * 0.35);
      cam.updateProjectionMatrix();
      eng.controls.update();
    };
  });

  // C8: 默认状态（白塑料、实体地面关、透明接影开）
  const stateA = await page.evaluate(() => {
    const st = window.MRender.getStore();
    const eng = window.MRender.getEngine();
    window.frameProduct();
    st.updateEnvironment({ ground: { enabled: false, shadow: true, reflection: false, color: [0.1, 0.1, 0.11] } });
    const g = st.scene.environment.ground;
    return {
      store: { enabled: g.enabled, shadow: g.shadow },
      engine: { floor: eng.floorMesh?.visible, catcher: eng.shadowCatcher?.visible },
    };
  });
  console.log("[cyc] C8 state:", JSON.stringify(stateA));
  await sleep(1500);
  await takeCleanShot(page, `${OUT}/C8-接影地面-默认.png`);
  console.log("[cyc] C8 -> C8-接影地面-默认.png");

  // C9: 实体地面开（曲面 cyclorama）
  const stateB = await page.evaluate(() => {
    const st = window.MRender.getStore();
    const eng = window.MRender.getEngine();
    window.frameProduct();
    st.updateEnvironment({ ground: { enabled: true, shadow: true, reflection: true, color: [0.5, 0.52, 0.55] } });
    return {
      store: { enabled: st.scene.environment.ground.enabled, shadow: st.scene.environment.ground.shadow },
      engine: { floor: eng.floorMesh?.visible, catcher: eng.shadowCatcher?.visible },
    };
  });
  console.log("[cyc] C9 state:", JSON.stringify(stateB));
  await sleep(1500);
  await takeCleanShot(page, `${OUT}/C9-实体地面-开启.png`);
  console.log("[cyc] C9 -> C9-实体地面-开启.png");

  // C10: 接影开 + 玻璃材质，验证透明物体也能有接触阴影
  const stateC = await page.evaluate(() => {
    const st = window.MRender.getStore();
    const eng = window.MRender.getEngine();
    window.frameProduct();
    const o = st.scene.objects[0];
    if (o) st.assignMaterial(o.id, "mat_glass_clear");
    st.updateEnvironment({ ground: { enabled: false, shadow: true, reflection: false, color: [0.1, 0.1, 0.11] } });
    return {
      store: { enabled: st.scene.environment.ground.enabled, shadow: st.scene.environment.ground.shadow },
      engine: { floor: eng.floorMesh?.visible, catcher: eng.shadowCatcher?.visible },
    };
  });
  console.log("[cyc] C10 state:", JSON.stringify(stateC));
  await sleep(1500);
  await takeCleanShot(page, `${OUT}/C10-接影地面-玻璃.png`);
  console.log("[cyc] C10 -> C10-接影地面-玻璃.png");

  await browser.close();
  console.log("[cyc] done");
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
