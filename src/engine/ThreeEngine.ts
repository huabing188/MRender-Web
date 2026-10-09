// MRender-Web 核心渲染引擎（Three.js 封装）
// 职责：场景/相机/渲染器管理、环境、灯光、对象同步、Gizmo、出图、点击选中
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { WebGLPathTracer } from "three-gpu-pathtracer";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { SceneJSON, LightData, MaterialData, LabelData, SceneObjectData, LightPinData } from "../core/types";
import { buildDemoBottle, ENV_PRESETS } from "../core/defaultScene";
import { MaterialFactory } from "./materials";
import { importModelFile, bakeGeometryToDataURL, decodeGeometryDataURL, isBakedGeometryDataURL } from "./importers";
import { useSceneStore, nextUid } from "../store/sceneStore";
import { getEngine } from "../ui/engineBridge";

/** 导入模型默认材质：白塑料 ABS */
const DEFAULT_IMPORTED_MATERIAL = "mat_plastic_white";

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

/** 模块级射线（右键拾取复用，避免每次 new） */
const _raycaster = new THREE.Raycaster();

/** 递归收集对象下所有 Mesh（排除标签/灯光辅助体），用于「打散」 */
function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.isMesh && !n.userData.isLabel && !n.userData.isLightHelper && !n.userData.isSelectionOutline) out.push(m);
  });
  return out;
}

/** 程序化 Studio IBL 预设参数（产品渲染柔光箱，KeyShot 摄影棚观感） */
type StudioParams = {
  top: string; bottom: string;
  key: [number, number, number]; keyI: number;
  fill: [number, number, number]; fillI: number;
  rim: [number, number, number]; rimI: number;
};
const STUDIO_SOFT: StudioParams = { top: "#3a3f47", bottom: "#16181c", key: [1, 1, 1], keyI: 6, fill: [0.8, 0.86, 1], fillI: 2.5, rim: [1, 0.95, 0.85], rimI: 3.5 };
const STUDIO_BRIGHT: StudioParams = { top: "#4a505a", bottom: "#202329", key: [1, 1, 1], keyI: 9, fill: [0.85, 0.9, 1], fillI: 3.5, rim: [1, 0.98, 0.92], rimI: 4 };
const WARM_PRODUCT: StudioParams = { top: "#3e382f", bottom: "#17120c", key: [1, 0.88, 0.7], keyI: 6.5, fill: [0.7, 0.8, 1], fillI: 2.4, rim: [1, 0.92, 0.8], rimI: 3.2 };
const COOL_PRODUCT: StudioParams = { top: "#2f3a40", bottom: "#0c1317", key: [0.8, 0.9, 1], keyI: 6.5, fill: [1, 0.86, 0.7], fillI: 2.4, rim: [0.85, 0.95, 1], rimI: 3.2 };
const DARK_STUDIO: StudioParams = { top: "#1c1d20", bottom: "#070708", key: [0.9, 0.95, 1], keyI: 4, fill: [0.4, 0.5, 0.7], fillI: 1.2, rim: [1, 0.9, 0.8], rimI: 6 };



export interface EngineCallbacks {
  onSelect?: (objectId: string | null) => void;
  onStatus?: (msg: string) => void;
}

export class ThreeEngine {
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  controls!: OrbitControls;
  gizmo!: TransformControls;
  private grid!: THREE.GridHelper;
  private axes!: THREE.AxesHelper;
  private container!: HTMLElement;
  private raf = 0;
  private clock = new THREE.Clock();

  private objectMap = new Map<string, THREE.Object3D>();
  private modelCache = new Map<string, THREE.Object3D>();
  private lightMap = new Map<string, THREE.Light>();
  private lightTargetMap = new Map<string, THREE.Object3D>();
  private lightHelperMap = new Map<string, THREE.Object3D>();
  private materials = new MaterialFactory();
  private pmrem!: THREE.PMREMGenerator;
  private groundMesh!: THREE.Mesh;
  /** 实体地面（cyclorama 影棚曲面）：接收接触阴影，提供反射地面 */
  private floorMesh!: THREE.Mesh;
  /** 透明接影地面（shadow catcher）：默认开启，只显示阴影、本身不可见，让物体在“无地面”模式下仍落地 */
  private shadowCatcher!: THREE.Mesh;
  /** cyclorama 顶点色：底部=地面色，顶部=HDR 地平线色（采样 equirect 赤道带），确保墙面与任意 HDR 背景无缝 */
  private cycFloorColor = new THREE.Color(0.06, 0.07, 0.09);
  private cycHorizon = new THREE.Color(0.5, 0.52, 0.55);
  private cycMaxY = 1000;
  /** 常驻柔化阴影灯（DirectionalLight），确保任何灯光组合下都有接触阴影，把物体“落到地面” */
  private shadowLight!: THREE.DirectionalLight;
  /** KeyShot 式环境驱动阴影：HDR 主光方向（世界坐标，从场景中心指向光源）。无影棚灯时阴影灯跟随它 */
  private envDominantDir = new THREE.Vector3(0.3, 0.85, 0.45).normalize();
  /** HDR 平均亮度（用于阴影强度自适应，留给后续扩展） */
  private envAvgLum = 1;
  /** 半球环境光，填充接触阴影并统一地面/背景亮度，减少“硬边地平线” */
  private hemiLight!: THREE.HemisphereLight;
  /** 影棚渐变背景（equirect CanvasTexture，光栅与路径追踪通用，避免纯色“视口感”） */
  private studioBgTex!: THREE.CanvasTexture;
  private studioBgTop = new THREE.Color(0.2, 0.21, 0.24);
  private studioBgBottom = new THREE.Color(0.04, 0.05, 0.07);

  // Raycaster for click-to-select
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  // 后处理外轮廓高亮（OutlinePass：只描物件外部最大轮廓，不显示内部细节）
  private composer!: EffectComposer;
  private outlinePass!: OutlinePass;
  private lastSelectedId: string | null = null;

  private fpsAccum = 0;
  private fpsFrames = 0;
  private fpsValue = 60;

  private envKey = "";
  /** 原始 equirect HDR 纹理（未 PMREM），用于 Contrast 实时重处理 */
  private hdrEquirectRaw: THREE.Texture | null = null;
  /** 当前已应用的对比度值（避免每次 sync 都重处理） */
  private envContrast = 1;
  /** 路径追踪出图进行中：暂停主循环渲染，避免覆盖路径追踪画布 */
  private renderingPath = false;
  /** 路径追踪时临时隐藏的辅助对象（截图后由 restoreRasterPreview 恢复） */
  private pathTraceHidden: THREE.Object3D[] = [];
  /** KeyShot 式灯光针 → RectAreaLight 映射 */
  private lightPinMap = new Map<string, THREE.RectAreaLight>();
  private lastLightPins: SceneJSON["lightPins"] | null = null;
  private disposed = false;
  private cb: EngineCallbacks = {};

  // ============ 渲染设备模式（CPU 兼容 / GPU 高性能）============
  private deviceMode: "cpu" | "gpu" = "cpu";
  private lastDevice: "cpu" | "gpu" | null = null;
  /** 当前 WebGL 后端是否为软件渲染（无 GPU 加速） */
  private gpuSoftware = false;
  /** GPU 过载自动回退：监测窗口是否已武装（切到 GPU 时武装，触发后解除，避免反复跳变） */
  private autoFallbackArmed = false;
  private lowFpsSamples = 0;

  /** 用于出图时临时改分辨率再恢复 */
  private baseWidth = 0;
  private baseHeight = 0;

  constructor(cb: EngineCallbacks = {}) {
    this.cb = cb;
  }

  attach(container: HTMLElement) {
    this.container = container;
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    this.baseWidth = w;
    this.baseHeight = h;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    // r185 起 PCFSoftShadowMap 已废弃，用 PCFShadowMap + light.shadow.radius 实现软阴影
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // 性能优化：阴影只在场景变化时重算一次，而非每帧重绘（大幅降低 GPU 负担）
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x141518);

