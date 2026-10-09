import { chromium } from '/Users/huabinxu/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { createHash } from 'crypto';

const PUB = '/Users/huabinxu/WorkBuddy/2026-08-11-21-17-02/MRender-Web/public/assets/hdri';
const MAN = '/Users/huabinxu/WorkBuddy/2026-08-11-21-17-02/MRender-Web/scripts/curated_hdr_manifest.json';
const BASE = 'http://127.0.0.1:5180/';
const outDir = '/Users/huabinxu/Desktop/workbuddy文档/MRender-Web/verify/iso-curated-preview';
mkdirSync(outDir, { recursive: true });

function ridOf(full) {
  const folder = full.includes('/dosch/') ? 'dosch' : 'hdrimaps';
  const root = PUB + '/' + folder;
  const sub = full.slice(root.length + 1).replace(/\.hdr$/i, '').split('/').slice(1);
  const san = s => s.replace(/[^a-zA-Z0-9\-_]/g, '_');
  return 'iso_' + folder + '_' + san(sub.join('_'));
}

const manifest = JSON.parse(readFileSync(MAN, 'utf8'));
const reps = manifest.clusters.map(c => c.rep);
// 均匀抽样 ~20 张
const N = 20, step = Math.max(1, Math.floor(reps.length / N));
const sample = [];
for (let i = 0; i < reps.length && sample.length < N; i += step) sample.push(reps[i]);

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const tmp = '/tmp/cur_prev.png';
const shots = [];
for (const full of sample) {
  const rid = ridOf(full);
  await page.evaluate((id) => window.MRender.getStore().updateEnvironment({ preset: id, intensity: 1 }), rid);
  // 轮询至画面稳定
  let prev = null, stable = 0, finalBuf = null;
  for (let i = 0; i < 12; i++) {
    await page.screenshot({ path: tmp });
    const h = createHash('md5').update(readFileSync(tmp)).digest('hex');
    if (h === prev) { stable++; if (stable >= 2) { finalBuf = readFileSync(tmp); break; } } else stable = 0;
    prev = h; await page.waitForTimeout(800);
  }
  if (!finalBuf) finalBuf = readFileSync(tmp);
  writeFileSync(`${outDir}/${rid}.png`, finalBuf);
  shots.push({ rid, src: `${outDir}/${rid}.png` });
  console.log('rendered', rid);
}
console.log(`done ${shots.length} previews`);
await browser.close();
