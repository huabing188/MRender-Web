import { chromium } from "/Users/huabinxu/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs";
import fs from "fs";
import path from "path";

const OUT = "/Users/huabinxu/Desktop/workbuddy文档/MRender-Web/verify";
fs.mkdirSync(OUT, { recursive: true });

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MODEL_OBJ = "/Users/huabinxu/Desktop/codex文件/MRender/Resources/baijiu_bottle.obj";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({
    headless: false,
    executablePath: CHROME,
    args: [
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", (msg) => console.log("[console]", msg.text()));
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  await page.goto("http://localhost:5180/", { waitUntil: "networkidle", timeout: 120000 });
  await sleep(1500);

  // 等待 MRender API 就绪
  await page.waitForFunction(() => typeof window.MRender !== "undefined" && window.MRender.getStore, { timeout: 30000 });

  // 新建空场景，避免默认酒瓶干扰
  await page.evaluate(() => {
    const st = window.MRender.getStore();
    st.newScene();
  });
  await sleep(800);

  // 导入 OBJ（白酒瓶，验证默认环境/材质/网格隐藏）
  console.log("导入 OBJ:", MODEL_OBJ);
  const bufObj = fs.readFileSync(MODEL_OBJ);
  await page.evaluate(async (data) => {
    const blob = new Blob([new Uint8Array(data)]);
    const file = new File([blob], "baijiu_bottle.obj", { type: "text/plain" });
    await window.MRender.importModel(file);
  }, Array.from(bufObj));
  await sleep(5000);

  // 截图：OBJ 默认视角
  await page.screenshot({ path: `${OUT}/B1-白酒瓶-默认HDR-白塑料.png`, timeout: 120000 });

  // 获取场景统计
  const info = await page.evaluate(() => {
    const st = window.MRender.getStore();
    return {
      objectCount: st.scene.objects.length,
      objects: st.scene.objects.map((o) => ({ id: o.id, name: o.name, type: o.type, materialId: o.materialId, visible: o.visible, sourceFormat: o.sourceFormat })),
      environment: st.scene.environment,
      gridAxes: { grid: window.MRender.getEngine()?.grid?.visible, axes: window.MRender.getEngine()?.axes?.visible },
    };
  });
  fs.writeFileSync(`${OUT}/report_B.json`, JSON.stringify(info, null, 2));
  console.log("场景信息:", JSON.stringify(info, null, 2));

  await browser.close();
  console.log("测试完成，输出:", OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
