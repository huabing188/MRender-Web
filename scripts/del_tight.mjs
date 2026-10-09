import { readFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
const ROOT = '/Users/huabinxu/WorkBuddy/2026-08-11-21-17-02/MRender-Web/public/assets/hdri';
const TIGHT = '/Users/huabinxu/WorkBuddy/2026-08-11-21-17-02/MRender-Web/scripts/curated_hdr_tight.txt';
function walk(d){const o=[];for(const e of readdirSync(d)){const p=join(d,e);const st=statSync(p);if(st.isDirectory())o.push(...walk(p));else if(e.toLowerCase().endsWith('.hdr'))o.push(p);}return o;}
const keep = new Set(readFileSync(TIGHT,'utf8').split('\n').map(s=>s.trim()).filter(Boolean));
console.error('keep-set size:', keep.size);
// 校验 keep 都在磁盘
let missing=0; for(const k of keep){ try{statSync(k);}catch(e){missing++; if(missing<=5)console.error('KEEP MISSING',k);} }
console.error('keep missing on disk:', missing);
const all = [...walk(join(ROOT,'dosch')), ...walk(join(ROOT,'hdrimaps'))];
const toDelete = all.filter(f=>!keep.has(f));
console.error(`on-disk ${all.length}, toDelete ${toDelete.length}`);
let del=0, fail=0; const errs={};
for(const f of toDelete){ try{ unlinkSync(f); del++; }catch(e){ fail++; errs[e.code]=(errs[e.code]||0)+1; if(fail<=3) console.error('FAIL', e.code, e.message, e.stack?.split('\n')[1]); } }
console.error(`deleted ${del}, failed ${fail}`, JSON.stringify(errs));
console.error('remaining on disk:', all.length - del);
