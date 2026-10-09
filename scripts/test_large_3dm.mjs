// 368M 大 3DM 导入压测：验证内存/解析稳定性
import { chromium } from "/Users/huabinxu/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs";
import fs from "fs";

const OUT = "/Users/huabinxu/Desktop/workbuddy文档/MRender-Web/verify";
fs.mkdirSync(OUT, { recursive: true });

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MODEL_PATH = "/Users/huabinxu/Desktop/工作/沱牌传承/修改/修改瓶.3dm";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const sizeMb = (fs.statSync(MODEL_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`[large-3dm] 测试文件: 修改瓶.3dm (${sizeMb} MB)`);

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

  await page.evaluate(() => {
    const st = window.MRender.getStore();
    st.newScene();
    st.updateRender({ device: "gpu", autoFallback: false });
    window.MRender.setGridVisible(false);
    window.MRender.setAxesVisible(false);
  });
  await sleep(1000);

  // 创建一个隐藏文件输入，用于 Playwright 直接注入大文件
  await page.evaluate(() => {
    if (!document.getElementById("mrender-test-file-input")) {
      const input = document.createElement("input");
      input.type = "file";
      input.id = "mrender-test-file-input";
      input.style.display = "none";
      document.body.appendChild(input);
    }
  });

  const t0 = Date.now();
  await page.setInputFiles("#mrender-test-file-input", MODEL_PATH);

  const result = await page.evaluate(async () => {
    const input = document.getElementById("mrender-test-file-input");
    const file = input.files[0];
    const tImport0 = performance.now();
    try {
      const id = await window.MRender.importModel(file);
      const tImport1 = performance.now();
      return { ok: true, id, importMs: Math.round(tImport1 - tImport0) };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  });
  const totalMs = Date.now() - t0;
  console.log("[large-3dm] 导入结果:", JSON.stringify(result), "总耗时:", totalMs, "ms");

  if (result.ok) {
    await sleep(3000);
    await page.evaluate(() => {
      const eng = window.MRender.getEngine();
      eng.setViewMode("查看全部");
    });
    await sleep(2000);

    const info = await page.evaluate(() => {
      const st = window.MRender.getStore();
      const o = st.scene.objects[0];
      return {
        objectCount: st.scene.objects.length,
        name: o?.name,
        materialId: o?.materialId,
        sourceFormat: o?.sourceFormat,
        triangles: o?.stats?.triangles,
        vertices: o?.stats?.vertices,
      };
    });
    console.log("[large-3dm] 场景信息:", JSON.stringify(info));

    const shotPath = `${OUT}/C4-修改瓶3DM-大文件.png`;
    await page.screenshot({ path: shotPath, timeout: 120000 });
    console.log("[large-3dm] 截图:", shotPath);

    const reportPath = `${OUT}/report_C_large_3dm.json`;
    fs.writeFileSync(reportPath, JSON.stringify({ result, info, totalMs, sizeMb }, null, 2));
    console.log("[large-3dm] 报告:", reportPath);
  }

  await browser.close();
  console.log("[large-3dm] 完成");
}

main().catch((e) => { console.error(e); process.exit(1); });
