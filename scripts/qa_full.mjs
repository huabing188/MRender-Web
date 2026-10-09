// MRender-Web 全功能 QA 验证：跑真实项目，逐项验证功能，捕获控制台错误。
import { chromium } from "/Users/huabinxu/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs";
import fs from "fs";
import http from "http";
import path from "path";

const OUT = "/Users/huabinxu/Desktop/workbuddy文档/MRender-Web/verify";
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 真实项目文件
const MODEL_3DM = "/Users/huabinxu/Desktop/工作/沱牌传承/瓶.3dm";
const MODEL_OBJ = "/Users/huabinxu/Desktop/工作/珍酒-善酱/瓶.obj";
const MODEL_STL = "/Users/huabinxu/Desktop/工作/珍酒-善酱/下龙.stl";

const report = { pass: 0, fail: 0, features: [], consoleErrors: [], pageErrors: [] };
function check(name, ok, detail) {
  report.features.push({ name, ok: !!ok, detail });
  if (ok) report.pass++; else report.fail++;
  console.log(`[qa] ${ok ? "PASS" : "FAIL"} — ${name}${detail ? " :: " + JSON.stringify(detail) : ""}`);
}

function pngSize(buf) {
  // IHDR at offset 16: width(4) height(4)
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

// 隐藏 UI，仅留 canvas 截图（WebGL canvas 用 page.screenshot 比 locator 稳定）
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
    c.style.position = "fixed"; c.style.left = "0"; c.style.top = "0";
    c.style.width = "100vw"; c.style.height = "100vh"; c.style.zIndex = "99999";
  });
  await sleep(1000);
  await page.screenshot({ path, timeout: 120000 });
}

async function getSceneStats(page) {
  return await page.evaluate(() => window.MRender.getEngine().getSceneStats());
}

