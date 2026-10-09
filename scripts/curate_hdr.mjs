// 内容去重 v2：采样解码（快）+ 多分辨率签名 + 阈值扫描，找能落在 150–250 的“相同/类似只留最佳”方案。
import { HDRLoader } from '/Users/huabinxu/WorkBuddy/2026-08-11-21-17-02/MRender-Web/node_modules/three/examples/jsm/loaders/HDRLoader.js';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = '/Users/huabinxu/WorkBuddy/2026-08-11-21-17-02/MRender-Web/public/assets/hdri';
const OUT_MANIFEST = '/Users/huabinxu/WorkBuddy/2026-08-11-21-17-02/MRender-Web/scripts/curated_hdr_manifest.json';
const OUT_LIST = '/Users/huabinxu/WorkBuddy/2026-08-11-21-17-02/MRender-Web/scripts/curated_hdr_list.txt';
const GW = 32, GH = 16;

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e); const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (e.toLowerCase().endsWith('.hdr')) out.push(p);
  }
  return out;
}

function rawGrid(path) {
  const buf = readFileSync(path);
  const t = new HDRLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const { width: W, height: H, data } = t;
  const stride = data.length / (W * H);
  const step = Math.max(1, Math.floor((W * H) / 200000)); // 采样 ~20万像素/张，足够平滑
  const grid = new Float64Array(GW * GH);
  const cnt = new Int32Array(GW * GH);
  for (let y = 0; y < H; y += step) {
    const gy = Math.min(GH - 1, Math.floor((y / H) * GH));
    for (let x = 0; x < W; x += step) {
      const gx = Math.min(GW - 1, Math.floor((x / W) * GW));
      const i = (y * W + x) * stride;
      const L = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      const idx = gy * GW + gx; grid[idx] += Math.log2(L + 1e-4); cnt[idx]++;
    }
  }
  for (let k = 0; k < grid.length; k++) grid[k] = cnt[k] ? grid[k] / cnt[k] : 0;
  let mean = 0; for (const v of grid) mean += v; mean /= grid.length;
  let varr = 0; for (const v of grid) varr += (v - mean) ** 2; varr = Math.sqrt(varr / grid.length) || 1e-6;
  return { path, grid: Array.from(grid), std: varr, meanLog: mean };
}

function downsample(raw, rw, rh) {
  const out = new Float64Array(rw * rh);
  const bx = GW / rw, by = GH / rh;
  for (let gy = 0; gy < rh; gy++) for (let gx = 0; gx < rw; gx++) {
    let s = 0, n = 0;
    for (let yy = Math.floor(gy * by); yy < Math.floor((gy + 1) * by); yy++)
      for (let xx = Math.floor(gx * bx); xx < Math.floor((gx + 1) * bx); xx++) { s += raw.grid[yy * GW + xx]; n++; }
    out[gy * rw + gx] = s / n;
  }
  return out;
}
function normalize(v) {
  let m = 0; for (const x of v) m += x; m /= v.length;
  let s = 0; for (const x of v) s += (x - m) ** 2; s = Math.sqrt(s / v.length) || 1e-6;
  return v.map(x => (x - m) / s);
}
function dist(a, b) { let s = 0; for (let k = 0; k < a.length; k++) { const d = a[k] - b[k]; s += d * d; } return Math.sqrt(s); }

function clusterGroup(items, T) {
  const clusters = [];
  for (const it of items) {
    let best = -1, bestD = Infinity;
    for (let c = 0; c < clusters.length; c++) { const d = dist(it.pat, clusters[c].centroid); if (d < bestD) { bestD = d; best = c; } }
    if (best >= 0 && bestD < T) { clusters[best].members.push(it); const c = clusters[best].centroid; for (let k = 0; k < c.length; k++) c[k] += (it.pat[k] - c[k]) / clusters[best].members.length; }
    else clusters.push({ centroid: it.pat.slice(), members: [it] });
  }
  return clusters.map(cl => { let rep = cl.members[0]; for (const m of cl.members) if (m.std > rep.std) rep = m; return { rep: rep.path, size: cl.members.length, members: cl.members.map(m => m.path) }; });
}

// 分组
const groups = {};
for (const p of walk(join(ROOT, 'dosch'))) (groups['dosch'] ||= []).push(p);
for (const p of walk(join(ROOT, 'hdrimaps/HDRI'))) {
  const scene = p.slice(join(ROOT, 'hdrimaps/HDRI').length + 1).split('/')[0];
  (groups['hdrimaps:' + scene] ||= []).push(p);
}

// 解码（采样，快）
const sigs = {}; let n = 0;
for (const [g, files] of Object.entries(groups)) { sigs[g] = files.map(f => { n++; if (n % 200 === 0) console.error('decoded', n); return rawGrid(f); }); }
console.error('decoded', n);

function run(rw, rh, T) {
  const all = [];
  for (const sig of Object.values(sigs)) {
    const norm = sig.map(s => ({ ...s, pat: normalize(downsample(s, rw, rh)) }));
    all.push(...clusterGroup(norm, T));
  }
  return all;
}

// 扫描
const results = [];
for (const [rw, rh] of [[32,16],[16,8],[12,6],[8,4]]) for (const T of [1,1.5,2,2.5,3,4]) {
  const c = run(rw, rh, T); results.push({ rw, rh, T, kept: c.length });
}
console.error('sweep:');
for (const r of results) console.error(`  res ${r.rw}x${r.rh} T=${r.T} -> ${r.kept}`);

// 选落在 150–250 内、分辨率最粗+T最大（去重最狠）的组合
let pick = results.filter(r => r.kept >= 150 && r.kept <= 250).sort((a,b)=> (a.rw*b.rh)- (b.rw*b.rh) || b.T - a.T)[0];
if (!pick) { // 退而求其次：最接近 200 的
  let best=1e9; for(const r of results){const d=Math.abs(r.kept-200); if(d<best){best=d;pick=r;}}
}
console.error('PICK', JSON.stringify(pick));
const finalClusters = run(pick.rw, pick.rh, pick.T);
const kept = finalClusters.map(c => c.rep);
const manifest = { pick, totalFiles: n, totalKept: kept.length, totalDropped: n - kept.length, groups: Object.fromEntries(Object.entries(groups).map(([g,f])=>[g,f.length])), clusters: finalClusters.map(c=>({rep:c.rep,size:c.size,members:c.members})) };
writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2));
writeFileSync(OUT_LIST, kept.join('\n') + '\n');
console.log(JSON.stringify({ pick, totalFiles: n, totalKept: kept.length, totalDropped: n - kept.length }, null, 2));
