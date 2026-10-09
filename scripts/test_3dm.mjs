import { chromium } from "/Users/huabinxu/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs";
import fs from "fs";

const OUT = "/Users/huabinxu/Desktop/workbuddy文档/MRender-Web/verify";
fs.mkdirSync(OUT, { recursive: true });

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MODEL_3DM = "/Users/huabinxu/Desktop/工作/沱牌传承/瓶.3dm";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 浏览器内：base64 -> Uint8Array -> File -> 导入；返回 import 结果
async function importFromB64(args) {
  const { b64, name } = args;
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "model/3dm" });
  const file = new File([blob], name, { type: "model/3dm" });
  try {
    const id = await window.MRender.importModel(file);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// 遍历 engine.scene 计算导入模型的实际尺寸（mm 单位，确认 unitScale 正确）+ 逐网格诊断
function bboxEval() {
  const engine = window.MRender.getEngine();
  const scene = engine.scene;
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let verts = 0;
  let meshCount = 0;
  const perMesh = [];
  scene.updateMatrixWorld(true);
  let totalTris = 0;
  scene.traverse((c) => {
    if (c.isLight) return;
    if (c === engine.grid || c === engine.axes || c === engine.floorMesh) return;
    if (c.isMesh && c.geometry) {
      const idx = c.geometry.getIndex();
      const pos = c.geometry.getAttribute("position");
      const t = idx ? idx.count / 3 : (pos ? pos.count / 3 : 0);
      totalTris += Math.round(t);
      meshCount++;
      if (!pos) return;
      const m = c.matrixWorld;
      const total = pos.count;
      let lmin = [Infinity, Infinity, Infinity], lmax = [-Infinity, -Infinity, -Infinity];
      const stride = Math.max(1, Math.floor(total / 20000));
      for (let i = 0; i < total; i += stride) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const wx = m.elements[0] * x + m.elements[4] * y + m.elements[8] * z + m.elements[12];
        const wy = m.elements[1] * x + m.elements[5] * y + m.elements[9] * z + m.elements[13];
        const wz = m.elements[2] * x + m.elements[6] * y + m.elements[10] * z + m.elements[14];
        for (let k = 0; k < 3; k++) {
          const w = [wx, wy, wz][k];
          if (w < min[k]) min[k] = w; if (w > max[k]) max[k] = w;
          if (w < lmin[k]) lmin[k] = w; if (w > lmax[k]) lmax[k] = w;
        }
        verts++;
      }
      const size = [+(lmax[0] - lmin[0]).toFixed(1), +(lmax[1] - lmin[1]).toFixed(1), +(lmax[2] - lmin[2]).toFixed(1)];
      perMesh.push({
        name: c.name || "(unnamed)", verts: total, size, maxDim: +Math.max(...size).toFixed(1),
        otype: c.userData?.objectType || c.userData?.attributes?.objectType || "?",
        flags: { mesh: c.isMesh === true, pts: c.isPoints === true, line: c.isLine === true || c.isLineSegments === true, spr: c.isSprite === true },
        parent: c.parent ? (c.parent.type + (c.parent.userData?.mrenderId ? "#" + c.parent.userData.mrenderId : "")) : "NULL",
      });
    }
  });
  if (verts === 0) return { ok: false, meshCount, note: "scene 中未找到可测网格" };
  perMesh.sort((a, b) => b.verts - a.verts);
  let cacheMeshes = 0;
  let cacheUntagged = 0;
  try {
    engine.modelCache.forEach((obj) => {
      obj.traverse((c) => {
        if (c.isMesh) {
          cacheMeshes++;
          const ot = c.userData?.objectType;
          if (!ot || !["Brep", "Extrusion", "SubD", "Mesh", "Surface", "InstanceReference"].includes(ot)) cacheUntagged++;
        }
      });
    });
  } catch (e) {}
  const direct = [];
  // 找出任意「世界尺寸 > 1000」的网格，并打印其完整祖先链，定位泄漏来源
  const giantChains = [];
  scene.updateMatrixWorld(true);
  scene.traverse((c) => {
    if (!c.isMesh) return;
    const pos = c.geometry?.getAttribute?.("position");
    if (!pos) return;
    let mx = -Infinity;
    for (let i = 0; i < pos.count; i++) { mx = Math.max(mx, Math.abs(pos.getX(i)), Math.abs(pos.getY(i)), Math.abs(pos.getZ(i))); }
    if (mx <= 1000) return;
    const chain = [];
    let p = c;
    while (p) { chain.push(`${p.type}<${p.name || "noname"}>${p.userData?.mrenderId ? "#" + p.userData.mrenderId : ""}`); p = p.parent; }
    giantChains.push({ name: c.name || "(unnamed)", verts: pos.count, localMax: +mx.toFixed(1), chain });
  });
  scene.children.forEach((ch) => {
    let mc = 0;
    const meshList = [];
    let hasGiant = false;
    let junkNames = [];
    ch.traverse((c) => {
      if (c.isMesh || c.isLine || c.isPoints || c.isLineSegments || c.isSprite) {
        mc += c.isMesh ? 1 : 0;
        if (c.isMesh) {
          const pos = c.geometry.getAttribute("position");
          if (pos) { let mx = -Infinity; for (let i = 0; i < pos.count; i++) mx = Math.max(mx, Math.abs(pos.getX(i)), Math.abs(pos.getY(i)), Math.abs(pos.getZ(i))); if (mx > 50000) hasGiant = true; }
          const nm = c.name || "(noname)";
          if (["START", "END", "XYZE"].includes(nm) || /ground/i.test(nm)) junkNames.push(nm + "(" + c.geometry.getAttribute("position")?.count + ")");
          if (meshList.length < 30) meshList.push({ n: nm, ot: c.userData?.objectType || "?", k: "M" });
        }
      }
    });
    direct.push({ type: ch.type, name: ch.name || "(noname)", mrenderId: ch.userData?.mrenderId || null, childMeshes: mc, isGrid: ch === engine.grid, isAxes: ch === engine.axes, isFloor: ch === engine.floorMesh, hasGiant, junkNames, meshList });
  });
  return {
    ok: true,
    meshCount,
    totalTris,
    cacheMeshes,
    cacheUntagged,
    sceneDirectChildren: direct,
    combinedSize: [+(max[0] - min[0]).toFixed(1), +(max[1] - min[1]).toFixed(1), +(max[2] - min[2]).toFixed(1)],
    combinedCenter: [+((max[0] + min[0]) / 2).toFixed(1), +((max[1] + min[1]) / 2).toFixed(1), +((max[2] + min[2]) / 2).toFixed(1)],
    giantChains,
    topMeshes: perMesh,
  };
}

