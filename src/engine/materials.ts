// 材质数据 → three.js 材质转换
import * as THREE from "three";
import type { MaterialData, TextureSlotData } from "../core/types";

const textureCache = new Map<string, THREE.Texture>();
const loader = new THREE.TextureLoader();

function loadTexture(slot: TextureSlotData | null, isColor = false): THREE.Texture | null {
  if (!slot || !slot.src) return null;
  const cached = textureCache.get(slot.src);
  if (cached) {
    applyRepeat(cached, slot);
    return cached;
  }
  try {
    const tex = loader.load(slot.src);
    tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    applyRepeat(tex, slot);
    textureCache.set(slot.src, tex);
    return tex;
  } catch {
    return null;
  }
}

function applyRepeat(tex: THREE.Texture, slot: TextureSlotData) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(slot.repeat[0], slot.repeat[1]);
  tex.offset.set(slot.offset[0], slot.offset[1]);
  tex.rotation = slot.rotation;
}

function applyAll(mat: THREE.MeshPhysicalMaterial, d: MaterialData) {
  mat.color.setRGB(d.baseColor[0], d.baseColor[1], d.baseColor[2]);
  mat.metalness = d.metallic;
  mat.roughness = d.roughness;
  mat.transmission = d.transmission;
  mat.ior = d.ior;
  mat.clearcoat = d.clearcoat;
  mat.clearcoatRoughness = d.clearcoatRoughness;
  mat.emissive.setRGB(d.emissive[0], d.emissive[1], d.emissive[2]);
  mat.emissiveIntensity = d.emissiveIntensity;
  mat.anisotropy = d.anisotropy;
  mat.sheen = d.sheen;
  mat.sheenRoughness = d.sheenRoughness;
  mat.attenuationColor.setRGB(d.attenuationColor[0], d.attenuationColor[1], d.attenuationColor[2]);
  mat.attenuationDistance = d.attenuationDistance;
  // 体积厚度：让玻璃/液体呈现真实折射深度（而非薄面近似）
  mat.thickness = d.thickness;
  // 色散：玻璃边缘的棱镜彩虹（需 transmission>0，否则无效，安全）
  mat.dispersion = d.dispersion;
  mat.specularIntensity = d.specularIntensity;
  mat.specularColor.setRGB(d.specularColor[0], d.specularColor[1], d.specularColor[2]);
  mat.bumpScale = d.bumpScale;
  mat.displacementScale = d.displacementScale;
  // transmission 与 opacity/transparent 不能混用：
  // 透射材质必须走 three.js 的 transmission 通道（opaque 渲染队列），若设 transparent=true
  // 会被丢进 alpha 混合队列，与 transmission pass 冲突 → 玻璃发灰、失去折射。
  // 所以透射材质强制 transparent=false、opacity=1；只有真正的半透明（opacity<1 或 opacityMap）才透明。
  const isTransmissive = d.transmission > 0.01;
  mat.opacity = isTransmissive ? 1 : d.opacity;
  mat.transparent = !isTransmissive && (d.opacity < 1 || (d.maps.opacityMap != null));
  // 提高 envMapIntensity，让非金属材质（瓷/漆/塑料）的反射和环境高光更明显；
  // 玻璃/液体用更高值以强化折射高光与环境映射，避免“发灰发闷”
  mat.envMapIntensity = isTransmissive ? 2.2 : 1.5;
  // 玻璃/液体需要双面渲染才能形成真实体积折射；其它材质尊重 side 字段
  mat.side = (isTransmissive || d.side === "double") ? THREE.DoubleSide : THREE.FrontSide;
  // 纹理
  mat.map = loadTexture(d.maps.color, true) ?? null;
  mat.normalMap = loadTexture(d.maps.normal) ?? null;
  mat.roughnessMap = loadTexture(d.maps.roughnessMap) ?? null;
  mat.metalnessMap = loadTexture(d.maps.metallicMap) ?? null;
  mat.bumpMap = loadTexture(d.maps.bumpMap) ?? null;
  mat.emissiveMap = loadTexture(d.maps.emissiveMap) ?? null;
  mat.alphaMap = loadTexture(d.maps.opacityMap) ?? null;
  if (mat.roughnessMap) mat.roughness = 1;
  if (mat.metalnessMap) mat.metalness = 1;
  mat.needsUpdate = true;
}

/** MaterialData → THREE.MeshPhysicalMaterial */
export function dataToThreeMaterial(data: MaterialData): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial();
  applyAll(mat, data);
  return mat;
}

/** 材质缓存管理 */
export class MaterialFactory {
  private cache = new Map<string, THREE.MeshPhysicalMaterial>();

  get(data: MaterialData): THREE.MeshPhysicalMaterial {
    let mat = this.cache.get(data.id);
    if (!mat) {
      mat = dataToThreeMaterial(data);
      this.cache.set(data.id, mat);
    }
    applyAll(mat, data);
    return mat;
  }
}
