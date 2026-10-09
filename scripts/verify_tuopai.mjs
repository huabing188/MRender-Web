// 沱牌瓶综合验证：3DM 导入 + 默认材质/环境/地面 + 玻璃 + 阴影 + 导出尺寸 + 遮挡选择
import { chromium } from "/Users/huabinxu/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs";
import fs from "fs";

function pngDims(buf) {
  if (buf.length < 24 || !buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const OUT = "/Users/huabinxu/Desktop/workbuddy文档/MRender-Web/verify";
fs.mkdirSync(OUT, { recursive: true });

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MODEL_3DM = "/Users/huabinxu/Desktop/工作/沱牌传承/瓶.3dm";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeSphereObj(r = 30, name = "inner_sphere") {
  const lines = [`o ${name}`, `s 1`];
  const segs = 24; const rings = 16;
  const verts = [];
  for (let y = 0; y <= rings; y++) {
    const theta = (y / rings) * Math.PI;
    const sinT = Math.sin(theta); const cosT = Math.cos(theta);
    for (let x = 0; x <= segs; x++) {
      const phi = (x / segs) * Math.PI * 2;
      verts.push([r * sinT * Math.cos(phi), r * cosT, r * sinT * Math.sin(phi)]);
    }
  }
  for (const v of verts) lines.push(`v ${v[0].toFixed(4)} ${v[1].toFixed(4)} ${v[2].toFixed(4)}`);
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < segs; x++) {
      const a = y * (segs + 1) + x + 1;
      const b = a + segs + 1;
      lines.push(`f ${a} ${b} ${a + 1}`);
      lines.push(`f ${a + 1} ${b} ${b + 1}`);
    }
  }
  return lines.join("\n");
}

