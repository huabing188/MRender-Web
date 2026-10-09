// 收紧到 ~200：HDRIMAPS 每场景最多 2 张；Dosch 按对比度(std logL)取剩余名额。删非保留文件。
import { HDRLoader } from '/Users/huabinxu/WorkBuddy/2026-08-11-21-17-02/MRender-Web/node_modules/three/examples/jsm/loaders/HDRLoader.js';
import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';

const ROOT = '/Users/huabinxu/WorkBuddy/2026-08-11-21-17-02/MRender-Web/public/assets/hdri';
const LIST = '/Users/huabinxu/WorkBuddy/2026-08-11-21-17-02/MRender-Web/scripts/curated_hdr_list.txt';
const OUT = '/Users/huabinxu/WorkBuddy/2026-08-11-21-17-02/MRender-Web/scripts/curated_hdr_tight.txt';
const TARGET = 200, GW = 32, GH = 16;

function walk(dir) { const o = []; for (const e of readdirSync(dir)) { const p = join(dir, e); const st = statSync(p); if (st.isDirectory()) o.push(...walk(p)); else if (e.toLowerCase().endsWith('.hdr')) o.push(p); } return o; }
function sig(path) {
  const buf = readFileSync(path);
  const t = new HDRLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const { width: W, height: H, data } = t; const stride = data.length / (W * H);
  const step = Math.max(1, Math.floor((W * H) / 200000));
  let sum = 0, n = 0, mn = 1e9, mx = -1e9;
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
    const i = (y * W + x) * stride; const L = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const ll = Math.log2(L + 1e-4); sum += ll; n++; mn = Math.min(mn, ll); mx = Math.max(mx, ll);
  }
  const mean = sum / n; let v = 0; // 用全幅 std 近似对比度
  // 重新扫一遍算 std
  return { path, mean, std: (() => { let s = 0; for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) { const i = (y * W + x) * stride; const L = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; const ll = Math.log2(L + 1e-4); s += (ll - mean) ** 2; } return Math.sqrt(s / n); })() };
}

// 读取 393 去重后保留集
const kept = readFileSync(LIST, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
console.error('re-signaturing', kept.length, 'kept files...');
const sigs = kept.map((p, i) => { if (i % 50 === 0) console.error('  ', i); return sig(p); });

// 分组
const hdri = {}, dosch = [];
for (const s of sigs) { if (s.path.includes('/hdrimaps/')) { const sc = s.path.split('/hdrimaps/HDRI/')[1].split('/')[0]; (hdri[sc] ||= []).push(s); } else dosch.push(s); }

// HDRIMAPS 每场景最多 1（按 std 取最佳；产品渲染以 Dosch 为主力，HDRIMAPS 只保场景覆盖）
const hdriKept = [];
for (const sc of Object.keys(hdri)) { const arr = hdri[sc].sort((a, b) => b.std - a.std); hdriKept.push(...arr.slice(0, 1)); }
// Dosch 按 std 取剩余
const doschTarget = Math.max(0, TARGET - hdriKept.length);
const doschKept = dosch.sort((a, b) => b.std - a.std).slice(0, doschTarget);

const finalPaths = [...hdriKept, ...doschKept].map(s => s.path);
writeFileSync(OUT, finalPaths.join('\n') + '\n');
console.error(`HDRIMAPS kept ${hdriKept.length}, Dosch kept ${doschKept.length}, TOTAL ${finalPaths.length}`);

// 删除非保留（仅 --commit 时执行）
const all = [...walk(join(ROOT, 'dosch')), ...walk(join(ROOT, 'hdrimaps'))];
const keepSet = new Set(finalPaths);
const toDelete = all.filter(f => !keepSet.has(f));
console.error(`would delete ${toDelete.length} files; keep ${finalPaths.length}; on-disk total ${all.length}`);
if (process.argv.includes('--commit')) {
  let del = 0, fail = 0;
  for (const f of toDelete) { try { unlinkSync(f); del++; } catch (e) { if (fail < 5) console.error('FAIL', f, e.code, e.message); fail++; } }
  console.error(`deleted ${del} non-kept files; failed ${fail}; remaining on disk: ${all.length - del}`);
} else {
  console.error('DRY RUN — 加 --commit 才真正删除');
}