async function main() {
  const b64 = fs.readFileSync(MODEL_3DM).toString("base64");
  console.log("base64 length:", b64.length, "(≈", (b64.length / 1024 / 1024).toFixed(1), "MB)");

  const browser = await chromium.launch({
    headless: false,
    executablePath: CHROME,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("console", (msg) => console.log("[console]", msg.text()));
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  await page.goto("http://localhost:5180/", { waitUntil: "networkidle", timeout: 120000 });
  // 清除可能残留的持久化场景，避免旧版（未裁剪）导入结果污染本次验证
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: "networkidle", timeout: 120000 });
  await sleep(1500);
  await page.waitForFunction(() => typeof window.MRender !== "undefined" && window.MRender.getStore, { timeout: 30000 });

  await page.evaluate(() => window.MRender.getStore().newScene());
  await sleep(800);

  // DEBUG: dump scene BEFORE import to see if junk already exists
  const preImport = await page.evaluate(() => {
    const engine = window.MRender.getEngine();
    const out = [];
    engine.scene.children.forEach((ch) => {
      let mc = 0; ch.traverse((c) => { if (c.isMesh) mc++; });
      out.push({ type: ch.type, name: ch.name || "(noname)", mrenderId: ch.userData?.mrenderId || null, childMeshes: mc });
    });
    return { storeObjCount: window.MRender.getStore().scene.objects.length, sceneChildren: out };
  });
  console.log("[PRE-IMPORT scene]", JSON.stringify(preImport));

  console.log("导入 3DM (瓶.3dm) ...");
  const importResult = await page.evaluate(importFromB64, { b64, name: "瓶.3dm" });
  console.log("导入结果:", JSON.stringify(importResult));
  await sleep(6000);

  await page.screenshot({ path: `${OUT}/C1-沱牌瓶3DM-默认.png`, timeout: 120000 });

  const info = await page.evaluate(() => {
    const st = window.MRender.getStore();
    const o0 = st.scene.objects[0];
    return {
      objectCount: st.scene.objects.length,
      objects: st.scene.objects.map((o) => ({ id: o.id, name: o.name, materialId: o.materialId, visible: o.visible, sourceFormat: o.sourceFormat, stats: o.stats, sourceLen: o.source ? o.source.length : 0, sourceHead: o.source ? o.source.slice(0, 24) : null })),
      environment: st.scene.environment.preset,
      background: st.scene.environment.background,
      ground: st.scene.environment.ground,
    };
  });
  const boxes = await page.evaluate(bboxEval);
  const report = { model: "瓶.3dm", import: importResult, scene: info, bbox: boxes };
  fs.writeFileSync(`${OUT}/report_C_3dm.json`, JSON.stringify(report, null, 2));
  console.log("报告:", JSON.stringify(report, null, 2));

  await browser.close();
  console.log("3DM 测试完成");
}
main().catch((e) => { console.error(e); process.exit(1); });