    // MRender 内部单位为 mm：相机默认俯瞰一个约 250mm 高的产品
    this.camera = new THREE.PerspectiveCamera(35, w / h, 1, 5000);
    this.camera.position.set(0, 180, 450);
    this.camera.lookAt(0, 120, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 120, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.95;
    this.controls.addEventListener("end", () => this.syncCameraBack());

    // Gizmo（TransformControls）
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    let transformDirty = false;
    this.gizmo.addEventListener("dragging-changed", (e: { value: unknown }) => {
      this.controls.enabled = !e.value;
      const id = this.gizmo.object?.userData.mrenderId as string | undefined;
      if (e.value) {
        transformDirty = false;
      } else {
        // 拖拽结束：仅当真正移动过才提交一次历史 + 同步
        if (transformDirty && id) useSceneStore.getState().commitTransform();
        transformDirty = false;
      }
    });
    this.gizmo.addEventListener("change", () => {
      const id = this.gizmo.object?.userData.mrenderId as string | undefined;
      if (!id) return;
      // 第一次实际位移才压入历史快照（避免单纯点击就产生空历史）
      if (this.controls.enabled === false && !transformDirty) {
        useSceneStore.getState().beginTransform();
        transformDirty = true;
      }
      this.syncObjectBack(id);
    });
    this.scene.add(this.gizmo.getHelper());

    // 网格以 mm 为单位：500mm × 500mm，每格 10mm（默认隐藏，渲染软件而非建模软件观感）
    this.grid = new THREE.GridHelper(500, 50, 0x333844, 0x22242b);
    this.grid.position.y = 0;
    this.grid.visible = false;
    this.scene.add(this.grid);
    this.axes = new THREE.AxesHelper(25);
    this.axes.position.set(-130, 0, -130);
    this.axes.visible = false;
    this.scene.add(this.axes);

    // 实体影棚地面：曲面 cyclorama 扫掠（平面落影区 → 平滑升起为背板）。
    // 顶点色从地面色过渡到 HDR 地平线色，彻底消除平面圆盘的硬地平线。
    this.floorMesh = new THREE.Mesh(
      this.makeCycloramaGeometry(),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(1, 1, 1), // 白色底，颜色完全由顶点色决定
        vertexColors: true,
        roughness: 0.55, metalness: 0.0,
        envMapIntensity: 0.6,
        side: THREE.DoubleSide,
      })
    );
    this.floorMesh.receiveShadow = true;
    this.floorMesh.name = "__ground__";
    this.scene.add(this.floorMesh);
    this.groundMesh = this.floorMesh;
    this.applyCycloramaColors(); // 用默认地面色 + 当前地平线色初始化顶点色

    // 透明接影地面：与实体地面互斥。关闭实体地面时默认显示，只接收阴影、不可见，避免物体“悬空”。
    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.5 })
    );
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.position.y = 0;
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.castShadow = false;
    this.shadowCatcher.name = "__shadowcatcher__";
    this.shadowCatcher.userData.isEngineHelper = true;
    this.scene.add(this.shadowCatcher);

    // 常驻柔化阴影灯：确保即便只用 Area 灯（RectAreaLight 不投影）也有接触阴影
    this.shadowLight = new THREE.DirectionalLight(0xffffff, 2.0);
    this.shadowLight.position.set(220, 480, 320);
    this.shadowLight.target.position.set(0, 120, 0);
    this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.set(2048, 2048);
    this.shadowLight.shadow.camera.near = 25;
    this.shadowLight.shadow.camera.far = 2500;
    this.shadowLight.shadow.camera.left = -600;
    this.shadowLight.shadow.camera.right = 600;
    this.shadowLight.shadow.camera.top = 600;
    this.shadowLight.shadow.camera.bottom = -600;
    this.shadowLight.shadow.bias = -0.0002;
    this.shadowLight.shadow.radius = 8; // 软阴影（PCFSoft + radius 模糊）
    this.scene.add(this.shadowLight);
    this.scene.add(this.shadowLight.target);

    // 半球环境光：把阴影从全黑提升到中灰，同时照亮地面使其颜色接近背景地平线
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.35);
    this.hemiLight.position.set(0, 600, 0);
    this.scene.add(this.hemiLight);

    // 影棚渐变背景（equirect，光栅与路径追踪通用）
    this.studioBgTex = this.makeStudioBackdropTexture(this.studioBgTop, this.studioBgBottom);
    this.scene.background = this.studioBgTex;

    RectAreaLightUniformsLib.init();
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    // 后处理：外轮廓高亮 Pass
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.outlinePass = new OutlinePass(new THREE.Vector2(w, h), this.scene, this.camera);
    this.outlinePass.edgeStrength = 3.0;
    this.outlinePass.edgeGlow = 0.0;
    this.outlinePass.edgeThickness = 2.0;
    this.outlinePass.visibleEdgeColor.set(0x2bd6ff);
    this.outlinePass.hiddenEdgeColor.set(0x2bd6ff);
    this.outlinePass.pulsePeriod = 0;
    this.composer.addPass(this.outlinePass);
    this.composer.addPass(new OutputPass());

    // 点击选中：canvas 上监听 pointerdown
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);

    // 初始环境
    const env = useSceneStore.getState().scene.environment;
    this.applyEnvironment(env);

    // 初始示例场景
    const scene = useSceneStore.getState().scene;
    this.syncScene(scene);

    // 相机初始同步
    this.applyCamera(scene.camera);

    // 检测 GPU 后端并应用初始渲染设备模式（默认 CPU 兼容模式）
    this.detectBackend();
    this.deviceMode = useSceneStore.getState().scene.render.device;
    this.lastDevice = this.deviceMode;
    this.applyDeviceMode(this.deviceMode);

    // 选中变化 → 刷新高亮外轮廓（独立于 Gizmo，任何选中方式都会触发）
    this.lastSelectedId = useSceneStore.getState().selectedObjectId;
    useSceneStore.subscribe((state) => {
      if (state.selectedObjectId !== this.lastSelectedId) {
        this.lastSelectedId = state.selectedObjectId;
        this.updateSelectionOutline(state.selectedObjectId);
      }
    });

    this.loop();
  }

  // ============ 点击选中（Raycaster） ============
  /** 向上遍历找到带 mrenderId 的父级对象 */
  private resolveMrenderId(hit: THREE.Object3D): string | null {
    let obj: THREE.Object3D | null = hit;
    while (obj && !obj.userData.mrenderId) {
      // 跳过引擎辅助体
      if (obj.userData.isSelectionOutline || obj.userData.isLabel || obj.userData.isLightHelper) return null;
      obj = obj.parent;
    }
    return (obj?.userData.mrenderId as string) || null;
  }

  private onPointerDown = (e: PointerEvent) => {
    // 只处理左键
    if (e.button !== 0) return;
    // 如果 Gizmo 正在拖拽，不干预
    if (this.gizmo.dragging) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    // 仅对可见对象做射线检测（过滤隐藏物体，避免遮挡内部对象）
    const visibleRoots = Array.from(this.objectMap.values()).filter((o) => o.visible);
    const intersects = this.raycaster.intersectObjects(visibleRoots, true);

    // 收集所有命中对象 ID（去重）
    const hitIds: string[] = [];
    for (const hit of intersects) {
      const id = this.resolveMrenderId(hit.object);
      if (id && !hitIds.includes(id)) hitIds.push(id);
    }

    if (hitIds.length > 0) {
      const currentId = useSceneStore.getState().selectedObjectId;
      // Alt/Option + 点击：循环选择被遮挡的下一个对象（KeyShot 风格）
      if (e.altKey && hitIds.length > 1 && currentId && hitIds.includes(currentId)) {
        const idx = hitIds.indexOf(currentId);
        const nextId = hitIds[(idx + 1) % hitIds.length];
        this.cb.onSelect?.(nextId);
        return;
      }
      this.cb.onSelect?.(hitIds[0]);
      return;
    }
    // 点击空白 → 取消选中
    this.cb.onSelect?.(null);
  };

  // ============ 数据同步（store → three） ============
  // 引用缓存：store 只在对应切片变化时生成新对象引用，故相同引用可跳过昂贵同步（如 PMREM 环境重建）
  private lastMaterials: SceneJSON["materials"] | null = null;
  private lastObjects: SceneJSON["objects"] | null = null;
  private lastLights: SceneJSON["lights"] | null = null;
  private lastEnv: SceneJSON["environment"] | null = null;
  private lastCamera: SceneJSON["camera"] | null = null;
  private lastBg: SceneJSON | null = null;

  syncScene(scene: SceneJSON) {
    if (scene.materials !== this.lastMaterials) {
      this.syncMaterials(Object.values(scene.materials));
      this.lastMaterials = scene.materials;
    }
    if (scene.objects !== this.lastObjects) {
      this.syncObjects(scene.objects);
      this.lastObjects = scene.objects;
    }
    if (scene.lights !== this.lastLights) {
      this.syncLights(scene.lights);
      this.lastLights = scene.lights;
    }
    if (scene.lightPins !== this.lastLightPins) {
      this.syncLightPins(scene.lightPins);
      this.lastLightPins = scene.lightPins;
    }
    if (scene.environment !== this.lastEnv) {
      this.applyEnvironment(scene.environment);
      this.applyGround(scene.environment.ground);
      this.lastEnv = scene.environment;
    }
    if (scene.camera !== this.lastCamera) {
      this.applyCamera(scene.camera);
      this.renderer.toneMappingExposure = Math.pow(2, scene.camera.exposure);
      this.applyWhiteBalance(scene.camera.whiteBalance);
      this.lastCamera = scene.camera;
    }
    // 渲染设备模式（CPU/GPU）变更：实时切换画质档位
    if (scene.render.device !== this.lastDevice) {
      this.applyDeviceMode(scene.render.device);
      this.lastDevice = scene.render.device;
    }
    if (scene !== this.lastBg) {
      this.applyBackground(scene);
      this.lastBg = scene;
    }
    // 场景变更后让阴影重算一帧（autoUpdate=false 时必需）
    this.renderer.shadowMap.needsUpdate = true;
  }

  private syncMaterials(mats: MaterialData[]) {
    for (const m of mats) this.materials.get(m); // 预热缓存
  }

  // ============ 渲染设备模式（CPU 兼容 / GPU 高性能）============
  /** 检测 WebGL 真实后端：软件渲染（SwiftShader/llvmpipe）视为无 GPU 加速 */
  private detectBackend() {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      if (ext) {
        const renderer = (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) || "";
        const r = renderer.toLowerCase();
        this.gpuSoftware =
          r.includes("swiftshader") || r.includes("llvmpipe") || r.includes("software") ||
          r.includes("microsoft basic render") || r.includes("mesa offscreen");
      }
    } catch {
      this.gpuSoftware = false;
    }
    const hw = !this.gpuSoftware;
    useSceneStore.getState().setGpuAvailable(hw);
    this.cb.onStatus?.(hw ? "已检测到 GPU 硬件加速（可切换 GPU 性能模式）" : "未检测到 GPU 加速，使用软件渲染（默认 CPU 兼容模式）");
  }

  /** 当前设备模式对应的像素比 */
  private devicePixelRatio(): number {
    return this.deviceMode === "gpu" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  }

  /**
   * 应用渲染设备模式：
   * - GPU：满分辨率（设备像素比，上限 2）+ 开启阴影，最高画质
   * - CPU：像素比锁定 1x、关闭阴影投影，大幅降低 GPU 负载，保证流畅（兼容/回退档）
   */
  applyDeviceMode(device: "cpu" | "gpu") {
    this.deviceMode = device;
    this.renderer.setPixelRatio(this.devicePixelRatio());
    // CPU 模式也保留阴影，仅降低贴图分辨率以减轻软渲染负担；彻底关闭阴影会让物体“贴”在背景上，不真实
    this.renderer.shadowMap.enabled = true;
    const shadowSize = device === "gpu" ? 2048 : 1024;
    this.shadowLight.shadow.mapSize.set(shadowSize, shadowSize);
    this.shadowLight.shadow.map = null;
    this.renderer.shadowMap.needsUpdate = true;
    this.onResize(); // 用新像素比重设绘制缓冲
    // 武装/解除自动回退监测窗口
    this.lowFpsSamples = 0;
    this.autoFallbackArmed = device === "gpu";
  }

  private syncObjects(objects: SceneJSON["objects"]) {
    const ids = new Set<string>();
    for (const obj of objects) {
      ids.add(obj.id);
      let three: THREE.Object3D | null = this.objectMap.get(obj.id) ?? null;
      if (!three) {
        three = this.buildObject(obj);
        if (three) {
          three.userData.mrenderId = obj.id;
          this.objectMap.set(obj.id, three);
          this.scene.add(three);
        }
      }
      if (!three) continue;
      three.visible = obj.visible;
      three.position.fromArray(obj.transform.position);
      three.rotation.set(
        THREE.MathUtils.degToRad(obj.transform.rotation[0]),
        THREE.MathUtils.degToRad(obj.transform.rotation[1]),
        THREE.MathUtils.degToRad(obj.transform.rotation[2])
      );
      three.scale.fromArray(obj.transform.scale);
      // 阴影投射（跳过选中高亮层）
      three.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (mesh.isMesh) {
          if (mesh.userData.isSelectionOutline) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      // 材质应用：仅当 materialId 有值时覆盖（保留内置模型的原始材质）。
      // userData.skipMaterialOverride = true 的 mesh（如演示瓶的瓶盖、液体）保持原始材质不被覆盖。
      if (obj.materialId) {
        const matData = this.materialData(obj.materialId);
        if (matData) {
          const mat = this.materials.get(matData);
          three.traverse((n) => {
            const mesh = n as THREE.Mesh;
            if (mesh.isMesh && !mesh.userData.isSelectionOutline && !mesh.userData.skipMaterialOverride) mesh.material = mat;
          });
        }
      }
      // 标签渲染：作为子 mesh 贴在物件表面
      this.syncLabels(three, obj);
    }
      // 移除不存在的对象
    for (const [id, three] of this.objectMap) {
      if (!ids.has(id)) {
        this.scene.remove(three);
        this.objectMap.delete(id);
        three.traverse((n) => {
          const mesh = n as THREE.Mesh;
          if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
        });
      }
    }
    // 如果 gizmo 指向的对象被移除，解绑
    if (this.gizmo.object && !this.objectMap.has(this.gizmo.object.userData.mrenderId as string)) {
      this.gizmo.detach();
    }
    // 对象列表变化后刷新选中高亮（例如打散后新部件已建好，需要给新选中对象描边）
    this.refreshSelectionOutline();
  }

  /** 构建对象：内置模型直接程序化，导入模型走缓存/重新解析 */
  private buildObject(obj: SceneJSON["objects"][number]): THREE.Object3D | null {
    let three: THREE.Object3D | null = null;
    if (obj.source === "builtin:demo_bottle") {
      three = buildDemoBottle();
    } else if (obj.source === "builtin:cube") {
      three = new THREE.Mesh(new THREE.BoxGeometry(50, 50, 50), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.1 }));
    } else if (obj.source === "builtin:sphere") {
      three = new THREE.Mesh(new THREE.SphereGeometry(30, 48, 32), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 }));
    } else if (obj.source === "builtin:plane") {
      three = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, side: THREE.DoubleSide }));
    } else if (obj.source === "builtin:cylinder") {
      three = new THREE.Mesh(new THREE.CylinderGeometry(25, 25, 60, 48), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.1 }));
    } else if (obj.source === "builtin:torus") {
      three = new THREE.Mesh(new THREE.TorusGeometry(30, 10, 24, 64), new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.2 }));
    } else if (obj.type === "group" && obj.children && obj.children.length > 0) {
      three = new THREE.Group();
      three.name = obj.name;
      for (const child of obj.children) {
        const c = this.buildObject(child);
        if (!c) continue;
        c.position.fromArray(child.transform.position);
        c.rotation.set(
          THREE.MathUtils.degToRad(child.transform.rotation[0]),
          THREE.MathUtils.degToRad(child.transform.rotation[1]),
          THREE.MathUtils.degToRad(child.transform.rotation[2])
        );
        c.scale.fromArray(child.transform.scale);
        // 不给孩子设 mrenderId：点击群内任意 Mesh 应选中整个 Group，而不是单独子部件
        three.add(c);
      }
    } else if (obj.source && obj.source.startsWith("data:")) {
      const cached = this.modelCache.get(obj.source);
      if (cached) {
        // 打散模式：只取指定名称的子 mesh
        if (obj.partName) {
          let found: THREE.Object3D | null = null;
          cached.traverse((n) => {
            if (!found && n.name === obj.partName) found = n.clone(true);
          });
          three = found ?? cached.clone();
        } else {
          three = cached.clone();
        }
      } else {
        // 异步加载，完成后再加入（同步流程此处返回 null，由加载回调补建）
        this.hydrateDataUrl(obj);
        return null;
      }
    } else {
      three = new THREE.Group(); // 空对象占位
    }
    // 统一居中：把几何体重心移到原点，使 Gizmo 显示在物件中心
    // 打散后的子部件已烘焙世界坐标（preTransformed），跳过以免错位；
    // 群组对象（type=group）本身没有几何体，其 children 已相对 group 中心，跳过。
    if (three && !obj.preTransformed && obj.type !== "group") this.centerToOrigin(three);
    return three;
  }

  /** 同步标签：为每个 label 在物件下创建/更新一个 plane mesh */
  private syncLabels(parent: THREE.Object3D, obj: SceneObjectData) {
    // 收集当前 parent 下所有已存在的 label mesh（包括可能挂在子 mesh 上的 Decal）
    const existing: THREE.Mesh[] = [];
    parent.traverse((c) => { if (c.userData.isLabel) existing.push(c as THREE.Mesh); });
    const keepIds = new Set<string>();

    if (!obj.labels || obj.labels.length === 0) {
      existing.forEach((c) => { c.parent?.remove(c); this.disposeLabelMesh(c); });
      return;
    }

    // 选择投影目标：取包围盒体积最大的 mesh（通常是瓶身/主体），避免贴到瓶盖/瓶口圆环上
    const meshes = collectMeshes(parent);
    const target = meshes.length
      ? meshes.reduce((a, b) => {
          a.updateWorldMatrix(true, true);
          b.updateWorldMatrix(true, true);
          const sa = new THREE.Box3().setFromObject(a).getSize(new THREE.Vector3());
          const sb = new THREE.Box3().setFromObject(b).getSize(new THREE.Vector3());
          const va = sa.x * sa.y * sa.z;
          const vb = sb.x * sb.y * sb.z;
          return va > vb ? a : b;
        })
      : null;

    for (const lb of obj.labels) {
      keepIds.add(lb.id);
      const existingMesh = existing.find((c) => c.userData.labelId === lb.id);
      if (existingMesh) {
        existingMesh.parent?.remove(existingMesh);
        this.disposeLabelMesh(existingMesh);
      }
      if (!target) continue;

      const tex = this.loadLabelTexture(lb.src);
      // 保持贴图原始宽高比：以 U 缩放为宽度基准，高度按 aspect 自动计算
      let aspect = 1;
      const img = tex?.image as HTMLImageElement | undefined;
      if (img && img.width > 0) {
        aspect = img.width / img.height;
      }
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        opacity: lb.opacity,
        alphaTest: 0.1,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        side: lb.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
        color: 0xffffff,
      });

      // 基于父物件包围盒计算贴花的世界坐标
      target.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(parent);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const pm = parent.matrixWorld;
      const right = new THREE.Vector3().setFromMatrixColumn(pm, 0).normalize();
      const up = new THREE.Vector3().setFromMatrixColumn(pm, 1).normalize();
      const forward = new THREE.Vector3().setFromMatrixColumn(pm, 2).normalize();
      const posWorld = center.clone()
        .add(right.clone().multiplyScalar((lb.position[0] - 0.5) * size.x))
        .add(up.clone().multiplyScalar((lb.position[1] - 0.5) * size.y))
        .add(forward.clone().multiplyScalar(size.z * 0.55));

      // 方向：+Z 朝外，并叠加用户旋转
      const qAlign = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), forward);
      const qRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), lb.rotation);
      const qWorld = qAlign.clone().multiply(qRot);
      const eulerWorld = new THREE.Euler().setFromQuaternion(qWorld);

      const width = size.x * lb.scale[0];
      const height = width / aspect; // 保持贴图比例
      const depth = Math.max(size.z * 0.3, 5);

      // DecalGeometry 的 position/orientation 是世界空间；贴花几何体生成后已是世界坐标
      const decalGeo = new DecalGeometry(target, posWorld, eulerWorld, new THREE.Vector3(width, height, depth));

      const decal = new THREE.Mesh(decalGeo, mat);
      decal.userData.isLabel = true;
      decal.userData.labelId = lb.id;
      decal.renderOrder = 10; // 确保标签绘制在透明玻璃之上
      // 把贴花挂到目标 mesh 下，但局部变换设为目标世界矩阵的逆，使贴花世界坐标保持不变并随目标移动
      target.add(decal);
      target.matrixWorld.clone().invert().decompose(decal.position, decal.quaternion, decal.scale);
      // 再沿表面法线向外顶出约 0.8mm，避免陷入玻璃内部/与表面 z-fight
      const worldForward = forward.clone();
      const localForward = target.worldToLocal(worldForward.add(target.position)).sub(target.worldToLocal(target.position.clone()));
      localForward.normalize().multiplyScalar(0.8);
      decal.position.add(localForward);
    }

    for (const c of existing) {
      if (!keepIds.has(c.userData.labelId as string)) {
        c.parent?.remove(c);
        this.disposeLabelMesh(c);
      }
    }
  }

  private disposeLabelMesh(mesh: THREE.Mesh) {
    mesh.geometry?.dispose();
    const mat = mesh.material as THREE.Material | undefined;
    if (mat) mat.dispose();
  }

  private labelTexCache = new Map<string, THREE.Texture>();
  private loadLabelTexture(src: string): THREE.Texture | null {
    const cached = this.labelTexCache.get(src);
    if (cached) return cached;
    try {
      const tex = new THREE.TextureLoader().load(src);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.labelTexCache.set(src, tex);
      return tex;
    } catch { return null; }
  }

  /** 打散物件：返回所有可拆分的子部件信息（递归收集所有 Mesh，无名自动命名） */
  explodeModel(objectId: string): { name: string }[] | null {
    const three = this.objectMap.get(objectId);
    if (!three) return null;
    const meshes = collectMeshes(three);
    if (meshes.length < 2) return null;
    return meshes.map((m, i) => ({ name: m.name || `Part_${i + 1}` }));
  }

  /**
   * 真正执行打散：递归收集对象下所有 Mesh，把每个 Mesh 导出为独立 GLB data URL，
   * 生成若干个完全独立的子对象，删除原对象。支持任意来源（导入 GLTF/OBJ/FBX/3DM / 内置酒瓶 / 几何体）。
   * 返回拆分数量。
   */
  async ungroupObject(objectId: string): Promise<{ ok: boolean; count: number; message: string }> {
    const root = this.objectMap.get(objectId);
    if (!root) return { ok: false, count: 0, message: "找不到该对象" };
    const store = useSceneStore.getState();
    const orig = store.scene.objects.find((o) => o.id === objectId);

    // 群组对象：把 children 恢复为独立顶层对象（保持当前世界变换）
    if (orig?.type === "group" && orig.children && orig.children.length > 0) {
      const parts = this.explodeGroup(orig);
      const finalObjs = store.scene.objects.filter((o) => o.id !== objectId).concat(parts);
      store.replaceObjects(finalObjs, parts[0]?.id);
      return { ok: true, count: parts.length, message: `群组已解散为 ${parts.length} 个独立物件` };
    }

    const meshes = collectMeshes(root);
    if (meshes.length < 2)
      return { ok: false, count: 0, message: "该对象没有可拆分的子部件（已是单体或单一网格）" };

    root.updateWorldMatrix(true, true);
    const parts: SceneObjectData[] = [];
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      // 烘焙为独立部件：世界矩阵进几何 + 几何体重心归到局部原点 + 对象位置=重心
      // （既保持在原世界位置不散落变形，又让 Gizmo/轴心落在物件正中央）
      const clone = bakePart(mesh);
      // 直接把烘焙后的几何体序列化为 data URL（彻底脱离原模型，互不干扰）。
      // 不再串行跑 GLTFExporter：对大量网格既重又易在 SwiftShader 下 OOM/崩溃。
      // 该 data URL 同时作为缓存键与保存/加载序列化来源。
      const dataUrl = bakeGeometryToDataURL(clone.geometry);
      // 关键：把已烘焙的网格直接缓存，使 syncObjects 能「同步」构建部件，
      // 不再走 fetch→重新解析 的异步链路（SwiftShader 下极慢且易丢件）。
      this.modelCache.set(dataUrl, clone);
      const stat = countTrianglesSafe(clone);
      parts.push({
        id: `obj_${Date.now().toString(36)}_${i}`,
        name: `${orig?.name ?? "对象"} / ${mesh.name || `Part_${i + 1}`}`,
        type: "mesh",
        source: dataUrl,
        transform: { position: [clone.position.x, clone.position.y, clone.position.z], rotation: [0, 0, 0], scale: [1, 1, 1] },
        materialId: orig?.materialId ?? null,
        visible: true,
        preTransformed: true,
        stats: { triangles: stat.triangles, vertices: stat.vertices },
      });
      // 每处理若干网格让出一次事件循环，避免长任务阻塞渲染线程
      if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
    }
    // 原对象已被拆分成独立部件：释放其缓存（避免 34MB+ 原始模型常驻内存泄漏）
    if (orig?.source) this.modelCache.delete(orig.source);
    // 一次性替换对象列表并记一步历史（原对象消失，生成若干独立部件）
    const finalObjs = store.scene.objects.filter((o) => o.id !== objectId).concat(parts);
    store.replaceObjects(finalObjs, parts[0]?.id);
    return { ok: true, count: parts.length, message: `已打散为 ${parts.length} 个独立部件` };
  }

  /**
   * 群组相关子物件：以选中对象的名称为基准（如 "酒瓶 / Part_1" 的基名是 "酒瓶"），
   * 把所有共享同一基名的物件合并为一个 Group。
   * 这是打散/重组工作流里的「组合回去」，也支持把任意同前缀物件编组。
   */
  groupObjects(selectedId: string): { ok: boolean; count: number; groupId?: string; message: string } {
    const store = useSceneStore.getState();
    const selected = store.scene.objects.find((o) => o.id === selectedId);
    if (!selected) return { ok: false, count: 0, message: "未选中任何对象" };
    const baseName = selected.name.split(" / ")[0] || selected.name;
    const members = store.scene.objects.filter(
      (o) => o.id === selectedId || o.name === baseName || o.name.startsWith(`${baseName} / `)
    );
    if (members.length < 2) return { ok: false, count: members.length, message: "没有可群组的同类物件（至少需要 2 个共享基名的部件）" };
    store.groupObjects(members.map((o) => o.id));
    return { ok: true, count: members.length, message: `已将 ${members.length} 个物件群组为 "${baseName}"` };
  }

  /**
   * 解散群组：把 group.children 恢复到顶层，计算每个 child 的当前世界变换。
   * 使用临时 THREE 节点做精确矩阵合成，避免 Euler 角度直接相加的误差。
   */
  private explodeGroup(groupData: SceneObjectData): SceneObjectData[] {
    const children = groupData.children ?? [];
    if (children.length === 0) return [];
    const tmp = new THREE.Group();
    tmp.position.fromArray(groupData.transform.position);
    tmp.rotation.set(
      THREE.MathUtils.degToRad(groupData.transform.rotation[0]),
      THREE.MathUtils.degToRad(groupData.transform.rotation[1]),
      THREE.MathUtils.degToRad(groupData.transform.rotation[2])
    );
    tmp.scale.fromArray(groupData.transform.scale);
    tmp.updateMatrixWorld();

    const out: SceneObjectData[] = [];
    for (const child of children) {
      const c = this.buildObject(child);
      if (!c) continue;
      c.position.fromArray(child.transform.position);
      c.rotation.set(
        THREE.MathUtils.degToRad(child.transform.rotation[0]),
        THREE.MathUtils.degToRad(child.transform.rotation[1]),
        THREE.MathUtils.degToRad(child.transform.rotation[2])
      );
      c.scale.fromArray(child.transform.scale);
      tmp.add(c);
      c.updateWorldMatrix(true, false);
      const wp = new THREE.Vector3();
      const wq = new THREE.Quaternion();
      const ws = new THREE.Vector3();
      c.getWorldPosition(wp);
      c.getWorldQuaternion(wq);
      c.getWorldScale(ws);
      const euler = new THREE.Euler().setFromQuaternion(wq);
      out.push({
        ...child,
        id: nextUid("obj"),
        name: child.name,
        transform: {
          position: [wp.x, wp.y, wp.z],
          rotation: [
            THREE.MathUtils.radToDeg(euler.x),
            THREE.MathUtils.radToDeg(euler.y),
            THREE.MathUtils.radToDeg(euler.z),
          ],
          scale: [ws.x, ws.y, ws.z],
        },
      });
    }
    return out;
  }

  /** 计算包围盒并把几何体平移使重心在原点（导入模型已居中，重复调用无害） */
  private centerToOrigin(root: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    if (center.lengthSq() < 1e-8) return; // 已在原点
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.geometry) {
        obj.geometry.translate(-center.x, -center.y, -center.z);
      }
    });
    root.updateMatrixWorld(true);
  }

  // （bakePart 提取为模块级函数，见文件末尾）

  /** 预缓存模型（打散/导入打散时同步构建部件用，避免异步 round-trip） */
  precacheModel(url: string, obj: THREE.Object3D) {
    this.modelCache.set(url, obj);
  }

  private async hydrateDataUrl(obj: SceneJSON["objects"][number]) {
    if (!obj.source || !obj.source.startsWith("data:")) return;
    const cached = this.modelCache.get(obj.source);
    if (cached) return;
    // 打散子部件：几何体直接序列化的 data URL，无需经 GLTF 解析，立即还原
    if (isBakedGeometryDataURL(obj.source)) {
      const mesh = decodeGeometryDataURL(obj.source);
      if (mesh) {
        mesh.userData.mrenderId = obj.id;
        this.modelCache.set(obj.source, mesh);
        this.syncScene(useSceneStore.getState().scene);
        this.cb.onStatus?.(`已加载 ${obj.name}（打散部件）`);
        return;
      }
    }
    try {
      const blob = await (await fetch(obj.source)).blob();
      const fileName = obj.name || "model";
      const ext = obj.sourceFormat || this.guessExt(blob);
      const file = new File([blob], `${fileName}.${ext}`, { type: blob.type });
      // 打散后的子部件已烘焙世界坐标，绝不能再归一化
      const result = await importModelFile(file, { normalize: !obj.preTransformed });
      result.object.userData.mrenderId = obj.id;
      this.modelCache.set(obj.source, result.object);
      // 重新同步该对象
      const scene = useSceneStore.getState().scene;
      this.syncScene(scene);
      this.cb.onStatus?.(`已加载 ${obj.name}（${result.triangles.toLocaleString()} 三角形）`);
    } catch (e) {
      this.cb.onStatus?.(`模型加载失败: ${(e as Error).message}`);
    }
  }

  private guessExt(blob: Blob): string {
    const t = blob.type;
    if (t.includes("gltf")) return "glb";
    if (t.includes("stl")) return "stl";
    if (t.includes("ply")) return "ply";
    if (t.includes("obj")) return "obj";
    if (t.includes("3dm")) return "3dm";
    return "obj";
  }

  private materialData(id: string): MaterialData | undefined {
    return useSceneStore.getState().scene.materials[id];
  }

  private syncLights(lights: LightData[]) {
    const ids = new Set<string>();
    for (const ld of lights) {
      ids.add(ld.id);
      let light = this.lightMap.get(ld.id);
      let helper: THREE.Object3D | null = this.lightHelperMap.get(ld.id) ?? null;
      if (!light) {
        light = this.buildLight(ld);
        this.lightMap.set(ld.id, light);
        this.scene.add(light);
        helper = this.buildLightHelper(ld, light);
        if (helper) {
          helper.userData.isLightHelper = true;
          this.lightHelperMap.set(ld.id, helper);
          this.scene.add(helper);
        }
        // SpotLight 需要把 target 加入场景
        if (light instanceof THREE.SpotLight) {
          this.scene.add(light.target);
          this.lightTargetMap.set(ld.id, light.target);
        }
      }
      light.visible = ld.visible;
      light.position.fromArray(ld.position);
      light.color.setRGB(ld.color[0], ld.color[1], ld.color[2]);
      // RectAreaLight 沿自身 -Z 发射，必须朝向目标（默认场景中心）才能照亮物体；
      // 否则灯光几乎全部射向场景外，等于无效（此前灯光对渲染无可见影响的根因）。
      if (ld.type === "area") {
        const t = ld.target ?? [0, 120, 0];
        light.lookAt(t[0], t[1], t[2]);
      }
      // 同步 target
      if (ld.target) {
        if (light instanceof THREE.SpotLight) {
          light.target.position.fromArray(ld.target);
          light.target.updateMatrixWorld();
        } else if (light instanceof THREE.DirectionalLight) {
          light.target.position.fromArray(ld.target);
          light.target.updateMatrixWorld();
        }
      }
      // 强度直接使用存储值（three.js r155+ 灯光为物理单位，之前 *10/*5/*0.5 导致过曝）。
      // 兼容旧项目：旧版 area/point/spot 强度是 8000/6000/4000 量级，>100 时自动 ÷1000。
      const lightIntensity = ld.intensity > 100 ? ld.intensity / 1000 : ld.intensity;
      if (light instanceof THREE.SpotLight) {
        light.angle = (ld.angle ?? 30) * THREE.MathUtils.DEG2RAD;
        light.penumbra = ld.penumbra ?? 0.3;
        light.intensity = lightIntensity;
        light.distance = ld.distance ?? 0;
      } else if (light instanceof THREE.PointLight) {
        light.intensity = lightIntensity;
      } else if (light instanceof THREE.DirectionalLight) {
        light.intensity = lightIntensity;
      } else if ((light as THREE.RectAreaLight).isRectAreaLight) {
        (light as THREE.RectAreaLight).intensity = lightIntensity;
        const size = ld.size ?? [1, 1];
        (light as THREE.RectAreaLight).width = size[0];
        (light as THREE.RectAreaLight).height = size[1];
      }
      // 同步 helper：默认隐藏，避免在画面中显示灰色框；可在灯光面板打开
      if (helper) {
        helper.visible = ld.visible && useSceneStore.getState().showLightHelpers;
        helper.position.copy(light.position);
        if (ld.target) {
          helper.lookAt(ld.target[0], ld.target[1], ld.target[2]);
        }
        if (ld.type === "area" && helper instanceof THREE.Mesh) {
          const w = ld.size?.[0] ?? 1;
          const h = ld.size?.[1] ?? 1;
          helper.scale.set(w, h, 1);
        }
      }
    }
    // 阴影灯跟随主光方向（RectAreaLight 不投影，需一个 DirectionalLight 提供接触阴影）
    this.updateShadowCaster(lights);
    for (const [id, light] of this.lightMap) {
      if (!ids.has(id)) {
        this.scene.remove(light);
        this.lightMap.delete(id);
        const target = this.lightTargetMap.get(id);
        if (target) {
          this.scene.remove(target);
          this.lightTargetMap.delete(id);
        }
        const h = this.lightHelperMap.get(id);
        if (h) {
          this.scene.remove(h);
          this.lightHelperMap.delete(id);
        }
      }
    }
  }

  private buildLightHelper(ld: LightData, light: THREE.Light): THREE.Object3D | null {
    const color = new THREE.Color(ld.color[0], ld.color[1], ld.color[2]);
    const mat = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.55, depthTest: false });
    switch (ld.type) {
      case "point": {
        return new THREE.Mesh(new THREE.SphereGeometry(6, 12, 12), mat);
      }
      case "spot": {
        const angle = (ld.angle ?? 30) * THREE.MathUtils.DEG2RAD;
        const h = new THREE.Mesh(new THREE.ConeGeometry(Math.tan(angle) * 25, 25, 24, 1, true), mat);
        h.rotation.x = Math.PI / 2;
        return h;
      }
      case "sun": {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.SphereGeometry(6, 12, 12), mat));
        // 指向 target 的箭头
        const arr = new THREE.Mesh(new THREE.ConeGeometry(3, 10, 12), mat);
        arr.rotation.x = Math.PI / 2;
        arr.position.z = 12.5;
        g.add(arr);
        return g;
      }
      case "area": {
        const w = ld.size?.[0] ?? 1;
        const h = ld.size?.[1] ?? 1;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
        return m;
      }
      default: return null;
    }
  }

  private buildLight(ld: LightData): THREE.Light {
    switch (ld.type) {
      case "point": {
        const l = new THREE.PointLight(0xffffff, 5, 0, 2);
        return l;
      }
      case "spot": {
        const l = new THREE.SpotLight(0xffffff, 100, 0, (ld.angle ?? 30) * THREE.MathUtils.DEG2RAD, ld.penumbra ?? 0.3);
        l.target.position.set(...(ld.target ?? [0, 0, 0]));
        return l;
      }
      case "sun": {
        const l = new THREE.DirectionalLight(0xffffff, 3);
        l.castShadow = true;
        l.shadow.mapSize.set(2048, 2048);
        l.shadow.camera.near = 25;
        l.shadow.camera.far = 2500;
        l.shadow.camera.left = -500;
        l.shadow.camera.right = 500;
        l.shadow.camera.top = 500;
        l.shadow.camera.bottom = -500;
        l.shadow.bias = -0.0005;
        l.target.position.set(...(ld.target ?? [0, 0, 0]));
        this.scene.add(l.target);
        return l;
      }
      default: {
        const l = new THREE.RectAreaLight(0xffffff, 10, 120, 80);
        return l;
      }
    }
  }

  /** 从 HDR equirect 计算“主光方向”（亮度加权），实现 KeyShot 式环境驱动阴影：
   *  环境 HDRI 即光源，阴影方向随 HDR 中最亮区域走。无 HDR（程序化/渐变环境）时用中性高位柔光方向。 */
  private computeEnvDominantDir() {
    const base = this.hdrEquirectRaw as THREE.DataTexture | null;
    if (!base || !base.image || !(base.image.data as Float32Array)) {
      // 程序化/渐变环境：中性高位柔光（顶部偏侧），保证自然接触阴影
      this.envDominantDir.set(0.3, 0.85, 0.45).normalize();
      this.envAvgLum = 1;
      this.updateShadowCaster(useSceneStore.getState().scene.lights);
      return;
    }
    const data = base.image.data as Float32Array;
    const w = base.image.width, h = base.image.height;
    const ch = Math.max(3, Math.min(4, Math.round(data.length / (w * h))));
    let dx = 0, dy = 0, dz = 0, sumLum = 0;
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 400000))); // 控制采样量，避免超大 HDR 卡顿
    for (let y = 0; y < h; y += step) {
      const v = (y + 0.5) / h;
      const theta = v * Math.PI;
      const sy = Math.sin(theta), cyv = Math.cos(theta);
      for (let x = 0; x < w; x += step) {
        const u = (x + 0.5) / w;
        const phi = u * Math.PI * 2;
        const i = (y * w + x) * ch;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        lum = Math.min(lum, 6); // 压缩：避免单一过曝高光主导方向
        const wgt = Math.sqrt(lum); // 用亮度平方根加权，兼顾中等亮度区域
        dx += sy * Math.cos(phi) * wgt;
        dy += cyv * wgt;
        dz += sy * Math.sin(phi) * wgt;
        sumLum += lum;
      }
    }
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) {
      this.envDominantDir.set(0.3, 0.85, 0.45).normalize();
    } else {
      this.envDominantDir.set(dx / len, dy / len, dz / len);
    }
    this.envAvgLum = sumLum / Math.max(1, (w / step) * (h / step));
    this.updateShadowCaster(useSceneStore.getState().scene.lights);
  }

  /** 常驻阴影灯：跟随主光方向，保证任何灯光组合下都有柔和接触阴影（RectAreaLight 不投影） */
  private updateShadowCaster(lights: LightData[]) {
    const visible = lights.filter((l) => l.visible);
    if (visible.length === 0) {
      // KeyShot 默认：环境(HDR)即光源，阴影灯跟随 HDR 主光方向 → 阴影随环境变化（含旋转）
      const q = new THREE.Quaternion().setFromEuler(this.scene.environmentRotation ?? new THREE.Euler());
      const d = this.envDominantDir.clone().applyQuaternion(q);
      const R = 900; // 环境球半径（与灯光针一致）
      const cx = 0, cy = 120, cz = 0;
      const px = cx + d.x * R;
      const pz = cz + d.z * R;
      const py = Math.max(cy + 160, cy + d.y * R); // 保证光源在上方，阴影向下
      this.shadowLight.position.set(px, py, pz);
      this.shadowLight.target.position.set(cx, cy, cz);
      this.shadowLight.target.updateMatrixWorld();
    } else {
      // 取强度最大的可见灯作为“主光”方向
      const key = visible.reduce((a, b) => (b.intensity > a.intensity ? b : a));
      const p = key.position;
      const t = key.target ?? [0, 120, 0];
      // 抬高主光方向，避免阴影过长过硬（产品摄影常见高位柔光）
      this.shadowLight.position.set(p[0] * 1.2, Math.max(p[1], 260), p[2] * 1.2 + 80);
      this.shadowLight.target.position.set(t[0], t[1], t[2]);
      this.shadowLight.target.updateMatrixWorld();
    }
    // 强度随环境亮度自适应（暗场景弱、亮场景强），保持接触阴影始终可读
    const envI = this.scene.environmentIntensity || 1;
    this.shadowLight.intensity = THREE.MathUtils.clamp(1.6 * envI, 0.6, 4.5);
  }

  // ============ 地面 ============
  private applyGround(ground: SceneJSON["environment"]["ground"]) {
    const floor = this.floorMesh;
    const catcher = this.shadowCatcher;

    // 实体地面与透明接影地面互斥：实体地面开启时由它承担落影；关闭时由透明 catcher 接影。
    // 路径追踪需要真实几何体才能产生物理接触阴影，因此路径追踪下强制开启实体地面。
    const isPathTrace = useSceneStore.getState().scene.render.mode === "pathtrace";
    if (isPathTrace) {
      floor.visible = true;
      catcher.visible = false;
    } else if (ground.enabled) {
      floor.visible = true;
      catcher.visible = false;
    } else {
      floor.visible = false;
      catcher.visible = ground.shadow;
    }

    const mat = floor.material as THREE.MeshStandardMaterial;
    // 地面色通过顶点色渐变体现（与 HDR 地平线色在墙面顶部过渡）
    this.cycFloorColor.setRGB(ground.color[0], ground.color[1], ground.color[2]);
    this.applyCycloramaColors();
    // 反射/磨砂：reflection=true → 中等粗糙度 + 低金属度 + 适中 envMap，呈“柔和影棚反射”；
    // 避免纯镜面让瓶子看起来像悬空。磨砂地面则压低 envMap 使其成为落影面。
    if (ground.reflection) {
      mat.roughness = 0.42;
      mat.metalness = 0.12;
      mat.envMapIntensity = 0.85;
    } else {
      mat.roughness = 0.65;
      mat.metalness = 0.0;
      mat.envMapIntensity = 0.45;
    }
    mat.needsUpdate = true;
  }

  /** 构建曲面 cyclorama 几何：平面落影区(R_flat) + smoothstep 扫掠升起为背板(R_curve/H_back)，绕 Y 轴旋转成 360° 影棚 */
  private makeCycloramaGeometry(): THREE.LatheGeometry {
    const R_flat = 500;    // 平面落影半径(mm)
    const R_curve = 900;   // 曲面扫掠水平延伸
    const H_back = 700;    // 背板高度
    const pts: THREE.Vector2[] = [];
    const N_flat = 28;
    for (let i = 0; i <= N_flat; i++) pts.push(new THREE.Vector2((R_flat * i) / N_flat, 0));
    const N_curve = 96;
    for (let i = 1; i <= N_curve; i++) {
      const t = i / N_curve;
      const s = t * t * (3 - 2 * t); // smoothstep，使转角柔和
      pts.push(new THREE.Vector2(R_flat + R_curve * s, H_back * s));
    }
    const geo = new THREE.LatheGeometry(pts, 160);
    this.cycMaxY = H_back;
    return geo;
  }

  /** 用当前地面色（底）与 HDR 地平线色（顶）重写 cyclorama 顶点色 */
  private applyCycloramaColors() {
    const geo = this.floorMesh.geometry as THREE.LatheGeometry;
    const pos = geo.getAttribute("position");
    let col = geo.getAttribute("color") as THREE.BufferAttribute | undefined;
    // 必须用 RGBA(itemSize 4)：three-gpu-pathtracer 给缺色网格补的 color 是 itemSize 4，
    // 若此处用 RGB(itemSize 3)，路径追踪 mergeGeometries 会因 itemSize 不一致而缓冲溢出。
    if (!col || col.count !== pos.count || col.itemSize !== 4) {
      col = new THREE.BufferAttribute(new Float32Array(pos.count * 4), 4);
      geo.setAttribute("color", col);
    }
    const top = this.cycHorizon;
    const bot = this.cycFloorColor;
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = THREE.MathUtils.clamp(y / this.cycMaxY, 0, 1);
      const s = t * t * (3 - 2 * t); // 二次缓和，让过渡集中在墙面、底部保持地面色
      tmp.copy(bot).lerp(top, s);
      col.setXYZW(i, tmp.r, tmp.g, tmp.b, 1);
    }
    col.needsUpdate = true;
  }

  /** 采样当前 HDR equirect 赤道带，得到“地平线色”，用于 cyclorama 顶色，确保与任意 HDR 背景无缝融合 */
  private updateCycloramaHorizon() {
    const base = this.hdrEquirectRaw as THREE.DataTexture | null;
    const fallback = () => { this.cycHorizon.setRGB(0.5, 0.52, 0.55); this.applyCycloramaColors(); };
    if (!base || !base.image || !(base.image.data as Float32Array)) { fallback(); return; }
    const data = base.image.data as Float32Array;
    const w = base.image.width, h = base.image.height;
    const ch = Math.max(3, Math.min(4, Math.round(data.length / (w * h)))); // 3 或 4 通道
    let r = 0, g = 0, b = 0, n = 0;
    const band = Math.max(1, Math.round(h * 0.06)); // 赤道上下各 ~3% 带
    const y0 = Math.floor(h / 2 - band), y1 = Math.floor(h / 2 + band);
    for (let y = y0; y < y1; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = (row + x) * ch;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    }
    if (n === 0) { fallback(); return; }
    const rein = (v: number) => v / (1 + v); // 轻 Reinhard 压高光，得柔和影棚地平线色
    this.cycHorizon.setRGB(rein(r / n), rein(g / n), rein(b / n));
    this.applyCycloramaColors();
  }

  // ============ 灯光针（KeyShot Light Pins）============
  /** 把灯光针映射为场景里的 RectAreaLight：azimuth/elevation → 球坐标方向，指向场景中心 */
  private syncLightPins(pins: LightPinData[]) {
    const ids = new Set<string>();
    const target = new THREE.Vector3(0, 120, 0); // 产品中心（瓶～250mm 高）
    for (const p of pins) {
      ids.add(p.id);
      let light = this.lightPinMap.get(p.id);
      if (!light) {
        light = new THREE.RectAreaLight(0xffffff, 1, 1, 1);
        this.lightPinMap.set(p.id, light);
        this.scene.add(light);
      }
      light.visible = true;
      const az = (p.azimuth ?? 0) * THREE.MathUtils.DEG2RAD;
      const el = (p.elevation ?? 0) * THREE.MathUtils.DEG2RAD;
      const R = 900; // mm，环境球半径
      light.position.set(
        R * Math.cos(el) * Math.cos(az),
        R * Math.sin(el),
        R * Math.cos(el) * Math.sin(az)
      );
      light.lookAt(target);
      light.color.setRGB(p.color[0], p.color[1], p.color[2]);
      // KeyShot Brightness(0–50) → RectAreaLight 物理强度（与内置 area 灯同量级）
      light.intensity = (p.brightness ?? 10) * 0.8;
      const s = p.size ?? 120; // mm
      light.width = s;
      light.height = p.shape === "circular" ? s : s * 0.7;
      light.userData.isLightPin = true;
    }
    for (const [id, light] of this.lightPinMap) {
      if (!ids.has(id)) {
        this.scene.remove(light);
        this.lightPinMap.delete(id);
      }
    }
  }

  // ============ 环境 ============
  private applyEnvironment(env: SceneJSON["environment"]) {
    // 把 preset 反查 ENV_PRESETS 解析出 hdrUrl（修复：HDR 预设此前只生成渐变、从不加载真实 HDR）
    const presetDef = ENV_PRESETS.find((p) => p.id === env.preset);
    const hdrUrl = env.hdrUrl || presetDef?.hdrUrl || null;
    const key = `${env.preset}|${env.hdrKey}|${hdrUrl}`;
    if (this.envKey !== key) {
      this.envKey = key;
      let tex: THREE.Texture | null = null;
      try {
        if (hdrUrl) {
          this.loadHdrUrl(hdrUrl); // 内置库 / KeyShot 借用 HDR（优先）；回调里会 apply 调整项
          return;
        }
        if (env.hdrKey && env.hdrKey.startsWith("data:")) {
          this.loadHdr(env.hdrKey); // 用户导入 HDR
          return;
        }
        switch (env.preset) {
          case "studio_soft": tex = this.buildStudioEnv(STUDIO_SOFT); break;
          case "studio_bright": tex = this.buildStudioEnv(STUDIO_BRIGHT); break;
          case "warm_product": tex = this.buildStudioEnv(WARM_PRODUCT); break;
          case "cool_product": tex = this.buildStudioEnv(COOL_PRODUCT); break;
          case "dark_studio": tex = this.buildStudioEnv(DARK_STUDIO); break;
          case "room": tex = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture; break;
          default: tex = this.buildGradientEnv(env.preset).texture;
        }
      } catch {
        tex = null;
      }
      this.hdrEquirectRaw = null; // 程序化环境不做 Contrast 重处理
      this.scene.environment = tex;
      this.computeEnvDominantDir(); // 程序化/渐变环境→中性高位柔光方向
      if (env.background.mode !== "hdr") this.applyBackground(useSceneStore.getState().scene);
    }
    this.applyEnvAdjustments(env);
  }

  /** 应用环境的可调参数：亮度/尺寸（environmentIntensity）、对比度（HDR 数据重处理）、旋转/高度（environmentRotation） */
  private applyEnvAdjustments(env: SceneJSON["environment"]) {
    const brightness = env.brightness ?? 1;
    const size = env.size ?? 1;
    // 亮度与尺寸共同决定 IBL 强度（WebGL 下尺寸无独立反射缩放，折叠进强度，保证两个滑杆都生效）
    this.scene.environmentIntensity = brightness * size;
    const rotY = (env.rotation ?? 0) * THREE.MathUtils.DEG2RAD;
    const hgtX = (env.height ?? 0) * THREE.MathUtils.DEG2RAD;
    this.scene.environmentRotation = new THREE.Euler(hgtX, rotY, 0, "YXZ");
    // 对比度：仅对真实 HDR 生效（程序化环境为渐变/柔光箱，对比度由灯光强度体现）
    const c = env.contrast ?? 1;
    if (c !== this.envContrast && this.hdrEquirectRaw) {
      this.envContrast = c;
      this.rebuildEnvFromContrast(c);
    }
    // 环境旋转/亮度变化会改变 KeyShot 式阴影方向，重新同步阴影灯
    this.updateShadowCaster(useSceneStore.getState().scene.lights);
  }

  /** 对原始 HDR equirect 数据施加对比度曲线后重新 PMREM（KeyShot Contrast） */
  private rebuildEnvFromContrast(contrast: number) {
    const base = this.hdrEquirectRaw as THREE.DataTexture | null;
    if (!base || !base.image || !(base.image.data as Float32Array)) return;
    const src = base.image.data as Float32Array;
    const len = src.length;
    const out = new Float32Array(len);
    for (let i = 0; i < len; i += 4) {
      let r = (src[i] - 0.5) * contrast + 0.5;
      let g = (src[i + 1] - 0.5) * contrast + 0.5;
      let b = (src[i + 2] - 0.5) * contrast + 0.5;
      if (r < 0) r = 0; else if (!isFinite(r)) r = 1e6;
      if (g < 0) g = 0; else if (!isFinite(g)) g = 1e6;
      if (b < 0) b = 0; else if (!isFinite(b)) b = 1e6;
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = src[i + 3];
    }
    const tex = new THREE.DataTexture(out, base.image.width, base.image.height, base.format as THREE.PixelFormat, base.type);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.needsUpdate = true;
    const pmremTex = this.pmrem.fromEquirectangular(tex).texture;
    this.hdrEquirect = pmremTex;
    this.scene.environment = pmremTex;
    this.updateCycloramaHorizon();
    this.applyBackground(useSceneStore.getState().scene);
    this.computeEnvDominantDir(); // 对比度改变亮区→主光方向可能变化
    tex.dispose();
  }

  // ---- 程序化 Studio IBL（产品渲染柔光箱，KeyShot 摄影棚观感）----
  private makeGradientTexture(top: string, bottom: string): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = 32; c.height = 256;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** 生成影棚渐变背景纹理（equirect：纵向渐变，顶部更亮、中间=地面色=地平线、底部=地面色，形成“无限影棚”观感） */
  private makeStudioBackdropTexture(top: THREE.Color, bottom: THREE.Color): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 256;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    const topCss = `rgb(${(top.r * 255) | 0},${(top.g * 255) | 0},${(top.b * 255) | 0})`;
    const botCss = `rgb(${(bottom.r * 255) | 0},${(bottom.g * 255) | 0},${(bottom.b * 255) | 0})`;
    g.addColorStop(0, topCss);
    g.addColorStop(0.5, botCss); // 地平线处必须与实体地面颜色完全一致
    g.addColorStop(1, botCss);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
    const t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** 更新影棚渐变背景（仅在颜色变化时重绘画布，避免每帧重建） */
  private updateStudioBackdrop(top: THREE.Color, bottom: THREE.Color) {
    if (this.studioBgTop.equals(top) && this.studioBgBottom.equals(bottom)) return;
    this.studioBgTop.copy(top);
    this.studioBgBottom.copy(bottom);
    const c = this.studioBgTex.image as HTMLCanvasElement;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    const topCss = `rgb(${(top.r * 255) | 0},${(top.g * 255) | 0},${(top.b * 255) | 0})`;
    const botCss = `rgb(${(bottom.r * 255) | 0},${(bottom.g * 255) | 0},${(bottom.b * 255) | 0})`;
    g.addColorStop(0, topCss);
    g.addColorStop(0.5, botCss);
    g.addColorStop(1, botCss);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
    this.studioBgTex.needsUpdate = true;
  }

  private buildStudioEnv(p: {
    top: string; bottom: string;
    key: [number, number, number]; keyI: number;
    fill: [number, number, number]; fillI: number;
    rim: [number, number, number]; rimI: number;
  }): THREE.Texture {
    const scene = new THREE.Scene();
    // 天幕（渐变）—— 场景单位为 mm，摄影棚半径需远大于产品
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(3000, 32, 24),
      new THREE.MeshBasicMaterial({ side: THREE.BackSide, map: this.makeGradientTexture(p.top, p.bottom) })
    );
    scene.add(sky);
    // 底部反弹面
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1500, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(p.bottom) })
    );
    floor.rotation.x = -Math.PI / 2; floor.position.y = -600; scene.add(floor);
    // 柔光箱（emissive，作为 IBL 光源）
    const addBox = (pos: [number, number, number], size: [number, number], col: [number, number, number], int: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(size[0], size[1]),
        new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(col[0], col[1], col[2]), emissiveIntensity: int })
      );
      m.position.set(pos[0], pos[1], pos[2]);
      m.lookAt(0, 0, 0);
      scene.add(m);
    };
    addBox([0, 450, 250], [600, 600], p.key, p.keyI);     // 顶部主光
    addBox([-350, 150, 200], [350, 450], p.fill, p.fillI);    // 左辅光
    addBox([350, 300, -300], [300, 450], p.rim, p.rimI);      // 后轮廓光
    // 细长高光条（KeyShot 柔光箱长条），给玻璃/金属提供锐利反射高光与折射结构
    addBox([-120, 600, 0], [22, 1100], [1, 1, 1], Math.max(p.keyI, 4));   // 左侧竖直长条
    addBox([220, 500, 60], [22, 900], [1, 1, 1], Math.max(p.keyI, 4));    // 右侧竖直长条
    return this.pmrem.fromScene(scene, 0.035).texture;
  }

  private buildGradientEnv(preset: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const stops: [string, string][] =
      preset === "studio_gradient"
        ? [["#2c3038", "#1a1c21"]]
        : preset === "golden_hour"
        ? [["#ffd9a0", "#b06a2c"], ["#f5c47a", "#7a4a20"]]
        : [["#dfe8f2", "#39404e"]];
    for (const [top, bottom] of stops) {
      const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
      g.addColorStop(0, top);
      g.addColorStop(1, bottom);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const fakeScene = new THREE.Scene();
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide });
    fakeScene.add(new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 32), mat));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(500, 1000, 500);
    fakeScene.add(light);
    return this.pmrem.fromScene(fakeScene, 0.04);
  }

  private hdrEquirect: THREE.Texture | null = null;
  private loadHdr(dataUrl: string) {
    new RGBELoader().setDataType(THREE.FloatType).load(
      dataUrl,
      (tex) => {
        this.hdrEquirectRaw = tex;
        this.hdrEquirect = this.pmrem.fromEquirectangular(tex).texture;
        this.scene.environment = this.hdrEquirect;
        this.envContrast = NaN; // 强制在 applyEnvAdjustments 中按当前 contrast 重处理
        this.applyEnvAdjustments(useSceneStore.getState().scene.environment);
        this.updateCycloramaHorizon();
        this.computeEnvDominantDir();
        this.applyBackground(useSceneStore.getState().scene);
      },
      undefined,
      () => this.cb.onStatus?.("HDR 加载失败")
    );
  }

  private loadHdrUrl(url: string) {
    new RGBELoader().setDataType(THREE.FloatType).load(
      url,
      (tex) => {
        this.hdrEquirectRaw = tex;
        this.hdrEquirect = this.pmrem.fromEquirectangular(tex).texture;
        this.scene.environment = this.hdrEquirect;
        this.envContrast = NaN; // 强制在 applyEnvAdjustments 中按当前 contrast 重处理
        this.applyEnvAdjustments(useSceneStore.getState().scene.environment);
        this.updateCycloramaHorizon();
        this.computeEnvDominantDir();
        this.applyBackground(useSceneStore.getState().scene);
      },
      undefined,
      () => this.cb.onStatus?.(`HDR 加载失败: ${url}`)
    );
  }

  /** 导入外部 HDR 文件 → 加入自定义环境库并应用 */
  importHdrFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const id = `env_${Date.now().toString(36)}`;
      useSceneStore.getState().addCustomEnvironment({ id, name: file.name.replace(/\.[^.]+$/, ""), src, thumbnail: null });
      useSceneStore.getState().updateEnvironment({ preset: "custom", hdrKey: src, hdrUrl: null });
    };
    reader.readAsDataURL(file);
  }

  private applyBackground(scene: SceneJSON) {
    const bg = scene.environment.background;
    if (bg.mode === "color") {
      // 纯色模式：用户选择什么颜色就是什么颜色，不附加渐变/地面/Fog，保持干净
      this.scene.background = new THREE.Color(bg.color[0], bg.color[1], bg.color[2]);
      this.scene.fog = null;
      // 半球光保持中性，不让地面色影响物体
      this.hemiLight.color.setRGB(0.35, 0.37, 0.4);
      this.hemiLight.groundColor.setRGB(0.12, 0.13, 0.15);
    } else if (bg.mode === "transparent") {
      this.scene.background = null;
      this.scene.fog = null;
    } else {
      // HDR 模式：背景即环境贴图
      this.scene.background = this.hdrEquirect;
      this.scene.fog = null;
    }
    this.renderer.setClearColor(0x000000, bg.mode === "transparent" ? 0 : 1);
  }

  // ============ 相机 ============
  applyCamera(cam: SceneJSON["camera"]) {
    this.camera.fov = cam.fov;
    this.camera.position.set(cam.position[0], cam.position[1], cam.position[2]);
    this.controls.target.set(cam.target[0], cam.target[1], cam.target[2]);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private syncCameraBack() {
    const st = useSceneStore.getState();
    st.updateCamera({
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      target: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
    });
  }

  private syncObjectBack(id: string) {
    const three = this.objectMap.get(id);
    if (!three) return;
    // 拖拽中静默更新 transform，不通知引擎（视觉已由 TransformControls 直接驱动），不记历史
    useSceneStore.getState().liveTransform(id, {
      position: [three.position.x, three.position.y, three.position.z],
      rotation: [
        THREE.MathUtils.radToDeg(three.rotation.x),
        THREE.MathUtils.radToDeg(three.rotation.y),
        THREE.MathUtils.radToDeg(three.rotation.z),
      ],
      scale: [three.scale.x, three.scale.y, three.scale.z],
    });
  }

  // ============ 交互 ============
  setGizmoMode(mode: "translate" | "rotate" | "scale" | "off", objectId?: string | null) {
    if (mode === "off" || !objectId) {
      this.gizmo.detach();
      return;
    }
    const three = this.objectMap.get(objectId);
    if (!three) return;
    this.gizmo.attach(three);
    this.gizmo.setMode(mode);
  }

  /** 屏幕坐标拾取：返回命中的 mrenderId（右键菜单用） */
  pickAt(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    _raycaster.setFromCamera(ndc, this.camera);
    // 仅对可见对象做射线检测，与左键选择保持一致，避免隐藏外部物件后仍无法选中内部物件
    const visibleRoots = Array.from(this.objectMap.values()).filter((o) => o.visible);
    const hits = _raycaster.intersectObjects(visibleRoots, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData.mrenderId) return o.userData.mrenderId as string;
        o = o.parent;
      }
    }
    return null;
  }

  setViewMode(mode: string) {
    const target = new THREE.Vector3(0, 120, 0);
    const dist = this.camera.position.distanceTo(this.controls.target);
    const pos = new THREE.Vector3();
    switch (mode) {
      case "前视": pos.set(0, 1.2, dist); break;
      case "后视": pos.set(0, 1.2, -dist); break;
      case "左视": pos.set(-dist, 1.2, 0); break;
      case "右视": pos.set(dist, 1.2, 0); break;
      case "顶视": pos.set(0, dist, 0); target.set(0, 0, 0); break;
      case "底视": pos.set(0, -dist, 0); target.set(0, 0, 0); break;
      case "透视": pos.set(0, 1.8, 6.5); break;
      case "查看全部": {
        const box = new THREE.Box3();
        // 只以用户导入/创建的对象为包围盒来源，排除引擎辅助体（网格/坐标轴/gizmo/地面等）
        for (const o of this.objectMap.values()) {
          box.expandByObject(o);
        }
        if (!box.isEmpty()) {
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3()).length();
          target.copy(center);
          pos.copy(center).add(new THREE.Vector3(0.6, 0.8, 1).normalize().multiplyScalar(size * 1.8));
        } else {
          pos.set(0, 1.8, 6.5);
        }
        break;
      }
      default: return;
    }
    this.camera.position.copy(pos);
    this.controls.target.copy(target);
    this.controls.update();
  }

  selectObject(objectId: string | null) {
    if (objectId && this.objectMap.has(objectId)) {
      this.gizmo.attach(this.objectMap.get(objectId)!);
    } else {
      this.gizmo.detach();
    }
  }

  /** 由外部 store 选中变化调用 */
  onSelectionChanged(objectId: string | null) {
    this.selectObject(objectId);
  }

  /** 切换灯光辅助体显示（默认关闭，避免灰色框遮挡画面） */
  setShowLightHelpers(v: boolean) {
    useSceneStore.getState().setShowLightHelpers(v);
    this.syncLights(useSceneStore.getState().scene.lights);
  }

  // ============ 选中高亮外轮廓（后处理 OutlinePass） ============
  /** 把当前选中对象的所有 Mesh 交给 OutlinePass，只描外部最大轮廓，不画内部细节 */
  private updateSelectionOutline(objectId: string | null) {
    const selected: THREE.Object3D[] = [];
    if (objectId) {
      const root = this.objectMap.get(objectId);
      if (root) {
        root.updateWorldMatrix(true, true);
        root.traverse((n) => {
          const mesh = n as THREE.Mesh;
          if (!mesh.isMesh) return;
          if (mesh.userData.isLabel || mesh.userData.isLightHelper || mesh.userData.isSelectionOutline) return;
          selected.push(mesh);
        });
      }
    }
    this.outlinePass.selectedObjects = selected;
  }

  /** 依据当前 store 选中状态刷新高亮（供 syncObjects 重建后调用） */
  private refreshSelectionOutline() {
    this.updateSelectionOutline(useSceneStore.getState().selectedObjectId);
  }

  /** 出图时临时隐藏/恢复高亮（成品图不应带选中描边） */
  private setOutlineVisible(v: boolean) {
    this.outlinePass.enabled = v;
  }

  setGridVisible(v: boolean) {
    this.grid.visible = v;
  }

  setAxesVisible(v: boolean) {
    this.axes.visible = v;
  }

  // ============ 白平衡 ============
  /**
   * 白平衡 → CSS filter 字符串。预览与导出共用同一份定义，
   * 保证"看到的 == 导出的"。中性（6500K 附近）返回空串表示无需处理。
   */
  private whiteBalanceFilter(kelvin: number): string {
    const delta = kelvin - 6500;
    if (Math.abs(delta) < 100) return "";
    if (delta < 0) {
      // 暖色：偏红黄
      const intensity = Math.min(1, Math.abs(delta) / 3500);
      return `sepia(${(intensity * 0.25).toFixed(3)}) saturate(${(1 + intensity * 0.15).toFixed(3)})`;
    }
    // 冷色：偏蓝
    const intensity = Math.min(1, delta / 2500);
    return `hue-rotate(${(intensity * 20).toFixed(1)}deg) brightness(${(1 + intensity * 0.03).toFixed(3)})`;
  }

  private applyWhiteBalance(kelvin: number) {
    this.renderer.domElement.style.filter = this.whiteBalanceFilter(kelvin);
  }

  /**
   * 把白平衡真实烘焙进导出图像素。
   * 预览用的是 canvas 上的 CSS filter，而 toDataURL 取的是画布原始像素、
   * 不含 CSS 滤镜 —— 必须在这里补上，否则导出图与预览不一致。
   */
  private async bakeWhiteBalance(url: string, mimeType: string): Promise<string> {
    const kelvin = useSceneStore.getState().scene?.camera?.whiteBalance ?? 6500;
    const filter = this.whiteBalanceFilter(kelvin);
    if (!filter) return url;
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image decode failed"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return url;
      ctx.filter = filter;
      ctx.drawImage(img, 0, 0);
      ctx.filter = "none";
      return canvas.toDataURL(mimeType);
    } catch {
      return url; // 烘焙失败不应阻塞导出，退回原图
    }
  }

  // ============ 出图 ============
  /** 路径追踪出图（真实折射/反射/软阴影/焦散，对标 KeyShot Path Tracing） */
  async renderPathTrace(
    resolution: [number, number],
    samples: number,
    bounces: number,
    keepResult = false
  ): Promise<string> {
    const [w, h] = resolution;
    const oldAspect = this.camera.aspect;
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const st = useSceneStore.getState().scene;
    const imageFormat = st.render.format || "png";
    const mimeType = imageFormat === "jpeg" ? "image/jpeg" : "image/png";
    this.renderingPath = true;
    // 隐藏非路径追踪友好的辅助对象（网格/坐标轴/灯光辅助体/标签/描边）。
    // 注意：地面 floorMesh 必须保留——路径追踪靠物理遮挡自然产生接触阴影，
    // 隐藏它瓶子会再次“悬空”；背景渐变也保留（color 模式下即影棚渐变）。
    // ShadowMaterial 接影面在路径追踪中无效，这里强制使用实体地面。
    const oldFloorVisible = this.floorMesh.visible;
    const oldCatcherVisible = this.shadowCatcher.visible;
    this.floorMesh.visible = true;
    this.shadowCatcher.visible = false;
    this.pathTraceHidden = [];
    this.scene.traverse((o) => {
      if (
        o === this.grid || o === this.axes ||
        o.userData.isLightHelper || o.userData.isLabel || o.userData.isSelectionOutline
      ) {
        if (o.visible) {
          o.visible = false;
          this.pathTraceHidden.push(o);
        }
      }
    });
    const oldBg = this.scene.background;
    const oldEnv = this.scene.environment;
    // 路径追踪器需要原始 equirect HDR，PMREM 立方体贴图无法被它解析
    if (this.hdrEquirectRaw) {
      this.scene.environment = this.hdrEquirectRaw;
      if (st.environment.background.mode === "hdr") {
        this.scene.background = this.hdrEquirectRaw;
      }
    }
    let url = "";
    let oldShadowCast = this.shadowLight.castShadow;
    let oldShadowInt = this.shadowLight.intensity;
    try {
      const pt = new WebGLPathTracer(this.renderer);
      pt.bounces = Math.max(1, Math.min(32, bounces));
      pt.multipleImportanceSampling = true;
      pt.renderToCanvas = true;
      // KeyShot 式：最终出图以环境(HDR)为唯一光源，接触阴影由 GI 从环境追踪得到。
      // 关掉固定阴影灯的投影并降低其强度，避免盖过环境带来的自然阴影。
      oldShadowCast = this.shadowLight.castShadow;
      oldShadowInt = this.shadowLight.intensity;
      this.shadowLight.castShadow = false;
      this.shadowLight.intensity = 0.4;
      // three-gpu-pathtracer 的 StaticGeometryGenerator 要求所有可见网格的 color 属性
      // itemSize 一致（它给缺色网格补的是 RGBA=itemSize 4）。cyclorama 等本项目网格用
      // RGB(itemSize 3) 顶点色，会导致 mergeGeometries 缓冲溢出 (RangeError)。这里临时把
      // itemSize!=4 的 color 提升为 RGBA，setScene 已将其烘焙进 path tracer 后立刻还原。
      const colorBackup: { mesh: THREE.Mesh; attr: THREE.BufferAttribute }[] = [];
      this.scene.traverseVisible((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry;
        const c = g.getAttribute("color") as THREE.BufferAttribute | undefined;
        if (c && c.isBufferAttribute && c.itemSize !== 4) {
          const rgba = new THREE.BufferAttribute(new Float32Array(c.count * 4), 4);
          for (let i = 0; i < c.count; i++) {
            rgba.setXYZW(i, c.getX(i), c.getY(i), c.getZ(i), c.getW(i) || 1);
          }
          rgba.needsUpdate = true;
          colorBackup.push({ mesh: o as THREE.Mesh, attr: c });
          g.setAttribute("color", rgba);
        }
      });
      pt.setScene(this.scene, this.camera);
      for (const b of colorBackup) b.mesh.geometry.setAttribute("color", b.attr);
      colorBackup.length = 0;
      // setScene 已把环境信息拷入 path tracer，可恢复场景原环境
      this.scene.environment = oldEnv;
      await new Promise<void>((resolve) => {
        let iters = 0;
        const maxIters = Math.max(samples * 2, 256);
        const tick = () => {
          try {
            pt.renderSample();
          } catch (e) {
            console.error("路径追踪采样失败", e);
            resolve();
            return;
          }
          iters++;
          if (pt.samples >= samples || iters >= maxIters) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        tick();
      });
      url = await this.bakeWhiteBalance(this.renderer.domElement.toDataURL(mimeType), mimeType);
      try { pt.dispose(); } catch { /* three-gpu-pathtracer 0.0.22 dispose 偶发空引用，忽略 */ }
    } catch (e) {
      console.error("路径追踪初始化失败，回退光栅化", e);
      this.composer.render();
      url = await this.bakeWhiteBalance(this.renderer.domElement.toDataURL(mimeType), mimeType);
    } finally {
      this.shadowLight.castShadow = oldShadowCast;
      this.shadowLight.intensity = oldShadowInt;
      this.renderingPath = false;
      if (!keepResult) {
        for (const o of this.pathTraceHidden) o.visible = true;
        this.pathTraceHidden = [];
        this.floorMesh.visible = oldFloorVisible;
        this.shadowCatcher.visible = oldCatcherVisible;
        this.scene.environment = oldEnv;
        this.scene.background = oldBg;
        this.camera.aspect = oldAspect;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(this.devicePixelRatio());
        this.renderer.setSize(this.baseWidth, this.baseHeight, false);
        this.composer.setSize(this.baseWidth, this.baseHeight);
        this.composer.render();
      }
    }
    return url;
  }

  /** 路径追踪出图后恢复实时预览画布（供脚本截图后调用） */
  restoreRasterPreview() {
    const st = useSceneStore.getState().scene;
    for (const o of this.pathTraceHidden) o.visible = true;
    this.pathTraceHidden = [];
    this.applyEnvironment(st.environment);
    this.camera.aspect = this.baseWidth / this.baseHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.devicePixelRatio());
    this.renderer.setSize(this.baseWidth, this.baseHeight, false);
    this.composer.setSize(this.baseWidth, this.baseHeight);
    this.applyBackground(st as unknown as SceneJSON);
    this.composer.render();
  }

  async exportPNG(resolution: [number, number], alpha: boolean, name = "MRender 渲染") {
    const st = useSceneStore.getState().scene;
    const [w, h] = resolution;

    const imageFormat = st.render.format || "png";
    const ext = imageFormat === "jpeg" ? "jpg" : "png";

    // 路径追踪模式：走物理光线追踪
    if (st.render.mode === "pathtrace") {
      const url = await this.renderPathTrace(
        [w, h],
        Math.max(16, Math.min(2048, st.render.samples)),
        Math.max(1, Math.min(32, st.render.bounces ?? 8))
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.${ext}`;
      a.click();
      return url;
    }

    // 光栅化模式：原有实时渲染流程
    const oldAspect = this.camera.aspect;
    const mimeType = imageFormat === "jpeg" ? "image/jpeg" : "image/png";
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const oldBg = this.scene.background;
    if (alpha) this.scene.background = null;
    this.renderer.setClearColor(0x000000, alpha ? 0 : 1);
    this.setOutlineVisible(false); // 成品图不带选中描边
    const oldGrid = this.grid.visible;
    const oldAxes = this.axes.visible;
    this.grid.visible = false; // 出图不带网格
    this.axes.visible = false; // 出图不带坐标轴
    this.composer.render();
    const url = await this.bakeWhiteBalance(this.renderer.domElement.toDataURL(mimeType), mimeType);
    // 恢复
    this.setOutlineVisible(true);
    this.grid.visible = oldGrid;
    this.axes.visible = oldAxes;
    this.scene.background = oldBg;
    this.camera.aspect = oldAspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.devicePixelRatio());
    this.renderer.setSize(this.baseWidth, this.baseHeight, false);
    this.composer.setSize(this.baseWidth, this.baseHeight);
    this.composer.render();
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.${ext}`;
    a.click();
    return url;
  }

  /** 获取当前帧数据（供渲染预览/后续路径追踪接入） */
  snapshotDataURL(): string {
    return this.renderer.domElement.toDataURL("image/png");
  }

  getSceneStats(): { triangles: number; vertices: number; drawCalls: number } {
    let triangles = 0;
    let vertices = 0;
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry && !mesh.userData.isSelectionOutline) {
        const pos = mesh.geometry.getAttribute("position");
        if (pos) vertices += pos.count;
        const idx = mesh.geometry.getIndex();
        if (idx) triangles += idx.count / 3;
      }
    });
    return { triangles: Math.round(triangles), vertices, drawCalls: this.renderer.info.render.calls };
  }

  /** 调试/验收：返回每个对象的世界包围盒尺寸与中心（验证打散是否保持原位、未归一化变形） */
  debugBoxes(): { id: string; size: [number, number, number]; center: [number, number, number] }[] {
    const out: { id: string; size: [number, number, number]; center: [number, number, number] }[] = [];
    for (const [id, three] of this.objectMap) {
      three.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(three);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      out.push({ id, size: [size.x, size.y, size.z], center: [center.x, center.y, center.z] });
    }
    return out;
  }

  // ============ 渲染循环 ============
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    // 路径追踪出图进行中：暂停主循环渲染，把画布交给路径追踪器累积采样
    if (this.renderingPath) return;
    const dt = this.clock.getDelta();
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fpsValue = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
      const st = useSceneStore.getState();
      const stat = this.getSceneStats();
      st.setStats({ fps: this.fpsValue, ...stat });
      // —— 自动回退：GPU 模式下 FPS 持续过低 → 判定 GPU 过载，切回 CPU 兼容模式 ——
      if (this.deviceMode === "gpu" && this.autoFallbackArmed && st.scene.render.autoFallback) {
        if (this.fpsValue < 15) {
          this.lowFpsSamples++;
          if (this.lowFpsSamples >= 4) {
            // 约 2 秒（每 0.5s 采样一次）持续卡顿，触发一次回退
            this.autoFallbackArmed = false;
            this.lowFpsSamples = 0;
            st.updateRender({ device: "cpu" }); // 经 store → syncScene → applyDeviceMode("cpu")
            this.cb.onStatus?.("⚠ GPU 负载过高，已自动切换到 CPU 兼容模式（画质降低但更流畅）");
          }
        } else {
          this.lowFpsSamples = 0;
        }
      }
    }
    this.controls.update();
    this.composer.render();
  };

  onResize() {
    if (!this.container) return;
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    this.baseWidth = w;
    this.baseHeight = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.controls.dispose();
    this.gizmo.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

/**
 * 打散/烘焙单个 Mesh 为「独立部件」（模块级函数，供 ungroupObject 与 addModelFromFile 共用）：
 * 把世界矩阵烘焙进几何体，再把几何体重心平移到局部原点、并把对象位置设为该重心。
 * 效果：部件仍保持在原世界位置（不散落、不变形），但对象原点 = 部件重心 →
 * Gizmo 与变换轴心落在物件正中央（满足「坐标轴在物件中间」）。
 */
function bakePart(mesh: THREE.Mesh): THREE.Mesh {
  const clone = mesh.clone(true);
  clone.geometry = mesh.geometry.clone();
  clone.geometry.applyMatrix4(mesh.matrixWorld);
  clone.position.set(0, 0, 0);
  clone.quaternion.set(0, 0, 0, 1);
  clone.scale.set(1, 1, 1);
  clone.updateMatrixWorld(true);
  // 合并重复顶点并重新计算平滑法线，解决 STL/PLY/导入模型表面块面问题
  if (clone.geometry.index || clone.geometry.getAttribute("position")) {
    try {
      clone.geometry = mergeVertices(clone.geometry, 1e-4);
    } catch {
      // 部分程序化几何体无索引，跳过
    }
    clone.geometry.computeVertexNormals();
  }
  const box = new THREE.Box3().setFromObject(clone);
  const center = box.getCenter(new THREE.Vector3());
  clone.geometry.translate(-center.x, -center.y, -center.z);
  clone.position.copy(center);
  clone.updateMatrixWorld(true);
  return clone;
}

/** 安全统计三角面/顶点数（导出子部件时估算） */
function countTrianglesSafe(root: THREE.Object3D): { triangles: number; vertices: number } {
  let triangles = 0;
  let vertices = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const g = mesh.geometry;
      const pos = g.getAttribute("position");
      if (pos) vertices += pos.count;
      const idx = g.getIndex();
      triangles += idx ? idx.count / 3 : pos.count / 3;
    }
  });
  return { triangles: Math.round(triangles), vertices };
}

