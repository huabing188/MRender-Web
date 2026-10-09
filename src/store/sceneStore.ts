// Zustand 全局状态：场景数据 + UI 状态 + 动作总线（AI 与 UI 共用）+ 撤销/重做
import { create } from "zustand";
import type { SceneJSON, MaterialData, LightData, SceneObjectData, LabelData, Vec3, CustomEnvironmentData, TextureAsset, LightPinData } from "../core/types";
import { createDefaultScene, createEmptyScene } from "../core/defaultScene";
import type { SceneAction } from "../ai/provider";

let uidCounter = 1000;
export function nextUid(prefix = "obj"): string {
  uidCounter += 1;
  return `${prefix}_${uidCounter}`;
}

type TabId = "scene" | "material" | "environment" | "light" | "camera" | "image";
type LibraryTabId = "materials" | "colors" | "textures" | "environments" | "backgrounds" | "favorites" | "models";
type GizmoMode = "translate" | "rotate" | "scale" | "off";

const MAX_HISTORY = 60;

interface SceneStore {
  scene: SceneJSON;
  selectedObjectId: string | null;
  selectedMaterialId: string | null;
  activeTab: TabId;
  libraryTab: LibraryTabId;
  gizmoMode: GizmoMode;
  showStats: boolean;
  viewMode: string;
  statusMessage: string;
  stats: { fps: number; triangles: number; vertices: number; drawCalls: number } | null;
  /** 是否检测到 GPU 硬件加速（false = 当前为软件渲染，GPU 按钮应禁用） */
  gpuAvailable: boolean;
  setGpuAvailable: (v: boolean) => void;
  /** 是否显示灯光辅助体（默认关闭，避免遮挡画面） */
  showLightHelpers: boolean;
  setShowLightHelpers: (v: boolean) => void;

  // 撤销/重做
  undoStack: SceneJSON[];
  redoStack: SceneJSON[];
  undo: () => void;
  redo: () => void;
  /** 拖拽开始：压入当前场景作为历史快照（仅一次） */
  beginTransform: () => void;
  /** 拖拽过程：仅更新 transform 数值，不通知引擎、不记历史（避免每帧全量同步卡顿） */
  liveTransform: (id: string, transform: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }) => void;
  /** 拖拽结束：通知引擎重新同步一次 */
  commitTransform: () => void;
  /** 批量替换对象列表并记一步历史（打散/合并用，避免每个子部件各记一步） */
  replaceObjects: (objs: SceneObjectData[], selectId?: string | null) => void;
  /** 把多个对象组合成一个 Group（撤销一步完成）；ids 为要组合的对象 ID */
  groupObjects: (ids: string[]) => void;

  // --- 动作总线：UI 与 AI 共用入口 ---
  dispatch: (action: SceneAction) => void;

  // --- UI 状态 ---
  setActiveTab: (t: TabId) => void;
  setLibraryTab: (t: LibraryTabId) => void;
  setGizmoMode: (m: GizmoMode) => void;
  setShowStats: (v: boolean) => void;
  selectObject: (id: string | null) => void;
  selectMaterial: (id: string | null) => void;
  setStatus: (msg: string) => void;
  setViewMode: (v: string) => void;
  setStats: (s: SceneStore["stats"]) => void;

  // --- 场景数据操作（内部供 dispatch 与 UI 组件调用）---
  updateMaterial: (id: string, patch: Partial<MaterialData>) => void;
  assignMaterial: (objectId: string, materialId: string | null) => void;
  addObject: (obj: SceneObjectData) => void;
  removeObject: (id: string) => void;
  updateObject: (id: string, patch: Partial<SceneObjectData>) => void;
  addLight: (light: LightData) => void;
  removeLight: (id: string) => void;
  updateLight: (id: string, patch: Partial<LightData>) => void;
  updateEnvironment: (patch: Partial<SceneJSON["environment"]>) => void;
  addCustomEnvironment: (env: CustomEnvironmentData) => void;
  removeCustomEnvironment: (id: string) => void;
  /** 导入 KeyShot 材质库（.kmp 解析结果）：批量写入材质 + 关联纹理 */
  importKeyShot: (materials: MaterialData[], textures: TextureAsset[]) => void;
  updateCamera: (patch: Partial<SceneJSON["camera"]>) => void;
  updateRender: (patch: Partial<SceneJSON["render"]>) => void;
  // —— KeyShot 式灯光针（环境球上的可调光源）——
  addLightPin: (pin: LightPinData) => void;
  updateLightPin: (id: string, patch: Partial<LightPinData>) => void;
  removeLightPin: (id: string) => void;
  loadScene: (scene: SceneJSON) => void;
  resetScene: () => void;
  newScene: () => void;
  addLabel: (objectId: string, label: LabelData) => void;
  updateLabel: (objectId: string, labelId: string, patch: Partial<LabelData>) => void;
  removeLabel: (objectId: string, labelId: string) => void;
}

