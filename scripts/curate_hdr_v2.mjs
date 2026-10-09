import fs from "fs";
import path from "path";
import { HDRLoader } from "../node_modules/three/examples/jsm/loaders/HDRLoader.js";

const HDR_ROOT = "public/assets/hdri";
const OUT_LIST = "scripts/curated_hdr_final50.txt";
const OUT_REPORT = "scripts/hdr_validation_report.json";

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseHdr(filePath) {
  const buf = fs.readFileSync(filePath);
  const loader = new HDRLoader();
  const res = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const data = res.data;
  let sum = 0, sumSq = 0, max = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const l = luminance(data[i], data[i + 1], data[i + 2]);
    sum += l;
    sumSq += l * l;
    if (l > max) max = l;
    n++;
  }
  const mean = sum / n;
  const std = Math.sqrt(sumSq / n - mean * mean);
  return { width: res.width, height: res.height, mean, max, std };
}

function categoryOf(rel) {
  const low = rel.toLowerCase();
  const name = path.basename(rel, ".hdr").toLowerCase();
  // Industrial / urban FIRST (some names also contain hall/garage etc.)
  if (/\b(industrial|factory|construction|parking|truck|scaffold|gas.?station|cement|carwash|car.?wash|trailer|dock|bus.?terminal|brick|steel|subway|tunnel|warehouse|workshop|mechanical|utility)\b/.test(low)) return "industrial_urban";
  // Studio soft
  if (/\b(lb|soft|lightbox|photo.?studio|product|white|bright|studio_soft|panels_tilted)\b/.test(low)) return "studio_soft";
  // Studio high-contrast / dark
  if (/\b(hc|contrast|dark|black|dramatic|spot|studio_hard)\b/.test(low)) return "studio_contrast";
  // Outdoor / sky
  if (/\b(sky|outdoor|cloud|day|sun|park|street|city|landscape|sea|beach|forest|dawn|dusk|night)\b/.test(low)) return "outdoor_sky";
  // Indoor / architecture
  if (/\b(room|hall|lobby|bathroom|kitchen|auditorium|library|foyer|garage|station|dining|bedroom|living|office|church|closet|elevator|mall|apartment|entrance|window|foyer)\b/.test(low)) return "indoor_arch";
  // Fallback by folder
  if (low.includes("dosch")) {
    if (low.includes("lb")) return "studio_soft";
    if (low.includes("hc")) return "studio_contrast";
    if (low.includes("ll")) return "indoor_arch";
    return "studio_soft";
  }
  return "outdoor_sky";
}

const records = [];
const files = [];
for (const top of ["dosch", "hdrimaps"]) {
  const root = path.join(HDR_ROOT, top);
  if (!fs.existsSync(root)) continue;
  for (const dp of fs.readdirSync(root, { recursive: true, withFileTypes: false })) {
    // readdirSync recursive returns relative paths
  }
}

// Use glob-like manual walk
function walk(dir, relPrefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.join(relPrefix, entry.name);
    if (entry.isDirectory()) walk(abs, rel);
    else if (entry.name.toLowerCase().endsWith(".hdr")) files.push({ abs, rel });
  }
}
for (const top of ["dosch", "hdrimaps"]) walk(path.join(HDR_ROOT, top), top);

console.log(`Found ${files.length} HDR files`);

for (const { abs, rel } of files) {
  try {
    const stats = parseHdr(abs);
    const cat = categoryOf(rel);
    records.push({ abs, rel, cat, ...stats });
  } catch (e) {
    records.push({ abs, rel, cat: "error", error: String(e.message || e) });
  }
}

const bad = records.filter((r) => r.error || r.mean < 1);
console.log(`Bad/error HDRs: ${bad.length}`);
for (const b of bad.slice(0, 20)) console.log("  BAD", b.rel, b.error || `mean=${b.mean}`);

// Per-category selection: pick highest contrast, but avoid very dark (mean > 10) and very blown (max finite)
const TARGET = { studio_soft: 10, studio_contrast: 10, outdoor_sky: 10, indoor_arch: 10, industrial_urban: 10 };
const selected = [];
for (const [cat, n] of Object.entries(TARGET)) {
  const pool = records
    .filter((r) => r.cat === cat && !r.error && r.mean >= 1 && Number.isFinite(r.max))
    .sort((a, b) => b.std - a.std); // highest contrast first
  const picks = pool.slice(0, n);
  console.log(`Category ${cat}: ${picks.length}/${pool.length} selected`);
  selected.push(...picks);
}

// Write keep list
fs.writeFileSync(OUT_LIST, selected.map((s) => s.abs).join("\n"));
fs.writeFileSync(OUT_REPORT, JSON.stringify({ total: records.length, badCount: bad.length, categories: TARGET, selected: selected.length, records, bad }, null, 2));
console.log(`Selected ${selected.length} HDRs. List: ${OUT_LIST}`);
