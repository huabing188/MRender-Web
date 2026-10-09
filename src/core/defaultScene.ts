// 默认场景：内置示例 + 空场景 + 材质库 + 程序化纹理
import * as THREE from "three";
import type { SceneJSON, MaterialData, SceneObjectData, MaterialType } from "./types";
import { ISO_ENV_PRESETS } from "./isoEnvironments";

/** 创建材质的辅助函数，填充所有字段 */
function makeMat(p: Partial<MaterialData> & { id: string; name: string }): MaterialData {
  return {
    type: "standard",
    baseColor: [0.7, 0.7, 0.7],
    metallic: 0, roughness: 0.5,
    transmission: 0, ior: 1.5,
    clearcoat: 0, clearcoatRoughness: 0.03,
    emissive: [0, 0, 0], emissiveIntensity: 0,
    anisotropy: 0, anisotropyRotation: 0,
    sheen: 0, sheenColor: [1, 1, 1], sheenRoughness: 0.3,
    attenuationColor: [1, 1, 1], attenuationDistance: 1,
    thickness: 0,
    specularIntensity: 1, specularColor: [1, 1, 1],
    bumpScale: 1, displacementScale: 0, dispersion: 0,
    maps: { color: null, normal: null, roughnessMap: null, metallicMap: null, bumpMap: null, emissiveMap: null, opacityMap: null },
    side: "front", opacity: 1,
    ...p,
  };
}

