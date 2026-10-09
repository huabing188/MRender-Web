// MRender-Web 场景数据模型 —— 全项目唯一数据源
// UI 参数面板、渲染引擎、AI 动作总线都操作这一份 JSON 结构

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export interface TransformData {
  position: Vec3;
  rotation: Vec3; // Euler 角度
  scale: Vec3;
}

export interface TextureSlotData {
  src: string | null;
  offset: Vec2;
  rotation: number;
  repeat: Vec2;
}

/** 材质类型（KeyShot 风格分类） */
export type MaterialType =
  | "standard"    // 标准 PBR
  | "metal"       // 金属
  | "glass"       // 玻璃
  | "liquid"      // 液体
  | "plastic"     // 塑料
  | "paint"       // 漆面（clearcoat 重）
  | "emissive"    // 自发光
  | "fabric"      // 织物（sheen）
  | "aniso"       // 拉丝金属（anisotropy）
  | "generic";    // 通用

export interface MaterialData {
  id: string;
  name: string;
  type: MaterialType;
  baseColor: Vec3;
  metallic: number;
  roughness: number;
  transmission: number;
  ior: number;
  clearcoat: number;
  clearcoatRoughness: number;
  emissive: Vec3;
  emissiveIntensity: number;
  // 高级 PBR
  anisotropy: number;        // 各向异性（拉丝金属/毛发）
  anisotropyRotation: number;
  sheen: number;             // 织物光泽
  sheenColor: Vec3;
  sheenRoughness: number;
  attenuationColor: Vec3;    // 玻璃/液体光吸收色
  attenuationDistance: number; // 吸收距离
  thickness: number;         // 体积厚度（玻璃/液体真实折射，0=薄面近似）
  specularIntensity: number; // 镜面反射强度
  specularColor: Vec3;
  bumpScale: number;         // 凹凸/法线强度
  displacementScale: number; // 位移强度
  dispersion: number;        // 色散（棱镜彩虹效果）
  // 纹理槽
  maps: {
    color: TextureSlotData | null;
    normal: TextureSlotData | null;
    roughnessMap: TextureSlotData | null;
    metallicMap: TextureSlotData | null;
    bumpMap: TextureSlotData | null;
    emissiveMap: TextureSlotData | null;
    opacityMap: TextureSlotData | null;
  };
  side: "front" | "double";
  opacity: number;
}

/** 标签数据（KeyShot Label：贴在物件表面的贴图/材质） */
export interface LabelData {
  id: string;
  name: string;
  /** 贴图 dataURL */
  src: string;
  /** UV 位置（0~1，物件表面坐标） */
  position: Vec2;
  /** 缩放 */
  scale: Vec2;
  /** 旋转（弧度） */
  rotation: number;
  /** 不透明度 */
  opacity: number;
  /** 是否双面 */
  doubleSide: boolean;
  /** 可选材质 ID（赋材质模式；null=纯贴图模式） */
  materialId: string | null;
}

export interface SceneObjectData {
  id: string;
  name: string;
  type: "mesh" | "group" | "light" | "camera";
  source: string | null;
  /** 打散后标识：只取模型中指定名称的 mesh */
  partName?: string | null;
  children?: SceneObjectData[];
  transform: TransformData;
  materialId: string | null;
  visible: boolean;
  /** 标签列表 */
  labels?: LabelData[];
  stats?: { triangles: number; vertices: number };
  /** 打散后的子部件：几何体已烘焙世界坐标，构建时不要再自动居中（否则会错位） */
  preTransformed?: boolean;
  /** 原始文件格式（如 obj/3dm/glb），异步 hydrate 时需要据此选择 Loader */
  sourceFormat?: string;
}

export interface CustomEnvironmentData {
  id: string;
  name: string;
  /** HDR 文件 data URL */
  src: string;
  /** 缩略图 data URL（可选，未生成时为 null） */
  thumbnail: string | null;
}