async function main() {
  const browser = await chromium.launch({
    headless: true, executablePath: CHROME,
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage", "--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" || m.type() === "warning") report.consoleErrors.push(`[${m.type()}] ${t}`);
  });
  page.on("pageerror", (e) => report.pageErrors.push(String(e)));

  // 本地静态服务器：供浏览器以 fetch 方式取得模型文件并构造 File（贴近真实拖拽入件，
  // 避免把 300MB+ 文件以 base64 作为 page.evaluate 参数传递导致 Chromium IPC 参数序列化爆掉、
  // 渲染进程被杀 "Target page, context or browser has been closed"）。中文文件名需 encodeURIComponent。
  const MODEL_ROUTES = {
    "model.obj": MODEL_OBJ,
    "model.stl": MODEL_STL,
    "model.3dm": MODEL_3DM,
  };
  const modelServer = http.createServer((req, res) => {
    const key = decodeURIComponent(req.url.split("?")[0].replace(/^\//, ""));
    const fp = MODEL_ROUTES[key];
    if (!fp || !fs.existsSync(fp)) { res.statusCode = 404; res.end("nf"); return; }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/octet-stream");
    fs.createReadStream(fp).pipe(res);
  });
  await new Promise((r) => modelServer.listen(0, r));
  const MODEL_PORT = modelServer.address().port;

  // 通过 fetch 取得文件字节 → File → importModel（单参数对象，避免超大 base64 参数）
  async function doImportUrl(page, routeKey, name, mime) {
    return await page.evaluate(
      async ({ url, name, mime }) => {
        const buf = await (await fetch(url)).arrayBuffer();
        const file = new File([buf], name, { type: mime });
        return await window.MRender.importModel(file);
      },
      { url: `http://localhost:${MODEL_PORT}/${encodeURIComponent(routeKey)}`, name, mime }
    );
  }

  await page.goto("http://localhost:5180/", { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForFunction(() => !!(window.MRender && window.MRender.getEngine && window.MRender.getEngine()), null, { timeout: 60000 });
  await sleep(1500);

  // ---------- 阶段 A：默认场景 ----------
  const a = await page.evaluate(() => {
    const st = window.MRender.getStore();
    const eng = window.MRender.getEngine();
    return {
      objects: st.scene.objects.length,
      tris: window.MRender.getEngine().getSceneStats().triangles,
      hasFloor: !!eng.floorMesh,
      hasCatcher: !!eng.shadowCatcher,
      matCount: Object.keys(st.scene.materials).length,
    };
  });
  check("默认场景含示例白酒瓶", a.objects >= 1 && a.tris > 0, a);
  check("引擎含实体地面+接影面", a.hasFloor && a.hasCatcher, a);
  check("内置材质库非空", a.matCount > 20, { matCount: a.matCount });
  await takeCleanShot(page, `${OUT}/qa_01_default.png`);

  // ---------- 阶段 A2：撤销/重做 ----------
  const undo = await page.evaluate(async () => {
    const S = () => window.MRender.getStore();
    const id = S().scene.objects[0].id;
    const before = S().scene.objects[0].materialId;
    S().assignMaterial(id, "mat_glass_clear");
    const mid = S().scene.objects[0].materialId;
    S().undo();
    const afterUndo = S().scene.objects[0].materialId;
    S().redo();
    const afterRedo = S().scene.objects[0].materialId;
    return { before, mid, afterUndo, afterRedo };
  });
  check("撤销/重做 材质赋值", undo.mid === "mat_glass_clear" && undo.afterUndo === undo.before && undo.afterRedo === "mat_glass_clear", undo);

  // ---------- 阶段 A3：点击拾取选中 ----------
  const pick = await page.evaluate(() => {
    const eng = window.MRender.getEngine();
    const rect = eng.renderer.domElement.getBoundingClientRect();
    const id = eng.pickAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { id, hasCanvas: !!eng.renderer.domElement };
  });
  check("屏幕中心拾取返回对象ID", !!pick.id, pick);

  // ---------- 阶段 B：导入真实 3DM 项目（沱牌瓶）----------
  await page.evaluate(() => window.MRender.getStore().newScene());
  await sleep(400);
  const imp3dm = await doImportUrl(page, "model.3dm", "瓶.3dm", "model/3dm");
  await sleep(2500);
  const b3 = await page.evaluate(() => {
    const st = window.MRender.getStore();
    const o = st.scene.objects.find((o) => o.name === "瓶") || st.scene.objects[0];
    return { count: st.scene.objects.length, id: o?.id, tris: o?.stats?.triangles, name: o?.name };
  });
  check("3DM 导入成功(沱牌瓶)", !!b3.id && b3.count === 1 && b3.tris > 10000, b3);
  // 立瓶
  await page.evaluate(() => {
    const S = () => window.MRender.getStore();
    const o = S().scene.objects[0];
    S().updateObject(o.id, { transform: { position: [0, 0, 0], rotation: [0, 25, -90], scale: [1, 1, 1] } });
  });
  await page.evaluate(() => window.MRender.getEngine().setViewMode("查看全部"));
  await sleep(800);
  await takeCleanShot(page, `${OUT}/qa_02_import_3dm.png`);

  // ---------- 阶段 C：材质赋值 ----------
  const matAssign = await page.evaluate(() => {
    const S = () => window.MRender.getStore();
    const id = S().scene.objects[0].id;
    S().assignMaterial(id, "mat_glass_clear");
    const eng = window.MRender.getEngine();
    let applied = null;
    eng.objectMap.get(id)?.traverse((n) => { if (n.isMesh && !n.userData.isLabel && n.material && !applied) applied = n.material.type; });
    return { store: S().scene.objects[0].materialId, engineMat: applied };
  });
  check("材质赋值→玻璃(引擎应用)", matAssign.store === "mat_glass_clear", matAssign);
  await takeCleanShot(page, `${OUT}/qa_03_material_glass.png`);

  // 陶瓷
  await page.evaluate(() => window.MRender.getStore().assignMaterial(window.MRender.getStore().scene.objects[0].id, "mat_ceramic_white"));
  await sleep(600); await takeCleanShot(page, `${OUT}/qa_04_material_ceramic.png`);
  // 金属
  await page.evaluate(() => window.MRender.getStore().assignMaterial(window.MRender.getStore().scene.objects[0].id, "mat_metal_chrome"));
  await sleep(600); await takeCleanShot(page, `${OUT}/qa_05_material_metal.png`);
  // 还原玻璃
  await page.evaluate(() => window.MRender.getStore().assignMaterial(window.MRender.getStore().scene.objects[0].id, "mat_glass_clear"));
  await sleep(600);

  // ---------- 阶段 D：PBR 参数编辑 ----------
  const pbr = await page.evaluate(() => {
    const S = () => window.MRender.getStore();
    const id = S().scene.objects[0].id;
    S().assignMaterial(id, "mat_plastic_white");
    const mid = "mat_plastic_white";
    S().updateMaterial(mid, { baseColor: [1, 0.2, 0.2], roughness: 0.15, metallic: 0.6, transmission: 0, opacity: 1 });
    const m = S().scene.materials[mid];
    return { baseColor: m.baseColor, roughness: m.roughness, metallic: m.metallic };
  });
  check("PBR 参数编辑写入 store", pbr.baseColor[0] === 1 && Math.abs(pbr.roughness - 0.15) < 1e-6 && pbr.metallic === 0.6, pbr);
  await takeCleanShot(page, `${OUT}/qa_06_pbr_edit.png`);

  // ---------- 阶段 E：真实 PBR 纹理（ambientCG）----------
  const tex = await page.evaluate(() => {
    const st = window.MRender.getStore();
    const id = st.scene.objects[0].id;
    st.assignMaterial(id, "mat_ac_wood");
    const m = st.scene.materials["mat_ac_wood"];
    return { hasColorMap: !!m.maps.color, src: m.maps.color?.src };
  });
  check("PBR 纹理材质含贴图槽", tex.hasColorMap && /Wood075/.test(tex.src || ""), tex);
  await sleep(1200);
  await takeCleanShot(page, `${OUT}/qa_07_texture_pbr.png`);

  // ---------- 阶段 F：标签/贴花 ----------
  const label = await page.evaluate(async () => {
    const S = () => window.MRender.getStore();
    const id = S().scene.objects[0].id;
    // 生成一张带文字的透明 PNG
    const c = document.createElement("canvas"); c.width = 512; c.height = 256;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "rgba(20,40,90,0.92)"; ctx.fillRect(0, 40, 512, 176);
    ctx.fillStyle = "#fff"; ctx.font = "bold 72px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("QA 标签", 256, 150);
    const src = c.toDataURL("image/png");
    S().addLabel(id, { id: "lb_1", name: "标签1", src, position: [0.5, 0.5], scale: [0.5, 0.5], rotation: 0, opacity: 1, doubleSide: true, materialId: null });
    return { labels: S().scene.objects[0].labels?.length };
  });
  check("标签/贴花添加成功", label.labels === 1, label);
  await sleep(1200);
  await takeCleanShot(page, `${OUT}/qa_08_label.png`);

  // ---------- 阶段 G：灯光 ----------
  const light = await page.evaluate(() => {
    const S = () => window.MRender.getStore();
    S().addLight({ id: "lt_test", name: "测试灯", type: "area", position: [200, 300, 200], intensity: 25, color: [1, 0.9, 0.7], size: [120, 80], visible: true });
    S().setShowLightHelpers(true);
    const eng = window.MRender.getEngine();
    return { count: S().scene.lights.length, helperVisible: eng.lightHelperMap?.size };
  });
  check("添加灯光成功", light.count === 3, light);
  await sleep(1000);
  await takeCleanShot(page, `${OUT}/qa_09_lights.png`);

  // ---------- 阶段 H：HDR 环境切换 ----------
  await page.evaluate(() => window.MRender.getStore().updateEnvironment({ preset: "venice" }));
  await sleep(3000);
  const envh = await page.evaluate(() => {
    const st = window.MRender.getStore();
    const eng = window.MRender.getEngine();
    return { preset: st.scene.environment.preset, envSet: !!eng.scene.environment };
  });
  check("HDR 环境切换(venice)", envh.preset === "venice" && envh.envSet, envh);
  await takeCleanShot(page, `${OUT}/qa_10_env_venice.png`);

  // ---------- 阶段 I：背景模式 ----------
  const bgColor = await page.evaluate(() => {
    window.MRender.getStore().updateEnvironment({ background: { mode: "color", color: [0.5, 0.1, 0.1] } });
    return window.MRender.getStore().scene.environment.background.mode;
  });
  check("背景模式→纯色", bgColor === "color", { bgColor });
  await sleep(900); await takeCleanShot(page, `${OUT}/qa_11_bg_color.png`);
  const bgTrans = await page.evaluate(() => {
    window.MRender.getStore().updateEnvironment({ background: { mode: "transparent" } });
    return window.MRender.getStore().scene.environment.background.mode;
  });
  check("背景模式→透明", bgTrans === "transparent", { bgTrans });
  await sleep(900); await takeCleanShot(page, `${OUT}/qa_12_bg_transparent.png`);

  // ---------- 阶段 J：相机参数 ----------
  const cam = await page.evaluate(() => {
    const S = () => window.MRender.getStore();
    S().updateCamera({ fov: 22, exposure: 1.2, whiteBalance: 4500 });
    const c = S().scene.camera;
    const eng = window.MRender.getEngine();
    return { fov: c.fov, exposure: c.exposure, wb: c.whiteBalance, engFov: eng.camera.fov, engExp: eng.renderer.toneMappingExposure };
  });
  check("相机参数应用(FOV/曝光/白平衡)", cam.fov === 22 && cam.exposure === 1.2 && cam.wb === 4500 && cam.engFov === 22 && Math.abs(cam.engExp - Math.pow(2, 1.2)) < 1e-4, cam);
  await page.evaluate(() => window.MRender.getStore().updateEnvironment({ background: { mode: "hdr" } }));
  await sleep(800);

  // ---------- 阶段 K：PNG 导出尺寸 ----------
  const expUrl = await page.evaluate(async () => await window.MRender.getEngine().exportPNG([1920, 1080], false));
  fs.writeFileSync(`${OUT}/qa_13_export_1920.png`, Buffer.from(expUrl.split(",")[1], "base64"));
  const dim = pngSize(fs.readFileSync(`${OUT}/qa_13_export_1920.png`));
  check("PNG 导出 1920×1080", dim[0] === 1920 && dim[1] === 1080, { dim, urlLen: expUrl.length });

  // ---------- 阶段 L：保存/加载 JSON ----------
  const saveLoad = await page.evaluate(() => {
    const st = window.MRender.getStore();
    const json = JSON.stringify(st.scene);
    const parsed = JSON.parse(json);
    const before = st.scene.objects.length;
    st.loadScene(parsed);
    const after = window.MRender.getStore().scene.objects.length;
    return { before, after, roundTrip: before === after };
  });
  check("保存/加载 JSON 往返一致", saveLoad.roundTrip && saveLoad.after >= 1, saveLoad);

  // ---------- 阶段 M：打散/解组 ----------
  await page.evaluate(() => window.MRender.getStore().newScene());
  await sleep(300);
  await doImportUrl(page, "model.3dm", "瓶.3dm", "model/3dm");
  await sleep(2500);
  const ungroup = await page.evaluate(async () => {
    const eng = window.MRender.getEngine();
    const id = window.MRender.getStore().scene.objects[0].id;
    const res = await eng.ungroupObject(id);
    return { ok: res.ok, count: res.count };
  });
  check("打散/解组生成多个部件", ungroup.ok && ungroup.count >= 2, ungroup);
  await page.evaluate(() => window.MRender.getEngine().setViewMode("查看全部"));
  await sleep(800);
  await takeCleanShot(page, `${OUT}/qa_14_ungroup.png`);

  // ---------- 阶段 N：OBJ 导入格式覆盖 ----------
  await page.evaluate(() => window.MRender.getStore().newScene());
  await sleep(300);
  const impObj = await doImportUrl(page, "model.obj", "瓶.obj", "model/obj");
  await sleep(2000);
  const oObj = await page.evaluate(() => ({ count: window.MRender.getStore().scene.objects.length, tris: window.MRender.getStore().scene.objects[0]?.stats?.triangles }));
  check("OBJ 导入成功(珍酒瓶)", !!impObj && oObj.count === 1 && oObj.tris > 1000, oObj);
  await page.evaluate(() => window.MRender.getEngine().setViewMode("查看全部"));
  await sleep(800); await takeCleanShot(page, `${OUT}/qa_16_import_obj.png`);

  // ---------- 阶段 O：STL 导入格式覆盖 ----------
  await page.evaluate(() => window.MRender.getStore().newScene());
  await sleep(300);
  const impStl = await doImportUrl(page, "model.stl", "下龙.stl", "model/stl");
  await sleep(2000);
  const oStl = await page.evaluate(() => ({ count: window.MRender.getStore().scene.objects.length, tris: window.MRender.getStore().scene.objects[0]?.stats?.triangles }));
  check("STL 导入成功(下龙)", !!impStl && oStl.count === 1 && oStl.tris > 1000, oStl);
  await page.evaluate(() => window.MRender.getEngine().setViewMode("查看全部"));
  await sleep(800); await takeCleanShot(page, `${OUT}/qa_17_import_stl.png`);

  // ---------- 控制台/页面错误 ----------
  check("无页面级 JS 错误", report.pageErrors.length === 0, { count: report.pageErrors.length });
  check("无控制台错误(忽略 benign)", report.consoleErrors.filter((e) => !/WebGL|deprecat|Download the React/i.test(e)).length === 0, { errors: report.consoleErrors.slice(0, 12) });

  // 先写入报告（路径追踪放在最后，防止 SwiftShader 下崩溃导致丢失结果）
  writeReport();

  // ---------- 阶段 P：路径追踪出图（使用较轻的 demo bottle）----------
  try {
    await page.evaluate(() => {
      const S = () => window.MRender.getStore();
      S().resetScene();
      S().updateRender({ mode: "pathtrace", samples: 64, bounces: 6 });
      S().assignMaterial(S().scene.objects[0].id, "mat_plastic_white");
    });
    await sleep(500);
    await page.evaluate(() => window.MRender.getEngine().setViewMode("查看全部"));
    await sleep(800);
    const ptUrl = await page.evaluate(async () => await window.MRender.getEngine().exportPNG([900, 560], false));
    const pt = { len: ptUrl.length, prefix: ptUrl.slice(0, 15) };
    check("路径追踪出图返回结果", pt.len > 5000 && pt.prefix.startsWith("data:image"), pt);
    fs.writeFileSync(`${OUT}/qa_15_pathtrace.png`, Buffer.from(ptUrl.split(",")[1], "base64"));
    writeReport();
  } catch (e) {
    check("路径追踪出图返回结果", false, { error: String(e) });
    writeReport();
  }

  await browser.close();
  try { modelServer.close(); } catch {}
  console.log(`\n[qa] 汇总: ${report.pass} 通过 / ${report.fail} 失败`);
  if (report.consoleErrors.length) console.log("[qa] 控制台错误:", JSON.stringify(report.consoleErrors.slice(0, 20), null, 2));
  if (report.pageErrors.length) console.log("[qa] 页面错误:", JSON.stringify(report.pageErrors, null, 2));
  process.exit(0);
}

function writeReport() {
  const summary = {
    pass: report.pass, fail: report.fail,
    consoleErrors: report.consoleErrors, pageErrors: report.pageErrors,
    features: report.features,
  };
  fs.writeFileSync(`${OUT}/qa_report.json`, JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
