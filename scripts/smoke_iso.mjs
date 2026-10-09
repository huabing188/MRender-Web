import { chromium } from '/Users/huabinxu/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { createHash } from 'crypto';

const BASE = 'http://127.0.0.1:5180/';
const outDir = '/Users/huabinxu/Desktop/workbuddy文档/MRender-Web/verify/iso-smoke';
mkdirSync(outDir, { recursive: true });
const tmp = '/tmp/iso_poll.png';

const targets = [
  { id: 'iso_dosch_HC_DH-301HC', label: 'dosch-DH-301HC' },
  { id: 'iso_hdrimaps_HDRI_Auditorium_Auditorium-Polar', label: 'hdrimaps-Auditorium-Polar' },
  { id: 'iso_dosch_HC_DH-325HC', label: 'dosch-DH-325HC' },
  { id: 'iso_dosch_HC_DH-350HC', label: 'dosch-DH-350HC' },
];

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const hashFile = (p) => createHash('md5').update(readFileSync(p)).digest('hex');

const results = [];
for (const t of targets) {
  await page.evaluate((id) => { window.MRender.getStore().updateEnvironment({ preset: id, intensity: 1 }); }, t.id);
  let prev = null, stable = 0, finalHash = null;
  for (let i = 0; i < 14; i++) {
    await page.screenshot({ path: tmp });
    const h = hashFile(tmp);
    if (h === prev) { stable++; if (stable >= 2) { finalHash = h; break; } }
    else stable = 0;
    prev = h;
    await page.waitForTimeout(900);
  }
  if (!finalHash) { await page.screenshot({ path: tmp }); finalHash = hashFile(tmp); }
  const shot = `${outDir}/${t.label}.png`;
  writeFileSync(shot, readFileSync(tmp));
  results.push({ id: t.id, label: t.label, hash: finalHash, shot });
  console.log(`done ${t.label} hash=${finalHash}`);
}

const distinct = new Set(results.map(r => r.hash)).size;
console.log(JSON.stringify({ distinctHashes: distinct, total: results.length, results, errors }, null, 2));
await browser.close();