/** 内置材质库（KeyShot 风格常用材质） */
export const BUILTIN_MATERIALS: Record<string, MaterialData> = {
  "mat_glass": makeMat({ id: "mat_glass", name: "玻璃 Glass", type: "glass", baseColor: [1, 1, 1], roughness: 0.0, transmission: 1.0, ior: 1.52, clearcoat: 0.2, thickness: 12, dispersion: 0.06, attenuationColor: [0.9, 0.97, 1.0], attenuationDistance: 45, side: "double" }),
  "mat_glass_clear": makeMat({ id: "mat_glass_clear", name: "高透亮玻璃 Clear", type: "glass", baseColor: [1, 1, 1], roughness: 0.0, transmission: 1.0, ior: 1.52, clearcoat: 0.3, clearcoatRoughness: 0.01, thickness: 8, dispersion: 0.05, attenuationColor: [0.98, 0.99, 1.0], attenuationDistance: 120, side: "double" }),
  "mat_glass_frosted": makeMat({ id: "mat_glass_frosted", name: "磨砂玻璃 Frosted", type: "glass", baseColor: [0.94, 0.96, 0.97], roughness: 0.35, transmission: 0.88, ior: 1.5, clearcoat: 0.05, clearcoatRoughness: 0.2, thickness: 3, attenuationColor: [0.96, 0.98, 0.99], attenuationDistance: 8, side: "double" }),
  "mat_glass_acrylic": makeMat({ id: "mat_glass_acrylic", name: "亚克力 Acrylic", type: "glass", baseColor: [0.99, 0.99, 1.0], roughness: 0.02, transmission: 1.0, ior: 1.49, clearcoat: 0.1, clearcoatRoughness: 0.03, thickness: 1.5, dispersion: 0, attenuationColor: [1, 1, 1], attenuationDistance: 200, side: "double" }),
  // 液体：three.js 透射无法折射其它透射体，故液体必须为不透明实体，由外层玻璃折射其固体色 → 呈现“瓶中液体”观感
  "mat_liquid": makeMat({ id: "mat_liquid", name: "液体 Liquid", type: "liquid", baseColor: [0.7, 0.12, 0.06], roughness: 0.12, transmission: 0, ior: 1.33, clearcoat: 0.6, clearcoatRoughness: 0.04, thickness: 0, side: "double" }),
  "mat_liquid_whiskey": makeMat({ id: "mat_liquid_whiskey", name: "威士忌 Whiskey", type: "liquid", baseColor: [0.74, 0.4, 0.1], roughness: 0.1, transmission: 0, ior: 1.37, clearcoat: 0.6, clearcoatRoughness: 0.04, thickness: 0, side: "double" }),
  "mat_liquid_blue": makeMat({ id: "mat_liquid_blue", name: "蓝色液体 Blue", type: "liquid", baseColor: [0.05, 0.18, 0.55], roughness: 0.1, transmission: 0, ior: 1.33, clearcoat: 0.7, clearcoatRoughness: 0.03, thickness: 0, side: "double" }),
  "mat_ceramic_white": makeMat({ id: "mat_ceramic_white", name: "白瓷 Ceramic", type: "paint", baseColor: [0.95, 0.94, 0.9], roughness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.02, sheen: 0.15, sheenColor: [1, 1, 1], sheenRoughness: 0.3 }),
  "mat_ceramic_gloss": makeMat({ id: "mat_ceramic_gloss", name: "亮釉瓷 Glazed", type: "paint", baseColor: [0.95, 0.95, 0.93], roughness: 0.08, clearcoat: 0.8, clearcoatRoughness: 0.02 }),
  "mat_metal_chrome": makeMat({ id: "mat_metal_chrome", name: "铬金属 Chrome", type: "metal", baseColor: [0.85, 0.87, 0.9], metallic: 1, roughness: 0.05 }),
  "mat_metal_brass": makeMat({ id: "mat_metal_brass", name: "黄铜 Brass", type: "metal", baseColor: [0.78, 0.62, 0.3], metallic: 1, roughness: 0.3 }),
  "mat_metal_brushed": makeMat({ id: "mat_metal_brushed", name: "拉丝铝 Brushed", type: "aniso", baseColor: [0.82, 0.84, 0.86], metallic: 1, roughness: 0.35, anisotropy: 0.8 }),
  "mat_paper_label": makeMat({ id: "mat_paper_label", name: "纸标签 Paper", type: "standard", baseColor: [0.95, 0.93, 0.88], roughness: 0.7 }),
  "mat_wood": makeMat({ id: "mat_wood", name: "木纹 Wood", type: "standard", baseColor: [0.55, 0.38, 0.22], roughness: 0.6, clearcoat: 0.2 }),
  "mat_plastic_black": makeMat({ id: "mat_plastic_black", name: "黑塑料 Plastic", type: "plastic", baseColor: [0.12, 0.12, 0.13], roughness: 0.4, clearcoat: 0.2 }),
  "mat_plastic_white": makeMat({ id: "mat_plastic_white", name: "白塑料 ABS", type: "plastic", baseColor: [0.92, 0.92, 0.9], roughness: 0.35, clearcoat: 0.15 }),
  "mat_leather": makeMat({ id: "mat_leather", name: "皮革 Leather", type: "standard", baseColor: [0.35, 0.18, 0.12], roughness: 0.8 }),
  "mat_fabric_velvet": makeMat({ id: "mat_fabric_velvet", name: "丝绒 Velvet", type: "fabric", baseColor: [0.5, 0.1, 0.15], roughness: 0.9, sheen: 1, sheenColor: [0.8, 0.3, 0.35], sheenRoughness: 0.2 }),
  "mat_gold": makeMat({ id: "mat_gold", name: "金 Gold", type: "metal", baseColor: [1.0, 0.8, 0.3], metallic: 1, roughness: 0.15 }),
  "mat_silver": makeMat({ id: "mat_silver", name: "银 Silver", type: "metal", baseColor: [0.9, 0.92, 0.95], metallic: 1, roughness: 0.12 }),
  "mat_copper": makeMat({ id: "mat_copper", name: "铜 Copper", type: "metal", baseColor: [0.73, 0.45, 0.3], metallic: 1, roughness: 0.25 }),
  "mat_red_lacquer": makeMat({ id: "mat_red_lacquer", name: "红漆 Lacquer", type: "paint", baseColor: [0.7, 0.12, 0.1], roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.02 }),
  "mat_black_lacquer": makeMat({ id: "mat_black_lacquer", name: "黑漆 Black", type: "paint", baseColor: [0.06, 0.06, 0.07], roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.02 }),
  "mat_frosted_metal": makeMat({ id: "mat_frosted_metal", name: "磨砂金属 Matte", type: "metal", baseColor: [0.78, 0.78, 0.8], metallic: 1, roughness: 0.55 }),
  "mat_emissive_warm": makeMat({ id: "mat_emissive_warm", name: "暖光源 Emissive", type: "emissive", baseColor: [0.1, 0.08, 0.05], emissive: [1.0, 0.8, 0.5], emissiveIntensity: 3 }),
  "mat_rubber": makeMat({ id: "mat_rubber", name: "橡胶 Rubber", type: "standard", baseColor: [0.08, 0.08, 0.08], roughness: 0.95 }),
  "mat_marble": makeMat({ id: "mat_marble", name: "大理石 Marble", type: "standard", baseColor: [0.92, 0.9, 0.86], roughness: 0.15, clearcoat: 0.6, clearcoatRoughness: 0.03 }),
  // —— 真实 PBR 纹理材质（开源 three.js 示例纹理，MIT）——
  "mat_wood_real": makeMat({ id: "mat_wood_real", name: "实木 Wood PBR", type: "standard", baseColor: [0.55, 0.38, 0.22], roughness: 0.6, clearcoat: 0.15,
    maps: { color: { src: "/assets/textures/wood_diffuse.jpg", offset: [0, 0], rotation: 0, repeat: [1, 1] }, normal: null, roughnessMap: { src: "/assets/textures/wood_roughness.jpg", offset: [0, 0], rotation: 0, repeat: [1, 1] }, metallicMap: null, bumpMap: null, emissiveMap: null, opacityMap: null } }),
  "mat_brick_real": makeMat({ id: "mat_brick_real", name: "砖墙 Brick PBR", type: "standard", baseColor: [0.62, 0.42, 0.36], roughness: 0.85,
    maps: { color: { src: "/assets/textures/brick_diffuse.jpg", offset: [0, 0], rotation: 0, repeat: [1, 1] }, normal: null, roughnessMap: { src: "/assets/textures/brick_roughness.jpg", offset: [0, 0], rotation: 0, repeat: [1, 1] }, metallicMap: null, bumpMap: null, emissiveMap: null, opacityMap: null } }),
  // —— 增补 KeyShot 风格 ——
  "mat_satin": makeMat({ id: "mat_satin", name: "绸缎 Satin", type: "fabric", baseColor: [0.78, 0.1, 0.18], roughness: 0.55, sheen: 1, sheenColor: [1, 0.7, 0.75], sheenRoughness: 0.25 }),
  "mat_pearl": makeMat({ id: "mat_pearl", name: "珍珠漆 Pearl", type: "paint", baseColor: [0.9, 0.88, 0.92], roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03, sheen: 0.4, sheenColor: [0.8, 0.85, 1], sheenRoughness: 0.3 }),
  "mat_carbon": makeMat({ id: "mat_carbon", name: "碳纤维 Carbon", type: "aniso", baseColor: [0.08, 0.08, 0.09], metallic: 0.4, roughness: 0.35, anisotropy: 1, clearcoat: 0.6, clearcoatRoughness: 0.1 }),
  "mat_chrome_dark": makeMat({ id: "mat_chrome_dark", name: "黑铬 Dark Chrome", type: "metal", baseColor: [0.12, 0.12, 0.13], metallic: 1, roughness: 0.08 }),
  // —— 真实 PBR 材质（ambientCG，CC0，摄影测量/程序生成）——
  "mat_ac_wood": makeMat({ id: "mat_ac_wood", name: "实木 PBR (ambientCG)", type: "standard", baseColor: [1, 1, 1], roughness: 0.6, clearcoat: 0.1,
    maps: { color: { src: "/assets/textures/ambientcg/Wood075/Wood075_2K-JPG_Color.jpg", offset: [0, 0], rotation: 0, repeat: [1, 1] }, normal: { src: "/assets/textures/ambientcg/Wood075/Wood075_2K-JPG_NormalGL.jpg", offset: [0, 0], rotation: 0, repeat: [1, 1] }, roughnessMap: { src: "/assets/textures/ambientcg/Wood075/Wood075_2K-JPG_Roughness.jpg", offset: [0, 0], rotation: 0, repeat: [1, 1] }, metallicMap: null, bumpMap: null, emissiveMap: null, opacityMap: null } }),
  "mat_ac_metal": makeMat({ id: "mat_ac_metal", name: "金属板 PBR (ambientCG)", type: "metal", baseColor: [1, 1, 1], metallic: 1, roughness: 0.5,
    maps: { color: { src: "/assets/textures/ambientcg/MetalPlates010/MetalPlates010_2K-JPG_Color.jpg", offset: [0, 0], rotation: 0, repeat: [1, 1] }, normal: { src: "/assets/textures/ambientcg/MetalPlates010/MetalPlates010_2K-JPG_NormalGL.jpg", offset: [0, 0], rotation: 0, repeat: [1, 1] }, roughnessMap: { src: "/assets/textures/ambientcg/MetalPlates010/MetalPlates010_2K-JPG_Roughness.jpg", offset: [0, 0], rotation: 0, repeat: [1, 1] }, metallicMap: { src: "/assets/textures/ambientcg/MetalPlates010/MetalPlates010_2K-JPG_Metalness.jpg", offset: [0, 0], rotation: 0, repeat: [1, 1] }, bumpMap: null, emissiveMap: null, opacityMap: null } }),
  "mat_ac_fabric": makeMat({ id: "mat_ac_fabric", name: "织物 PBR (ambientCG)", type: "fabric", baseColor: [1, 1, 1], roughness: 0.6, sheen: 0.6, sheenColor: [1, 1, 1], sheenRoughness: 0.4,
    maps: { color: { src: "/assets/textures/ambientcg/Fabric066/Fabric066_1K-JPG_Color.jpg", offset: [0, 0], rotation: 0, repeat: [1, 1] }, normal: { src: "/assets/textures/ambientcg/Fabric066/Fabric066_1K-JPG_NormalGL.jpg", offset: [0, 0], rotation: 0, repeat: [1, 1] }, roughnessMap: { src: "/assets/textures/ambientcg/Fabric066/Fabric066_1K-JPG_Roughness.jpg", offset: [0, 0], rotation: 0, repeat: [1, 1] }, metallicMap: null, bumpMap: null, emissiveMap: null, opacityMap: null } }),
};

