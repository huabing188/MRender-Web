// 模型导入：OBJ / GLTF / GLB / STL / PLY / FBX / 3DM
// 全部使用 three.js 官方 Loader + McNeel 官方 Rhino3dmLoader，零自研解析
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { Rhino3dmLoader } from "three/examples/jsm/loaders/3DMLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SimplifyModifier } from "three/examples/jsm/modifiers/SimplifyModifier.js";

export const SUPPORTED_FORMATS = ["obj", "gltf", "glb", "stl", "ply", "fbx", "3dm"] as const;
export const SUPPORTED_LABEL =
  ".obj, .gltf, .glb, .stl, .ply, .fbx, .3dm (Rhino)";

/**
 * 把一个 three 对象导出为 GLB 的 data URL（供「打散」后生成完全独立的子部件模型）。
 * GLTFExporter 是 three 官方自带，零自研。
 */
export function exportToGLB(object: THREE.Object3D): Promise<string> {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      object,
      (result) => {
        const blob = new Blob([result as ArrayBuffer], { type: "model/gltf-binary" });
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      },
      (err) => reject(err),
      { binary: true }
    );
  });
}

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

export interface ImportResult {
  object: THREE.Object3D;
  triangles: number;
  vertices: number;
  fileName: string;
  format: string;
}

/** rhino3dm wasm 资源路径（本地 vendor，已随 npm 包拷贝到 public/vendor/rhino3dm/） */
const RHINO_LIB_PATH = "/vendor/rhino3dm/";

let rhinoLoader: Rhino3dmLoader | null = null;
function getRhinoLoader(): Rhino3dmLoader {
  if (!rhinoLoader) {
    rhinoLoader = new Rhino3dmLoader();
    rhinoLoader.setLibraryPath(RHINO_LIB_PATH);
    rhinoLoader.setWorkerLimit(2);
  }
  return rhinoLoader;
}

function countTriangles(root: THREE.Object3D): { triangles: number; vertices: number } {
  let triangles = 0;
  let vertices = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const g = mesh.geometry;
      const pos = g.getAttribute("position");
      if (pos) vertices += pos.count;
      const idx = g.getIndex();
      if (idx) triangles += idx.count / 3;
      else triangles += pos.count / 3;
    }
  });
  return { triangles: Math.round(triangles), vertices };
}

function smoothGeometry(geometry: THREE.BufferGeometry) {
  try {
    geometry = mergeVertices(geometry, 1e-4);
  } catch {
    // 忽略：部分几何体本身无索引或已合并
  }
  geometry.computeVertexNormals();
  return geometry;
}

// 自动减面阈值：当前关闭，因为 three.js SimplifyModifier 在 SwiftShader 浏览器端处理 300k+ 三角面
// 容易内存/耗时爆炸；等接入更稳妥的 Node 端减面后再开启。保留代码结构便于后续启用。
const DECIMATE_MAX_TRI = 9_999_999;
const DECIMATE_TARGET_TRI = 35_000;

function decimateGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = geometry.getIndex();
  const triCount = idx ? idx.count / 3 : geometry.getAttribute("position").count / 3;
  if (triCount <= DECIMATE_MAX_TRI) return geometry;
  const targetTri = Math.max(6_000, Math.min(DECIMATE_TARGET_TRI, triCount * 0.35));
  // SimplifyModifier 的 count 是要移除的顶点数；输出为非索引几何体，顶点数≈3×目标三角形数
  const targetVerts = Math.floor(targetTri * 3);
  const currentVerts = geometry.getAttribute("position").count;
  const remove = Math.max(0, currentVerts - targetVerts);
  if (remove <= 0) return geometry;
  try {
    const modifier = new SimplifyModifier();
    let simplified = modifier.modify(geometry, Math.floor(remove));
    // 重新焊接顶点并平滑法线，减面后块面感更小
    try { simplified = mergeVertices(simplified, 1e-4); } catch { /* ignore */ }
    simplified.computeVertexNormals();
    return simplified;
  } catch (e) {
    console.warn("减面失败，保留原网格:", e);
    return geometry;
  }
}

function normalizeObject(root: THREE.Object3D, opts?: { unitScale?: number }): THREE.Object3D {
  // 计算包围盒并居中（保持原始尺寸比例），MRender 内部单位 = mm
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.translate(-center.x, -center.y, -center.z);
      // 合并重复顶点 + 平滑法线，消除 STL/PLY/OBJ 导入后的块面感
      obj.geometry = smoothGeometry(obj.geometry);
      // 自动减面：单网格三角形数过高时降到安全范围，避免 SwiftShader/路径追踪 OOM
      obj.geometry = decimateGeometry(obj.geometry);
    }
  });
  // 格式特定单位换算：glTF/glb 规范默认单位为米，需 ×1000 转为 mm
  const unitScale = opts?.unitScale ?? 1;
  if (unitScale !== 1) root.scale.set(unitScale, unitScale, unitScale);
  root.updateMatrixWorld(true);
  return root;
}

