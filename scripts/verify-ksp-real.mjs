// 真实 KeyShot 材质库 (.kmp) 无头验证（Node 端，无需浏览器/Playwright）
// 复用生产代码 src/engine/keyshotImport.ts，对真实 .kmp 跑完整解析链路。
// 用法: node scripts/verify-ksp-real.mjs
//   可选环境变量: KMP_PATH（默认桌面 keyshot参考文件/材质/材质.kmp）
//                 REPORT_PATH（默认 ~/Desktop/workbuddy文档/MRender-Web/verify/ksp/report-real.json）
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

const KMP = process.env.KMP_PATH
  || "/Users/huabinxu/Desktop/keyshot参考文件/材质/材质.kmp";
const REPORT = process.env.REPORT_PATH
  || join(homedir(), "Desktop/workbuddy文档/MRender-Web/verify/ksp/report-real.json");

// 1) 用 esbuild 即时转译生产解析模块（仅 import type，无运行时依赖）
const out = join(mkdtempSync(join(tmpdir(), "ksp-")), "keyshotImport.mjs");
await build({
  entryPoints: ["src/engine/keyshotImport.ts"],
  bundle: false, format: "esm", outfile: out, logLevel: "warning",
});
const { parseKeyshotMaterialLibrary } = await import(pathToFileURL(out).href);

// 2) 读真实 .kmp
const t0 = Date.now();
const buf = readFileSync(KMP);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const readMs = Date.now() - t0;

// 3) 解析
const t1 = Date.now();
const res = await parseKeyshotMaterialLibrary(ab);
const parseMs = Date.now() - t1;

// 4) 统计
const byType = {};
for (const m of res.materials) byType[m.type] = (byType[m.type] || 0) + 1;
const withColorTex = res.materials.filter(m => m.maps?.color).length;
const withNormalTex = res.materials.filter(m => m.maps?.normal).length;

const report = {
  kmp: KMP,
  sizeMB: +(buf.byteLength / 1024 / 1024).toFixed(1),
  readMs, parseMs,
  materials: res.materials.length,
  textures: res.textures.length,
  byType,
  withColorTex, withNormalTex,
  sampleMaterials: res.materials.slice(0, 20).map(m => ({ name: m.name, type: m.type })),
  sampleTextures: res.textures.slice(0, 12).map(t => t.name),
  pass: res.materials.length >= 90,
};

mkdirSync(join(REPORT, ".."), { recursive: true });
writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log("\nREPORT ->", REPORT);