/** 材质类型选项 */
export const MATERIAL_TYPES: { value: MaterialType; label: string }[] = [
  { value: "generic", label: "通用 Generic" },
  { value: "standard", label: "标准 Standard" },
  { value: "metal", label: "金属 Metal" },
  { value: "glass", label: "玻璃 Glass" },
  { value: "liquid", label: "液体 Liquid" },
  { value: "plastic", label: "塑料 Plastic" },
  { value: "paint", label: "漆面 Paint" },
  { value: "emissive", label: "自发光 Emissive" },
  { value: "fabric", label: "织物 Fabric" },
  { value: "aniso", label: "拉丝 Anisotropic" },
];

/** 程序生成木纹/皮革噪点纹理 */
export function generateProceduralTexture(kind: "wood" | "leather" | "noise"): string {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  if (kind === "wood") {
    ctx.fillStyle = "#6b4423";
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 120; i++) {
      const y = Math.random() * 512;
      const w = 2 + Math.random() * 4;
      ctx.fillStyle = `rgba(40,20,10,${0.1 + Math.random() * 0.15})`;
      ctx.fillRect(0, y, 512, w);
    }
    for (let i = 0; i < 60; i++) {
      const y = Math.random() * 512;
      ctx.fillStyle = `rgba(255,235,200,${0.05 + Math.random() * 0.08})`;
      ctx.fillRect(0, y, 512, 1);
    }
  } else if (kind === "leather") {
    ctx.fillStyle = "#3d2118";
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1800; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const r = 0.5 + Math.random() * 1.5;
      ctx.fillStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.2})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.15})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas.toDataURL("image/png");
}