/** 事件桥：引擎层监听数据变更（引擎不直接 import store 以避免循环依赖） */
type Listener = (scene: SceneJSON) => void;
const listeners = new Set<Listener>();
export function onSceneChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(scene: SceneJSON) {
  listeners.forEach((fn) => fn(scene));
}

/** 生成历史快照（push 当前 scene 到 undoStack，清空 redoStack） */
function hist(st: SceneStore): Pick<SceneStore, "undoStack" | "redoStack"> {
  return {
    undoStack: [...st.undoStack, st.scene].slice(-MAX_HISTORY),
    redoStack: [],
  };
}

export const useSceneStore = create<SceneStore>((set, get) => ({
  scene: createDefaultScene(),
  selectedObjectId: null,
  selectedMaterialId: null,
  activeTab: "scene",
  libraryTab: "materials",
  gizmoMode: "off",
  showStats: true,
  viewMode: "透视",
  statusMessage: "就绪 — 拖入 OBJ/GLTF/GLB/STL/PLY/FBX/3DM 模型开始",
  stats: null,
  gpuAvailable: true,
  showLightHelpers: false,
  undoStack: [],
  redoStack: [],

  undo: () => {
    set((st) => {
      if (st.undoStack.length === 0) return {};
      const prev = st.undoStack[st.undoStack.length - 1];
      const undoStack = st.undoStack.slice(0, -1);
      const redoStack = [...st.redoStack, st.scene].slice(-MAX_HISTORY);
      notify(prev);
      return { scene: prev, undoStack, redoStack };
    });
  },

  redo: () => {
    set((st) => {
      if (st.redoStack.length === 0) return {};
      const next = st.redoStack[st.redoStack.length - 1];
      const redoStack = st.redoStack.slice(0, -1);
      const undoStack = [...st.undoStack, st.scene].slice(-MAX_HISTORY);
      notify(next);
      return { scene: next, undoStack, redoStack };
    });
  },

  beginTransform: () => set((st) => ({
    undoStack: [...st.undoStack, st.scene].slice(-MAX_HISTORY),
    redoStack: [],
  })),
  liveTransform: (id, transform) => set((st) => ({
    scene: {
      ...st.scene,
      objects: st.scene.objects.map((o) => (o.id === id ? { ...o, transform } : o)),
    },
  })),
  commitTransform: () => {
    const s = get();
    notify(s.scene);
  },
  replaceObjects: (objs, selectId) => set((st) => {
    const scene = { ...st.scene, objects: objs };
    notify(scene);
    return { scene, selectedObjectId: selectId ?? st.selectedObjectId, ...hist(st) };
  }),
  groupObjects: (ids) => set((st) => {
    const members = st.scene.objects.filter((o) => ids.includes(o.id));
    if (members.length < 2) return {};
    const center: Vec3 = [0, 0, 0];
    for (const m of members) {
      center[0] += m.transform.position[0];
      center[1] += m.transform.position[1];
      center[2] += m.transform.position[2];
    }
    const n = members.length;
    center[0] /= n; center[1] /= n; center[2] /= n;
    const children: SceneObjectData[] = members.map((m) => ({
      ...m,
      transform: {
        ...m.transform,
        position: [
          m.transform.position[0] - center[0],
          m.transform.position[1] - center[1],
          m.transform.position[2] - center[2],
        ],
      },
    }));
    const groupName = members[0].name.split(" / ")[0] || "群组";
    const group: SceneObjectData = {
      id: nextUid("grp"),
      name: groupName,
      type: "group",
      source: null,
      materialId: null,
      transform: { position: center, rotation: [0, 0, 0], scale: [1, 1, 1] },
      children,
      visible: true,
    };
    const scene = {
      ...st.scene,
      objects: st.scene.objects.filter((o) => !ids.includes(o.id)).concat(group),
    };
    notify(scene);
    return { scene, selectedObjectId: group.id, ...hist(st) };
  }),

  dispatch: (action) => {
    const s = get();
    switch (action.type) {
      case "setMaterialProperty": {
        const mat = s.scene.materials[action.materialId];
        if (!mat) return;
        s.updateMaterial(action.materialId, { [action.property]: action.value } as Partial<MaterialData>);
        break;
      }
      case "assignMaterial":
        s.assignMaterial(action.objectId, action.materialId);
        break;
      case "addLight":
        s.addLight(action.light as unknown as LightData);
        break;
      case "setLightProperty": {
        const l = s.scene.lights.find((x) => x.id === action.lightId);
        if (!l) return;
        s.updateLight(action.lightId, { [action.property]: action.value } as Partial<LightData>);
        break;
      }
      case "setEnvironment":
        s.updateEnvironment(action.env as Partial<SceneJSON["environment"]>);
        break;
      case "setCamera":
        s.updateCamera(action.camera as Partial<SceneJSON["camera"]>);
        break;
      case "setRenderSetting":
        s.updateRender({ [action.key]: action.value } as Partial<SceneJSON["render"]>);
        break;
      case "addLightPin":
        s.addLightPin(action.pin as unknown as LightPinData);
        break;
      case "updateLightPin": {
        const p = s.scene.lightPins.find((x) => x.id === action.pinId);
        if (!p) return;
        s.updateLightPin(action.pinId, { [action.property]: action.value } as Partial<LightPinData>);
        break;
      }
      case "removeLightPin":
        s.removeLightPin(action.pinId);
        break;
      case "transformObject": {
        const obj = s.scene.objects.find((o) => o.id === action.objectId);
        if (!obj) return;
        const t = obj.transform;
        const patch: Partial<SceneObjectData> = {};
        const tr = action.transform as { position?: number[]; rotation?: number[]; scale?: number[] };
        if (tr.position) patch.transform = { ...t, position: tr.position as [number, number, number] };
        if (tr.rotation) patch.transform = { ...t, rotation: tr.rotation as [number, number, number] };
        if (tr.scale) patch.transform = { ...t, scale: tr.scale as [number, number, number] };
        s.updateObject(action.objectId, patch);
        break;
      }
      case "selectObject":
        s.selectObject(action.objectId);
        break;
    }
  },

  setActiveTab: (t) => set({ activeTab: t }),
  setLibraryTab: (t) => set({ libraryTab: t }),
  setGizmoMode: (m) => set({ gizmoMode: m }),
  setShowStats: (v) => set({ showStats: v }),
  selectObject: (id) => set((s) => ({ 
    selectedObjectId: id, 
    selectedMaterialId: null,
    gizmoMode: id ? (s.gizmoMode === "off" ? "translate" : s.gizmoMode) : "off",
  })),
  selectMaterial: (id) => set({ selectedMaterialId: id }),
  setStatus: (msg) => set({ statusMessage: msg }),
  setViewMode: (v) => set({ viewMode: v }),
  setStats: (st) => set({ stats: st }),
  setGpuAvailable: (v) => set({ gpuAvailable: v }),
  setShowLightHelpers: (v) => set({ showLightHelpers: v }),

  updateMaterial: (id, patch) => {
    set((st) => {
      const mat = st.scene.materials[id];
      if (!mat) return {};
      const scene = { ...st.scene, materials: { ...st.scene.materials, [id]: { ...mat, ...patch } } };
      notify(scene);
      return { scene, ...hist(st) };
    });
  },
  assignMaterial: (objectId, materialId) => {
    set((st) => {
      const scene = {
        ...st.scene,
        objects: st.scene.objects.map((o) => (o.id === objectId ? { ...o, materialId } : o)),
      };
      notify(scene);
      return { scene, selectedMaterialId: materialId ?? st.selectedMaterialId, ...hist(st) };
    });
  },
  addObject: (obj) => {
    set((st) => {
      const scene = { ...st.scene, objects: [...st.scene.objects, obj] };
      notify(scene);
      return { scene, selectedObjectId: obj.id, ...hist(st) };
    });
  },
  removeObject: (id) => {
    set((st) => {
      const scene = { ...st.scene, objects: st.scene.objects.filter((o) => o.id !== id) };
      notify(scene);
      return { scene, selectedObjectId: st.selectedObjectId === id ? null : st.selectedObjectId, ...hist(st) };
    });
  },
  updateObject: (id, patch) => {
    set((st) => {
      const scene = {
        ...st.scene,
        objects: st.scene.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
      };
      notify(scene);
      return { scene, ...hist(st) };
    });
  },
  addLight: (light) => {
    set((st) => {
      const scene = { ...st.scene, lights: [...st.scene.lights, light] };
      notify(scene);
      return { scene, selectedObjectId: light.id, ...hist(st) };
    });
  },
  removeLight: (id) => {
    set((st) => {
      const scene = { ...st.scene, lights: st.scene.lights.filter((l) => l.id !== id) };
      notify(scene);
      return { scene, ...hist(st) };
    });
  },
  updateLight: (id, patch) => {
    set((st) => {
      const scene = {
        ...st.scene,
        lights: st.scene.lights.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      };
      notify(scene);
      return { scene, ...hist(st) };
    });
  },
  updateEnvironment: (patch) => {
    set((st) => {
      const env = { ...st.scene.environment, ...patch };
      if (patch.ground) env.ground = { ...st.scene.environment.ground, ...patch.ground };
      if (patch.background) env.background = { ...st.scene.environment.background, ...patch.background };
      const scene = { ...st.scene, environment: env };
      notify(scene);
      return { scene, ...hist(st) };
    });
  },
  addCustomEnvironment: (env) => {
    set((st) => {
      const scene = { ...st.scene, customEnvironments: [...st.scene.customEnvironments, env] };
      notify(scene);
      return { scene, ...hist(st) };
    });
  },
  removeCustomEnvironment: (id) => {
    set((st) => {
      const scene = { ...st.scene, customEnvironments: st.scene.customEnvironments.filter((e) => e.id !== id) };
      notify(scene);
      return { scene, ...hist(st) };
    });
  },
  addLightPin: (pin) => {
    set((st) => {
      const scene = { ...st.scene, lightPins: [...st.scene.lightPins, pin] };
      notify(scene);
      return { scene, ...hist(st) };
    });
  },
  updateLightPin: (id, patch) => {
    set((st) => {
      const scene = {
        ...st.scene,
        lightPins: st.scene.lightPins.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      };
      notify(scene);
      return { scene, ...hist(st) };
    });
  },
  removeLightPin: (id) => {
    set((st) => {
      const scene = { ...st.scene, lightPins: st.scene.lightPins.filter((p) => p.id !== id) };
      notify(scene);
      return { scene, ...hist(st) };
    });
  },
  importKeyShot: (materials, textures) => {
    set((st) => {
      const matMap = { ...st.scene.materials };
      for (const m of materials) matMap[m.id] = m;
      const existing = new Set(st.scene.textures.map((t) => t.name));
      const mergedTextures = [...st.scene.textures];
      for (const t of textures) if (!existing.has(t.name)) mergedTextures.push(t);
      const scene = { ...st.scene, materials: matMap, textures: mergedTextures };
      notify(scene);
      return { scene, ...hist(st) };
    });
  },
  updateCamera: (patch) => {
    set((st) => {
      const scene = { ...st.scene, camera: { ...st.scene.camera, ...patch } };
      notify(scene);
      return { scene, ...hist(st) };
    });
  },
  updateRender: (patch) => {
    set((st) => {
      const scene = { ...st.scene, render: { ...st.scene.render, ...patch } };
      notify(scene);
      return { scene, ...hist(st) };
    });
  },
  loadScene: (scene) => {
    set((st) => {
      notify(scene);
      return { scene, selectedObjectId: null, selectedMaterialId: null, ...hist(st) };
    });
  },
  resetScene: () => {
    set((st) => {
      const scene = createDefaultScene();
      notify(scene);
      return { scene, selectedObjectId: null, selectedMaterialId: null, ...hist(st) };
    });
  },
  newScene: () => {
    set((st) => {
      const scene = createEmptyScene();
      notify(scene);
      return { scene, selectedObjectId: null, selectedMaterialId: null, ...hist(st) };
    });
  },
  addLabel: (objectId, label) => {
    set((st) => {
      const scene = {
        ...st.scene,
        objects: st.scene.objects.map((o) =>
          o.id === objectId ? { ...o, labels: [...(o.labels ?? []), label] } : o
        ),
      };
      notify(scene);
      return { scene, ...hist(st) };
    });
  },
  updateLabel: (objectId, labelId, patch) => {
    set((st) => {
      const scene = {
        ...st.scene,
        objects: st.scene.objects.map((o) =>
          o.id === objectId
            ? { ...o, labels: (o.labels ?? []).map((lb) => (lb.id === labelId ? { ...lb, ...patch } : lb)) }
            : o
        ),
      };
      notify(scene);
      return { scene, ...hist(st) };
    });
  },
  removeLabel: (objectId, labelId) => {
    set((st) => {
      const scene = {
        ...st.scene,
        objects: st.scene.objects.map((o) =>
          o.id === objectId ? { ...o, labels: (o.labels ?? []).filter((lb) => lb.id !== labelId) } : o
        ),
      };
      notify(scene);
      return { scene, ...hist(st) };
    });
  },
}));