/** 导入模型文件入口（UI 拖拽/选择调用），结果加入场景数据 */
export async function addModelFromFile(file: File, onStatus?: (msg: string) => void, opts?: { explode?: boolean }) {
  const result = await importModelFile(file);
  const reader = new FileReader();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const baseName = result.object.name || file.name.replace(/\.[^.]+$/, "");

  // 打散模式：递归收集所有 Mesh，各自导出为独立 GLB 对象（无名自动命名）
  if (opts?.explode) {
    const meshes = collectMeshes(result.object);
    if (meshes.length >= 2) {
      result.object.updateWorldMatrix(true, true);
      const parts: SceneObjectData[] = [];
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i];
        // 烘焙为独立部件（重心归原点 + 对象位置=重心 → 轴心在物件中央）
        const clone = bakePart(mesh);
        // 直接序列化烘焙后的几何体（不走 GLTFExporter，避免大量网格串行导出 OOM/崩溃）
        const partUrl = bakeGeometryToDataURL(clone.geometry);
        getEngine()?.precacheModel(partUrl, clone);
        const stat = countTrianglesSafe(clone);
        const id = `obj_${Date.now().toString(36)}_e${i}`;
        parts.push({
          id, name: `${baseName} / ${mesh.name || `Part_${i + 1}`}`, type: "mesh",
          source: partUrl, sourceFormat: "mrender-geom",
          transform: { position: [clone.position.x, clone.position.y, clone.position.z], rotation: [0, 0, 0], scale: [1, 1, 1] },
          materialId: DEFAULT_IMPORTED_MATERIAL, visible: true, preTransformed: true,
          stats: { triangles: stat.triangles, vertices: stat.vertices },
        });
        if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
      }
      const store = useSceneStore.getState();
      const finalObjs = store.scene.objects.concat(parts);
      store.replaceObjects(finalObjs, parts[0]?.id);
      onStatus?.(`已导入 ${file.name}（打散为 ${parts.length} 个部件）`);
      return parts[0].id;
    }
    // 可拆分部件不足 2 个：退化为整体导入（仍提示）
    onStatus?.(`${file.name} 无可拆分部件，已整体导入`);
  }

  // 默认模式：整体作为一个对象；未指定材质时自动给默认白塑料，避免导入后呈现灰色/无材质
  const id = `obj_${Date.now().toString(36)}`;
  const box = new THREE.Box3().setFromObject(result.object);
  const halfH = box.getSize(new THREE.Vector3()).y / 2;
  const fileExt = extOf(file.name);
  // 关键修复：直接把已解析的 three 对象缓存起来，避免 hydrateDataUrl 再从 44MB+ 的
  // dataURL 重新解析（大模型重新解析会丢失主体网格，只剩注释/地面等垃圾几何 → 导入后“看不到”）。
  getEngine()?.precacheModel(dataUrl, result.object);
  useSceneStore.getState().addObject({
    id, name: baseName, type: "group", source: dataUrl,
    sourceFormat: fileExt,
    transform: { position: [0, halfH, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    materialId: DEFAULT_IMPORTED_MATERIAL, visible: true,
    stats: { triangles: result.triangles, vertices: result.vertices },
  });
  onStatus?.(`已导入 ${file.name} — ${result.triangles.toLocaleString()} 三角形`);
  return id;
}