/** 纹理资产（导入的图片纹理，注册进左侧纹理库） */
export interface TextureAsset {
  id: string;
  name: string;
  /** 图片 data URL */
  src: string;
  kind: "image" | "procedural";
}

export interface EnvironmentData {
  preset: string;
  /** 用户导入的 HDR（data URL） */
  hdrKey: string | null;
  /** 内置库 HDR 资源路径（如 /assets/hdri/env_venice.hdr），优先于 hdrKey */
  hdrUrl: string | null;
  /** 预览缩略图（equirect 色调映射预览，由 scripts/gen_env_thumbs.mjs 生成） */
  thumbUrl?: string | null;
  /** 亮度（KeyShot Brightness）：0–3，作用于环境贴图强度 */
  brightness: number;
  /** 对比度（KeyShot Contrast）：0.2–3，作用于环境贴图明暗分离 */
  contrast: number;
  /** 旋转（KeyShot Rotation）：水平方位角 0–360° */
  rotation: number;
  /** 高度（KeyShot Height）：环境相对地平面的垂直位置（倾斜地平线） -45–45° */
  height: number;
  /** 尺寸（KeyShot Size）：环境整体大小/反射缩放 0.3–3 */
  size: number;
  /** 兼容旧字段：环境强度（=brightness 的别名，UI 以 brightness 为准） */
  intensity: number;
  background: { mode: "hdr" | "color" | "transparent" | "image"; color: Vec3; image?: string | null };
  ground: { enabled: boolean; shadow: boolean; color: Vec3; reflection: boolean; flatten: boolean; size: number };
}

/** KeyShot 式灯光针（放在环境球上的可调光源） */
export interface LightPinData {
  id: string;
  name: string;
  shape: "circular" | "rectangular" | "image";
  /** 方位角 azimuth（水平）0–360° */
  azimuth: number;
  /** 高度角 elevation（垂直）-90–90° */
  elevation: number;
  /** 亮度 0–50 */
  brightness: number;
  /** 颜色 */
  color: Vec3;
  /** 尺寸（直径/边长，米） 0.1–10 */
  size: number;
  /** 边缘柔化 0–1 */
  falloff: number;
  /** 半切（只照上/下半） */
  half: boolean;
  /** 图像针的图片（data URL），shape==='image' 时用 */
  image?: string | null;
}

export type LightType = "area" | "point" | "spot" | "sun";

export interface LightData {
  id: string;
  name: string;
  type: LightType;
  position: Vec3;
  target?: Vec3;
  intensity: number;
  color: Vec3;
  size?: Vec2;
  angle?: number;
  penumbra?: number;
  distance?: number;
  visible: boolean;
}

export interface CameraData {
  fov: number;
  focalLength: number;
  aperture: number;
  dof: boolean;
  exposure: number;
  whiteBalance: number;
  iso: number;
  shutter: number;
  position: Vec3;
  target: Vec3;
}

export interface RenderSettings {
  resolution: Vec2;
  preserveAlpha: boolean;
  samples: number;
  /** 路径追踪光线反弹次数（玻璃/液体要调高，否则发黑） */
  bounces: number;
  denoise: boolean;
  mode: "raster" | "pathtrace";
  /** 渲染设备模式：cpu=兼容/低负载档（默认），gpu=高性能档 */
  device: "cpu" | "gpu";
  /** GPU 过载时是否自动回退到 CPU 模式 */
  autoFallback: boolean;
  /** 输出格式：png 支持透明，jpeg 更小 */
  format?: "png" | "jpeg";
}

export interface SceneJSON {
  version: 1;
  name: string;
  objects: SceneObjectData[];
  materials: Record<string, MaterialData>;
  /** 用户导入的纹理库（图片纹理，可手动指派到材质槽） */
  textures: TextureAsset[];
  environment: EnvironmentData;
  /** 用户导入的 HDR 环境库 */
  customEnvironments: CustomEnvironmentData[];
  /** KeyShot 式灯光针（环境上的可调光源） */
  lightPins: LightPinData[];
  lights: LightData[];
  camera: CameraData;
  render: RenderSettings;
}