/** 用 Three.js 程序化构建一个示例白酒瓶 */
export function buildDemoBottle(): THREE.Group {
  const group = new THREE.Group();
  group.name = "白酒瓶";

  // 真实玻璃：走 three.js transmission 通道，必须 transparent=false（否则与 transmission pass 冲突、发灰无折射）
  // 参数对齐 BUILTIN_MATERIALS.mat_glass_clear：高透亮、低色散、厚体积，接近敦和设计 PDF p15 的玻璃质感
  // 真实中空玻璃瓶：用 LatheGeometry 旋转一个「闭合截面」——
  // 外壁从底向上 → 瓶口外缘 → 瓶口内缘（形成 3mm 厚瓶口圈）→ 内壁向下 → 内底。
  // 旋转后得到水密玻璃壳，侧壁/瓶底都有真实壁厚，瓶口圈肉眼可见厚度，瓶腔可装液体。
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(1, 1, 1),
    roughness: 0.05, transmission: 1.0, ior: 1.52, metalness: 0,
    clearcoat: 0.25, clearcoatRoughness: 0.03,
    transparent: false, opacity: 1, thickness: 12,
    dispersion: 0.06,
    attenuationColor: new THREE.Color(0.72, 0.90, 0.82),
    attenuationDistance: 32,
    side: THREE.DoubleSide,
    envMapIntensity: 1.3,
  });

  const floor = 8; // 瓶底厚度 mm
  // 截面轮廓点 (半径 r, 高度 y)，单位 mm；首尾均在轴线上 → 旋转后水密
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0, 0),        // 外底中心
    new THREE.Vector2(33, 0),       // 外底边缘
    new THREE.Vector2(33, 175),     // 瓶身外壁
    new THREE.Vector2(17, 200),     // 肩→颈 外壁
    new THREE.Vector2(14.5, 205),   // 颈外壁底
    new THREE.Vector2(14.5, 252),   // 颈外壁（到唇下）
    new THREE.Vector2(15.5, 254),   // 唇外缘圆角（卷口开始）
    new THREE.Vector2(15.5, 258),   // 唇顶外缘
    new THREE.Vector2(10.5, 258),   // 唇顶内缘
    new THREE.Vector2(10.5, 254),   // 唇内缘圆角
    new THREE.Vector2(11.5, 252),   // 颈内壁（唇下）
    new THREE.Vector2(11.5, 205),   // 颈内壁
    new THREE.Vector2(14, 200),     // 肩→颈 内壁
    new THREE.Vector2(30, 178),     // 瓶身内壁
    new THREE.Vector2(30, floor),   // 内壁下行到内底
    new THREE.Vector2(0, floor),    // 内底中心
  ];
  const bottleMesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 96), glassMat);
  bottleMesh.name = "玻璃瓶身";
  bottleMesh.userData.skipMaterialOverride = true;
  group.add(bottleMesh);

  // 瓶盖：金色金属，对应 PDF p15 的金属盖高光
  const capMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(1.0, 0.8, 0.3), metalness: 1.0, roughness: 0.15 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 42, 48), capMat);
  cap.position.y = 278; cap.name = "瓶盖"; cap.userData.skipMaterialOverride = true; group.add(cap);
  const capTop = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 4, 48), capMat);
  capTop.position.y = 300; capTop.name = "瓶盖顶"; capTop.userData.skipMaterialOverride = true; group.add(capTop);

  // 液体：深蓝色酒液，填充瓶腔内腔（内半径 30 减 1.5mm 间隙防 z-fighting），液面在瓶身约 70% 高度
  const liquidMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.04, 0.16, 0.5), roughness: 0.06, transmission: 0, ior: 1.34,
    metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.02,
    side: THREE.DoubleSide,
  });
  const fillTop = 132;
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(28.5, 28.5, fillTop - floor, 64), liquidMat);
  liquid.position.y = floor + (fillTop - floor) / 2;
  liquid.name = "液体"; liquid.userData.skipMaterialOverride = true; group.add(liquid);

  return group;
}