/**
 * 清理 Rhino 导入里的「非渲染几何」：注释文字、尺寸标注、灯光、裁剪平面、
 * 视口坐标轴 gizmo、点/线/精灵，以及被 Loader 误生成的超大地面/包围盒平面。
 * 这些对象的 userData.objectType 不在可渲染实体集合内，或本身就是 Points/Line/Sprite。
 * 否则它们会撑爆包围盒（相机被埋进巨型地面里 → 看起来「导入后什么都没有」）。
 */
const RENDERABLE_RHINO = new Set(["Brep", "Extrusion", "SubD", "Mesh", "Surface", "InstanceReference"]);
function pruneRhinoAnnotations(root: THREE.Object3D): THREE.Object3D {
  const toRemove: THREE.Object3D[] = [];
  let seen = 0, removed = 0;
  root.traverse((o) => {
    const ot = (o.userData && o.userData.objectType) as string | undefined;
    const isPoints = (o as THREE.Points).isPoints === true;
    const isLine = (o as THREE.Line).isLine === true || (o as THREE.LineSegments).isLineSegments === true;
    const isSprite = (o as THREE.Sprite).isSprite === true;
    if (isPoints || isLine || isSprite) { toRemove.push(o); removed++; return; }
    // 只保留可渲染实体（Brep/Extrusion/Mesh/Surface/InstanceReference）；
    // 其余（注释/标注/灯光/坐标轴 gizmo/点线精灵/未打标签的垃圾几何）一律剔除。
    if ((o as THREE.Mesh).isMesh && (!ot || !RENDERABLE_RHINO.has(ot))) { toRemove.push(o); removed++; }
    seen++;
  });
  for (const o of toRemove) {
    o.parent?.remove(o);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh && m.geometry) m.geometry.dispose();
    });
  }
  return root;
}

/** 统一导入入口：传入 File 对象，返回 three 对象 */
export function importModelFile(
  file: File,
  opts?: { normalize?: boolean }
): Promise<ImportResult> {
  const ext = extOf(file.name);
  const arrayBuffer = file.arrayBuffer();
  const doNormalize = opts?.normalize !== false;

  const wrap = (promise: Promise<THREE.Object3D>, format: string, normOpts?: { unitScale?: number }): Promise<ImportResult> =>
    promise.then((object) => {
      // 打散后的子部件已烘焙世界坐标（preTransformed），绝不能再次归一化/居中，
      // 否则每个零件都被拉伸到统一尺寸并错位 → 变形。
      if (doNormalize) normalizeObject(object, normOpts);
      object.name = file.name.replace(/\.[^.]+$/, "");
      const stat = countTriangles(object);
      return { object, ...stat, fileName: file.name, format };
    });

  switch (ext) {
    case "gltf":
    case "glb": {
      const loader = new GLTFLoader();
      return wrap(arrayBuffer.then(async (buf) => {
        const gltf = await loader.parseAsync(buf, "");
        return gltf.scene;
      }), ext === "glb" ? "glb" : "gltf", { unitScale: 1000 });
    }
    case "obj": {
      const loader = new OBJLoader();
      return wrap(arrayBuffer.then((buf) => loader.parse(new TextDecoder().decode(buf))), "obj");
    }
    case "stl": {
      const loader = new STLLoader();
      return wrap(arrayBuffer.then((buf) => {
        const geom = loader.parse(buf);
        const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 }));
        return mesh;
      }), "stl");
    }
    case "ply": {
      const loader = new PLYLoader();
      return wrap(arrayBuffer.then((buf) => {
        const geom = loader.parse(buf);
        const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 }));
        return mesh;
      }), "ply");
    }
    case "fbx": {
      const loader = new FBXLoader();
      return wrap(arrayBuffer.then((buf) => loader.parse(buf, "")), "fbx");
    }
    case "3dm": {
      // McNeel 官方 Rhino3dmLoader（OpenNURBS wasm，Brep/Extrusion/SubD 转 mesh）
      // Rhino 文件单位通常为 mm，Loader 会按文件单位保留几何（mm），无需额外缩放；
      // 解析后立即剔除注释/标注/灯光/坐标轴 gizmo/超大地面等非渲染几何。
      const loader = getRhinoLoader();
      return wrap(
        arrayBuffer.then(
          (buf) =>
            new Promise<THREE.Object3D>((resolve, reject) => {
              loader.parse(
                buf,
                (obj) => resolve(pruneRhinoAnnotations(obj)),
                (err) => reject(err)
              );
            })
        ),
        "3dm",
        { unitScale: 1 }
      );
    }
    default:
      return Promise.reject(new Error(`不支持的格式: ${ext || "(无扩展名)"}`));
  }
}
