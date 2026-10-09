// KeyShot 资产导入：解析 .kmp（材质库，LuxRender 格式）与 .ksp
// 纯前端实现：浏览器内置 DecompressionStream 解压 ZIP，无需额外依赖。
import type { MaterialData, TextureAsset, TextureSlotData, Vec3 } from "../core/types";

const MATERIAL_TYPES = new Set([
  "lux_metal", "lux_plastic", "lux_plastic_simple", "lux_window_glass", "lux_glass",
  "lux_glass_simple", "lux_brushed", "lux_paint", "lux_gem", "lux_granite",
  "lux_leather_tex", "lux_advanced", "lux_constant", "metallic_paint",
]);

// ---------- 底层：ZIP 解压（store + deflate-raw） ----------
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function decodeName(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true } as never).decode(bytes); }
  catch {
    try { return new TextDecoder("gbk").decode(bytes); }
    catch { return new TextDecoder("latin1").decode(bytes); }
  }
}

interface ZipEntry { name: string; data: Uint8Array; }

async function unzip(buffer: ArrayBuffer): Promise<ZipEntry[]> {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("不是有效的 .kmp/.ksp 压缩包");
  const cdOffset = dv.getUint32(eocd + 16, true);
  const cdCount = dv.getUint16(eocd + 10, true);
  const central: { name: string; method: number; compSize: number; lho: number }[] = [];
  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const lho = dv.getUint32(p + 42, true);
    const name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen));
    central.push({ name, method, compSize, lho });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const out: ZipEntry[] = [];
  for (const e of central) {
    const lv = new DataView(buffer, e.lho);
    const lNameLen = lv.getUint16(26, true);
    const lExtraLen = lv.getUint16(28, true);
    const start = e.lho + 30 + lNameLen + lExtraLen;
    let data: Uint8Array = bytes.subarray(start, start + e.compSize);
    if (e.method === 8) data = await inflateRaw(data);
    out.push({ name: e.name, data });
  }
  return out;
}

function bytesToDataUrl(data: Uint8Array, mime: string): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    bin += String.fromCharCode(...(data.subarray(i, i + chunk) as unknown as number[]));
  }
  return `data:${mime};base64,` + btoa(bin);
}

// ---------- Lux 材质解析 ----------
interface LuxShader { type: string; fields: Record<string, string>; }

function parseShaderBlocks(txt: string): Map<number, LuxShader> {
  const m = new Map<number, LuxShader>();
  const re = /#define shader (\d+) (\w+) \{([\s\S]*?)\n\}/g;
  let x: RegExpExecArray | null;
  while ((x = re.exec(txt))) {
    const fields: Record<string, string> = {};
    const fr = /"([A-Za-z_]+)"\s*([^\n,]*),/g;
    let fm: RegExpExecArray | null;
    while ((fm = fr.exec(x[3]))) fields[fm[1]] = fm[2].trim();
    m.set(+x[1], { type: x[2], fields });
  }
  return m;
}

// KeyShot 自底向上构建 shader，主材质通常是编号最大的材质型 shader
function primaryMaterial(map: Map<number, LuxShader>): LuxShader | null {
  let best: LuxShader | null = null;
  let bestIdx = -1;
  for (const [idx, s] of map) {
    if (MATERIAL_TYPES.has(s.type) && idx > bestIdx) { best = s; bestIdx = idx; }
  }
  return best;
}

function mrenderType(t: string): MaterialData["type"] {
  if (t === "lux_metal" || t === "metallic_paint") return "metal";
  if (t === "lux_plastic" || t === "lux_plastic_simple") return "plastic";
  if (t === "lux_window_glass" || t === "lux_glass" || t === "lux_glass_simple" || t === "lux_gem") return "glass";
  if (t === "lux_brushed") return "aniso";
  if (t === "lux_paint") return "paint";
  if (t === "lux_leather_tex" || t === "lux_granite" || t === "lux_advanced" || t === "lux_constant") return "standard";
  return "generic";
}

function textureHexToBasename(hex: string): string {
  const h = hex.replace(/^xX/, "");
  const arr: number[] = [];
  for (let i = 0; i + 1 < h.length; i += 2) arr.push(parseInt(h.substr(i, 2), 16));
  const path = new TextDecoder("utf-8").decode(new Uint8Array(arr)).replace(/\0/g, "");
  const base = path.split(/[\\/]/).pop() || "";
  return base.replace(/\.[^.]+$/, "");
}

function texInfo(
  map: Map<number, LuxShader>, refIdx: number,
  imageMap: Record<string, string>, linked: Record<string, TextureAsset>
): TextureSlotData | null {
  const ts = map.get(refIdx);
  if (!ts) return null;
  const hex = ts.fields["texture"] || "";
  if (!hex) return null;
  const base = textureHexToBasename(hex);
  const key = Object.keys(imageMap).find((k) => k.toLowerCase() === base.toLowerCase());
  if (!key) return null;
  const scaleU = ts.fields["scale_u"] ? parseFloat(ts.fields["scale_u"]) : 1;
  const scaleV = ts.fields["scale_v"] ? parseFloat(ts.fields["scale_v"]) : 1;
  const angle = ts.fields["angle"] ? parseFloat(ts.fields["angle"]) : 0;
  const shiftU = ts.fields["shift_u"] ? parseFloat(ts.fields["shift_u"]) : 0;
  const shiftV = ts.fields["shift_v"] ? parseFloat(ts.fields["shift_v"]) : 0;
  const src = imageMap[key];
  if (!linked[base]) linked[base] = { id: "tex_" + base, name: base, src, kind: "image" };
  return { src, offset: [shiftU, shiftV], rotation: angle, repeat: [scaleU || 1, scaleV || 1] };
}

