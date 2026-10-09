// 为所有 HDR 生成 equirect 色调映射预览缩略图（无需 WebGL）
// 输出：public/assets/hdri/thumbs/<slug>.png  （slug = hdr 文件名去扩展名）
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { HDRLoader } from "../node_modules/three/examples/jsm/loaders/HDRLoader.js";

const HDR_ROOT = "public/assets/hdri";
const OUT_DIR = "public/assets/hdri/thumbs";
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---- 简易 PNG 编码器（RGB8, 无过滤）----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---- 收集所有 .hdr ----
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs);
    else if (e.name.toLowerCase().endsWith(".hdr")) files.push(abs);
  }
}
walk(HDR_ROOT);
console.log(`Found ${files.length} HDRs`);

const OW = 320, OH = 160;
let done = 0;
for (const abs of files) {
  const slug = path.basename(abs, ".hdr");
  const outPath = path.join(OUT_DIR, slug + ".png");
  try {
    const buf = fs.readFileSync(abs);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const res = new HDRLoader().parse(ab);
    const { width: W, height: H, data } = res; // Float32Array RGBA
    // 估算曝光：让平均亮度映射到 ~0.3
    let sum = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) { sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++; }
    const mean = sum / n;
    const exposure = 0.3 / (mean + 1e-3);
    const rgb = Buffer.alloc(OW * OH * 3);
    const sxStep = W / OW, syStep = H / OH;
    for (let oy = 0; oy < OH; oy++) {
      const sy0 = Math.floor(oy * syStep), sy1 = Math.max(sy0 + 1, Math.floor((oy + 1) * syStep));
      for (let ox = 0; ox < OW; ox++) {
        const sx0 = Math.floor(ox * sxStep), sx1 = Math.max(sx0 + 1, Math.floor((ox + 1) * sxStep));
        let r = 0, g = 0, b = 0, c = 0;
        for (let yy = sy0; yy < sy1 && yy < H; yy++) {
          for (let xx = sx0; xx < sx1 && xx < W; xx++) {
            const i = (yy * W + xx) * 4;
            r += data[i]; g += data[i + 1]; b += data[i + 2]; c++;
          }
        }
        r /= c; g /= c; b /= c;
        r = 1 - Math.exp(-exposure * r); g = 1 - Math.exp(-exposure * g); b = 1 - Math.exp(-exposure * b);
        r = Math.pow(r, 1 / 2.2); g = Math.pow(g, 1 / 2.2); b = Math.pow(b, 1 / 2.2);
        const o = (oy * OW + ox) * 3;
        rgb[o] = Math.max(0, Math.min(255, r * 255)) | 0;
        rgb[o + 1] = Math.max(0, Math.min(255, g * 255)) | 0;
        rgb[o + 2] = Math.max(0, Math.min(255, b * 255)) | 0;
      }
    }
    fs.writeFileSync(outPath, encodePNG(OW, OH, rgb));
    done++;
  } catch (e) {
    console.log("ERR", slug, e.message);
  }
}
console.log(`Generated ${done} thumbnails -> ${OUT_DIR}`);