async function importFromB64(args) {
  const { b64, name } = args;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "model/3dm" });
  const file = new File([blob], name, { type: "model/3dm" });
  try {
    const id = await window.MRender.importModel(file);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

async function importObjText(args) {
  const { text, name } = args;
  const blob = new Blob([text], { type: "text/plain" });
  const file = new File([blob], name, { type: "text/plain" });
  try {
    const id = await window.MRender.importModel(file);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
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
  await sleep(800);
  await page.screenshot({ path, timeout: 120000 });
}

async function main() {
  const b64 = fs.readFileSync(MODEL_3DM).toString("base64");
  const sphereObj = makeSphereObj(35, "inner_sphere");

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("console", (msg) => console.log("[console]", msg.text()));
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  await page.goto("http://localhost:5180/", { waitUntil: "networkidle", timeout: 120000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: "networkidle", timeout: 120000 });
  await sleep(1500);
  await page.waitForFunction(() => typeof window.MRender !== "undefined" && window.MRender.getStore, { timeout: 30000 });

  await page.evaluate(() => window.MRender.getStore().newScene());
  await sleep(800);

  // GPU 模式 + 隐藏网格坐标轴
  await page.evaluate(() => {
    const st = window.MRender.getStore();
    st.updateRender({ device: "gpu", autoFallback: false });
    window.MRender.setGridVisible(false);
    window.MRender.setAxesVisible(false);
  });
  await sleep(1000);

  // 1. 导入 3DM
  const importResult = await page.evaluate(importFromB64, { b64, name: "瓶.3dm" });
  console.log("[1] 导入 3DM:", JSON.stringify(importResult));
  await sleep(4000);

  const info = await page.evaluate(() => {
    const st = window.MRender.getStore();
    const o = st.scene.objects[0];
    return {
      objectCount: st.scene.objects.length,
      name: o?.name,
      materialId: o?.materialId,
      sourceFormat: o?.sourceFormat,
      triangles: o?.stats?.triangles,
      environment: st.scene.environment.preset,
      backgroundMode: st.scene.environment.background.mode,
      groundEnabled: st.scene.environment.ground.enabled,
      gridVisible: window.MRender.getEngine().grid.visible,
      axesVisible: window.MRender.getEngine().axes.visible,
    };
  });
  console.log("[1] 默认状态:", JSON.stringify(info));

  // 自动取景（保持模型原始朝向，验证默认导入状态）
  await page.evaluate(() => {
    const eng = window.MRender.getEngine();
    eng.setViewMode("查看全部");
  });
  await sleep(1500);

  const shot1 = `${OUT}/C1-沱牌瓶3DM-默认.png`;
  await takeCleanShot(page, shot1);
  console.log("[1] 默认渲染:", shot1);

  // 2. 把瓶子转竖直，再切换玻璃材质 + 打开地面阴影，验证玻璃折射与接触阴影
  await page.evaluate(() => {
    const st = window.MRender.getStore();
    const eng = window.MRender.getEngine();
    const bottleId = st.scene.objects.find((o) => o.name === "瓶")?.id;
    const bottle = bottleId ? eng.objectMap.get(bottleId) : null;
    if (bottle) {
      // 模型本地 Z 轴为长轴（瓶高），绕 X 轴 -90° 让瓶身竖直（Z -> Y）
      bottle.rotation.x = -Math.PI / 2;
      bottle.updateMatrixWorld(true);
    }
    eng.setViewMode("查看全部");
  });
  await sleep(1000);

  await page.evaluate(() => {
    const st = window.MRender.getStore();
    const o = st.scene.objects[0];
    if (o) st.assignMaterial(o.id, "mat_glass_clear");
    st.updateEnvironment({
      preset: "ph_blue_photo_studio",
      background: { mode: "color", color: [0.08, 0.1, 0.14] },
      ground: { enabled: true, shadow: true, color: [0.07, 0.08, 0.11], reflection: true, flatten: false, size: 800 },
      brightness: 1.1, contrast: 1.0,
    });
    st.updateCamera({ exposure: 0 });
  });
  await sleep(3000);

  const shot2 = `${OUT}/C2-沱牌瓶3DM-玻璃阴影.png`;
  await takeCleanShot(page, shot2);
  console.log("[2] 玻璃+阴影渲染:", shot2);

  // 3. 导出 PNG 并校验尺寸
  const exportUrl = await page.evaluate(async () => {
    const eng = window.MRender.getEngine();
    return eng.exportPNG([1920, 1080], false, "C3-沱牌瓶3DM-导出");
  });
  await sleep(800);
  const exportPath = `${OUT}/C3-沱牌瓶3DM-导出.png`;
  if (exportUrl && exportUrl.startsWith("data:")) {
    const b = Buffer.from(exportUrl.split(",")[1], "base64");
    fs.writeFileSync(exportPath, b);
  }
  const exportDims = pngDims(fs.readFileSync(exportPath));
  console.log("[3] 导出:", exportPath, "尺寸:", exportDims);

  // 4. 遮挡选择测试：导入一个球体放在瓶前方，隐藏前方球体后应能选中后方瓶
  const sphereImport = await page.evaluate(importObjText, { text: sphereObj, name: "front_sphere.obj" });
  console.log("[4] 前方球导入:", JSON.stringify(sphereImport));
  await sleep(1500);

  const selTest = await page.evaluate(async () => {
    const st = window.MRender.getStore();
    const eng = window.MRender.getEngine();
    const THREE = window.THREE;
    const bottleId = st.scene.objects.find((o) => o.name === "瓶")?.id;
    const sphereId = st.scene.objects.find((o) => o.name === "front_sphere")?.id;

    // 计算瓶子世界包围盒中心，把相机放在正前方，球放在相机与瓶子之间
    const bottleRoot = bottleId ? eng.objectMap.get(bottleId) : null;
    const sphereRoot = sphereId ? eng.objectMap.get(sphereId) : null;
    const box = new THREE.Box3();
    if (bottleRoot) box.setFromObject(bottleRoot);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dist = Math.max(size * 2.2, 500);
    const camPos = center.clone().add(new THREE.Vector3(0, 0, dist));

    eng.camera.position.copy(camPos);
    eng.controls.target.copy(center);
    eng.controls.update();
    eng.camera.updateMatrixWorld();
    eng.camera.updateProjectionMatrix();
    eng.scene.updateMatrixWorld(true);

    if (sphereId) {
      const spherePos = center.clone().add(new THREE.Vector3(0, 0, dist * 0.55));
      st.updateObject(sphereId, {
        transform: { position: spherePos.toArray(), rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
      });
      await new Promise((r) => setTimeout(r, 500));
    }

    function pickCenter() {
      const visibleRoots = Array.from(eng.objectMap.values()).filter((o) => o.visible);
      eng.scene.updateMatrixWorld(true);
      eng.camera.updateMatrixWorld();
      eng.raycaster.setFromCamera({ x: 0, y: 0 }, eng.camera);
      const hits = eng.raycaster.intersectObjects(visibleRoots, true);
      for (const h of hits) {
        let o = h.object;
        while (o) {
          if (o.userData.mrenderId) return o.userData.mrenderId;
          o = o.parent;
        }
      }
      return null;
    }

    const results = {};

    // 球和瓶都可见：应拾取前方球体
    st.selectObject(null);
    await new Promise((r) => setTimeout(r, 200));
    results.bothVisible = pickCenter();

    // 隐藏前方球体：应拾取后方瓶体
    if (sphereId) st.updateObject(sphereId, { visible: false });
    await new Promise((r) => setTimeout(r, 300));
    results.sphereHidden = pickCenter();

    // 再次显示球体、隐藏瓶体：应重新拾取球体
    if (sphereId) st.updateObject(sphereId, { visible: true });
    if (bottleId) st.updateObject(bottleId, { visible: false });
    await new Promise((r) => setTimeout(r, 300));
    results.bottleHidden = pickCenter();

    // 恢复
    if (bottleId) st.updateObject(bottleId, { visible: true });
    if (sphereId) st.updateObject(sphereId, { visible: true });

    return { bottleId, sphereId, results, center: center.toArray(), dist };
  });
  console.log("[4] 遮挡选择测试:", JSON.stringify(selTest));

  const reportPath = `${OUT}/report_C_tuopai.json`;
  fs.writeFileSync(reportPath, JSON.stringify({ import: importResult, info, exportDims, selection: selTest, shots: [shot1, shot2, exportPath] }, null, 2));
  console.log("[5] 报告:", reportPath);

  await browser.close();
  console.log("沱牌综合验证完成");
}

main().catch((e) => { console.error(e); process.exit(1); });