function baseMaterialData(id: string, name: string): MaterialData {
  return {
    id, name, type: "generic", baseColor: [0.8, 0.8, 0.82], metallic: 0, roughness: 0.5,
    transmission: 0, ior: 1.5, clearcoat: 0, clearcoatRoughness: 0.1, emissive: [0, 0, 0],
    emissiveIntensity: 0, anisotropy: 0, anisotropyRotation: 0, sheen: 0, sheenColor: [0, 0, 0],
    sheenRoughness: 0.5, attenuationColor: [1, 1, 1], attenuationDistance: 1, thickness: 0,
    specularIntensity: 1, specularColor: [1, 1, 1], bumpScale: 1, displacementScale: 0, dispersion: 0,
    maps: { color: null, normal: null, roughnessMap: null, metallicMap: null, bumpMap: null, emissiveMap: null, opacityMap: null },
    side: "front", opacity: 1,
  };
}

function parseOneMaterial(
  txt: string, name: string, idx: number,
  imageMap: Record<string, string>, linked: Record<string, TextureAsset>
): MaterialData | null {
  const map = parseShaderBlocks(txt);
  const mm = txt.match(/#define material \S+ \{([\s\S]*?)\n\}/);
  if (!mm) return null;
  const base = primaryMaterial(map);
  if (!base) return null;

  const mtype = mrenderType(base.type);
  const f = base.fields;
  const mat = baseMaterialData("mat_ks_" + idx + "_" + name.replace(/[^a-zA-Z0-9_]/g, "_"), name);
  mat.type = mtype;

  let baseColor: Vec3 = [0.8, 0.8, 0.82];
  let colorTexRef: number | null = null;
  let colorField: string | undefined;
  if (base.type === "metallic_paint") colorField = f["metal"] ?? f["base"];
  else colorField = f["color"] ?? f["diffuse"] ?? f["base"] ?? f["transmission"];
  if (colorField) {
    const cf = colorField.trim();
    if (cf.startsWith("!")) colorTexRef = parseInt(cf.replace("!", "").trim(), 10);
    else {
      const c = cf.split(/\s+/).map(Number);
      if (c.length >= 3 && (c[0] || c[1] || c[2])) baseColor = [c[0], c[1], c[2]];
    }
  }
  mat.baseColor = baseColor;
  if (f["roughness"] !== undefined) mat.roughness = parseFloat(f["roughness"]) || 0;
  if (f["ior"] !== undefined) mat.ior = parseFloat(f["ior"]) || 1.5;
  if (mtype === "metal") mat.metallic = 1;
  if (mtype === "glass") {
    mat.transmission = 1;
    if (f["transmission"]) { const c = f["transmission"].split(/\s+/).map(Number); if (c.length >= 3) mat.baseColor = [c[0], c[1], c[2]]; }
    mat.thickness = 0.6;
  }
  if (mtype === "paint") mat.clearcoat = 1;
  if (mtype === "aniso") { mat.metallic = 1; mat.anisotropy = 0.7; }

  if (colorTexRef != null) {
    const ti = texInfo(map, colorTexRef, imageMap, linked);
    if (ti) mat.maps.color = ti;
  }
  for (const [sidx, sh] of map) {
    if (sh.type === "texture_bumpmap_normal") {
      const ti = texInfo(map, sidx, imageMap, linked);
      if (ti && !mat.maps.normal) mat.maps.normal = ti;
    }
  }
  return mat;
}

export interface KeyShotImportResult { materials: MaterialData[]; textures: TextureAsset[]; }

export async function parseKeyshotMaterialLibrary(buffer: ArrayBuffer): Promise<KeyShotImportResult> {
  const entries = await unzip(buffer);
  const imageMap: Record<string, string> = {};
  for (const e of entries) {
    const low = e.name.toLowerCase();
    if (low.endsWith(".png") || low.endsWith(".jpg") || low.endsWith(".jpeg") || low.endsWith(".tif") || low.endsWith(".tiff")) {
      const base = e.name.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
      const mime = low.endsWith(".png") ? "image/png" : low.endsWith(".tif") ? "image/tiff" : "image/jpeg";
      imageMap[base] = bytesToDataUrl(e.data, mime);
    }
  }
  const materials: MaterialData[] = [];
  const linked: Record<string, TextureAsset> = {};
  let i = 0;
  for (const e of entries) {
    if (!e.name.toLowerCase().endsWith(".mtl")) continue;
    const name = e.name.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
    try {
      const mat = parseOneMaterial(new TextDecoder("utf-8").decode(e.data), name, i++, imageMap, linked);
      if (mat) materials.push(mat);
    } catch { /* 单个材质解析失败不影响其余 */ }
  }
  return { materials, textures: Object.values(linked) };
}

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}