/** 默认场景数据（含示例酒瓶） */
export function createDefaultScene(): SceneJSON {
  const materials: Record<string, MaterialData> = { ...BUILTIN_MATERIALS };
  const bottle: SceneObjectData = {
    id: "obj_bottle",
    name: "白酒瓶",
    type: "group",
    source: "builtin:demo_bottle",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    materialId: null,
    visible: true,
  };

  return {
    version: 1,
    name: "未命名项目",
    objects: [bottle],
    materials,
    textures: [],
    environment: {
      // 默认使用 KeyShot Startup HDR，真实产品摄影环境；地面默认隐藏，保持干净渲染软件观感
      preset: "keyshot_startup", hdrKey: null, hdrUrl: null, thumbUrl: null,
      brightness: 1.0, contrast: 1.0, rotation: 0, height: 0, size: 1.0, intensity: 1.0,
      background: { mode: "hdr", color: [0.07, 0.07, 0.08], image: null },
      ground: { enabled: false, shadow: true, color: [0.1, 0.1, 0.11], reflection: false, flatten: false, size: 600 },
    },
    customEnvironments: [],
    lightPins: [],
    lights: [
      { id: "light_key", name: "主光 Key", type: "area", position: [140, 180, 170], intensity: 18, color: [1, 1, 1], size: [80, 55], visible: true },
      { id: "light_fill", name: "辅光 Fill", type: "area", position: [-160, 120, 110], intensity: 8, color: [0.9, 0.95, 1.0], size: [60, 45], visible: true },
      { id: "light_rim", name: "轮廓光 Rim", type: "area", position: [-80, 200, -170], intensity: 12, color: [1, 0.97, 0.92], size: [90, 40], visible: true },
    ],
    camera: { fov: 35, focalLength: 50, aperture: 4, dof: false, exposure: 0, whiteBalance: 6500, iso: 100, shutter: 125, position: [0, 150, 480], target: [0, 130, 0] },
    render: { resolution: [1920, 1080], preserveAlpha: true, samples: 512, bounces: 8, denoise: true, mode: "raster", device: "gpu", autoFallback: true, format: "png" },
  };
}

/** 空场景（新建场景用） */
export function createEmptyScene(): SceneJSON {
  const materials: Record<string, MaterialData> = { ...BUILTIN_MATERIALS };
  return {
    version: 1,
    name: "新建场景",
    objects: [],
    materials,
    textures: [],
    environment: {
      preset: "keyshot_startup", hdrKey: null, hdrUrl: null, thumbUrl: null,
      brightness: 1.0, contrast: 1.0, rotation: 0, height: 0, size: 1.0, intensity: 1.0,
      background: { mode: "hdr", color: [0.07, 0.07, 0.08], image: null },
      ground: { enabled: false, shadow: true, color: [0.1, 0.1, 0.11], reflection: false, flatten: false, size: 600 },
    },
    customEnvironments: [],
    lightPins: [],
    lights: [
      { id: "light_key", name: "主光 Key", type: "area", position: [140, 180, 170], intensity: 20, color: [1, 1, 1], size: [80, 55], visible: true },
      { id: "light_fill", name: "辅光 Fill", type: "area", position: [-160, 120, 110], intensity: 9, color: [0.9, 0.95, 1.0], size: [60, 45], visible: true },
    ],
    camera: { fov: 35, focalLength: 50, aperture: 4, dof: false, exposure: 0, whiteBalance: 6500, iso: 100, shutter: 125, position: [0, 180, 450], target: [0, 120, 0] },
    render: { resolution: [1920, 1080], preserveAlpha: true, samples: 512, bounces: 8, denoise: true, mode: "raster", device: "gpu", autoFallback: true, format: "png" },
  };
}

export const BUILTIN_TEXTURES: { id: string; name: string; kind: "wood" | "leather" | "noise" }[] = [
  { id: "tex_wood", name: "木纹", kind: "wood" },
  { id: "tex_leather", name: "皮革", kind: "leather" },
  { id: "tex_noise", name: "噪点", kind: "noise" },
];

/** 环境预设（程序化渐变 or 真实 HDR） */
export interface EnvPreset {
  id: string;
  name: string;
  bg?: [number, number, number];
  hdrUrl?: string | null;
  hdrKey?: string | null;
  /** 预览缩略图（equirect 色调映射预览，由 scripts/gen_env_thumbs.mjs 生成） */
  thumbUrl?: string | null;
}

export const ENV_PRESETS: EnvPreset[] = [
  { id: "studio_soft", name: "柔光棚 Soft", bg: [0.13, 0.14, 0.16] },
  { id: "studio_bright", name: "亮棚 Bright", bg: [0.16, 0.17, 0.2] },
  { id: "warm_product", name: "暖光产品 Warm", bg: [0.15, 0.12, 0.09] },
  { id: "cool_product", name: "冷光产品 Cool", bg: [0.09, 0.12, 0.15] },
  { id: "dark_studio", name: "暗调棚 Dark", bg: [0.07, 0.07, 0.08] },
  { id: "room", name: "室内 Room" },
  { id: "venice", name: "威尼斯黄昏 Venice", hdrUrl: "/assets/hdri/env_venice.hdr", thumbUrl: "/assets/hdri/thumbs/env_venice.png", bg: [0.1, 0.09, 0.08] },
  { id: "quarry", name: "采石场 Quarry", hdrUrl: "/assets/hdri/env_quarry.hdr", thumbUrl: "/assets/hdri/thumbs/env_quarry.png", bg: [0.12, 0.12, 0.12] },
  { id: "overpass", name: "天桥 Overpass", hdrUrl: "/assets/hdri/env_overpass.hdr", thumbUrl: "/assets/hdri/thumbs/env_overpass.png", bg: [0.1, 0.1, 0.11] },
  { id: "keyshot_startup", name: "KeyShot Startup", hdrUrl: "/assets/hdri/keyshot_startup.hdr", thumbUrl: "/assets/hdri/thumbs/keyshot_startup.png", bg: [0.07, 0.07, 0.08] },
  { id: "panels_tilted", name: "三面板光 Panels Tilted", hdrUrl: "/assets/hdri/panels_tilted_2k.hdr", thumbUrl: "/assets/hdri/thumbs/panels_tilted_2k.png", bg: [0.06, 0.07, 0.12] },
  { id: "user_startup", name: "仁怀 Startup", hdrUrl: "/assets/hdri/user_startup.hdr", thumbUrl: "/assets/hdri/thumbs/user_startup.png", bg: [0.08, 0.08, 0.09] },
  // —— Poly Haven 高评价 HDR（CC0，摄影棚/室内，按热度选取）——
  { id: "ph_blocky_photo_studio", name: "PH 摄影棚 Blocky", hdrUrl: "/assets/hdri/ph_blocky_photo_studio.hdr", thumbUrl: "/assets/hdri/thumbs/ph_blocky_photo_studio.png", bg: [0.09, 0.09, 0.1] },
  { id: "ph_blue_photo_studio", name: "PH 蓝棚 Blue Studio", hdrUrl: "/assets/hdri/ph_blue_photo_studio.hdr", thumbUrl: "/assets/hdri/thumbs/ph_blue_photo_studio.png", bg: [0.07, 0.08, 0.12] },
  { id: "ph_brown_photostudio_01", name: "PH 棕棚 Brown Studio", hdrUrl: "/assets/hdri/ph_brown_photostudio_01.hdr", thumbUrl: "/assets/hdri/thumbs/ph_brown_photostudio_01.png", bg: [0.1, 0.08, 0.07] },
  { id: "ph_abandoned_bakery", name: "PH 旧面包房 Bakery", hdrUrl: "/assets/hdri/ph_abandoned_bakery.hdr", thumbUrl: "/assets/hdri/thumbs/ph_abandoned_bakery.png", bg: [0.09, 0.08, 0.07] },
];

/**
 * 商业 HDRI（Dosch Chrome Studio / HDRI Maps）为**可选素材**，不随仓库分发
 * （商业授权，公开分发会侵权）。
 *
 * 启动时探测一次：本地若存在这些素材则自动追加进环境库；不存在则静默跳过，
 * 避免出现点不开的死预设。
 *
 * 想启用：把素材拷回 `public/assets/hdri/dosch/` 与 `public/assets/hdri/hdrimaps/`
 * 即可，无需改代码。
 */
export async function probeIsoEnvironments(): Promise<boolean> {
  if (isoEnvProbed) return isoEnvReady;
  isoEnvProbed = true;
  const probe = ISO_ENV_PRESETS[0];
  if (!probe?.hdrUrl) return false;
  try {
    const res = await fetch(probe.hdrUrl, { method: "HEAD" });
    if (!res.ok) return false;
    ENV_PRESETS.push(...ISO_ENV_PRESETS);
    isoEnvReady = true;
    // 通知 UI 刷新环境库列表
    window.dispatchEvent(new CustomEvent("mrender:env-presets-changed"));
    return true;
  } catch {
    return false; // 素材不存在，静默跳过
  }
}

let isoEnvProbed = false;
let isoEnvReady = false;
