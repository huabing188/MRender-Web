// AI 指令解析层 —— MVP 用规则引擎实现，后续可无缝替换为 LLM Provider
// 设计：指令 → SceneAction[] → 动作总线（与 UI 操作同一条路）
import type { SceneJSON } from "../core/types";
import type { SceneAction } from "./provider";
import { useSceneStore } from "../store/sceneStore";

export interface AIInstructionResult {
  summary: string;
  actions: SceneAction[];
}

/** 材质关键词 → 内置材质 id */
const MATERIAL_KEYWORDS: [RegExp, string, string][] = [
  [/磨砂/, "mat_glass_frosted", "磨砂玻璃"],
  [/玻璃/, "mat_glass", "玻璃"],
  [/液体|酒|水/, "mat_liquid", "液体"],
  [/白瓷|陶瓷/, "mat_ceramic_white", "白瓷"],
  [/铬|镜面|银/, "mat_metal_chrome", "铬金属"],
  [/黄铜|铜/, "mat_metal_brass", "黄铜"],
  [/金/, "mat_gold", "金属金"],
  [/木/, "mat_wood", "木纹"],
  [/皮革/, "mat_leather", "皮革"],
  [/塑料|黑塑/, "mat_plastic_black", "黑塑料"],
  [/标签|纸/, "mat_paper_label", "纸标签"],
];

/** 找场景里名字匹配的对象（含子对象名） */
function findObject(scene: SceneJSON, kw: RegExp): string | null {
  for (const o of scene.objects) {
    if (kw.test(o.name)) return o.id;
    for (const c of o.children ?? []) {
      if (kw.test(c.name)) return c.id;
    }
  }
  return null;
}

function findMaterial(scene: SceneJSON, kw: RegExp): string | null {
  for (const [re, id] of MATERIAL_KEYWORDS) {
    if (kw.test(re.source) || re.test(kw.source)) return id;
  }
  return null;
}

/**
 * 解析自然语言指令为动作序列。
 * MVP：关键词规则。正式版：接入 AIProvider（LLM），函数签名不变，UI 层无感知。
 */
export async function dispatchAIInstruction(text: string, scene: SceneJSON): Promise<AIInstructionResult> {
  const actions: SceneAction[] = [];
  const lowered = text.toLowerCase();
  const selectedId = selectedObject(scene);

  // 1. 材质类指令
  for (const [re, matId, name] of MATERIAL_KEYWORDS) {
    if (re.test(text) && /材质|换成|变成|用.*做|上色|应用/.test(text)) {
      const target = selectedId ?? findObject(scene, /瓶|盖|身|标|体/);
      if (target) {
        actions.push({ type: "assignMaterial", objectId: target, materialId: matId });
        return { summary: `已把「${objectName(scene, target)}」材质改为 ${name}`, actions };
      }
      return { summary: `已选中材质 ${name}（请在场景中选择对象后应用）`, actions: [{ type: "selectObject", objectId: null }] };
    }
  }

  // 2. 灯光类指令
  const lightMatch = text.match(/(主光|辅光|轮廓光|补光|暖色?光|冷色?光|灯光)/);
  if (lightMatch) {
    const kind = lightMatch[1];
    const isWarm = /暖/.test(text);
    const isCool = /冷/.test(text);
    const type = /轮廓|背光|rim/.test(text) ? "rim" : /辅|补/.test(text) ? "fill" : "key";
    const id = `light_ai_${Date.now().toString(36)}`;
    const base = { id, name: `AI ${kind}`, type: "area" as const, position: [2.2, 3.0, 2.8] as [number, number, number], size: [1.0, 0.7] as [number, number], visible: true };
    const light = {
      ...base,
      intensity: type === "rim" ? 8 : type === "fill" ? 5 : 12,
      color: isWarm ? ([1, 0.85, 0.6] as [number, number, number]) : isCool ? ([0.7, 0.85, 1] as [number, number, number]) : ([1, 1, 1] as [number, number, number]),
    };
    actions.push({ type: "addLight", light: light as unknown as Record<string, unknown> });
    return { summary: `已添加${isWarm ? "暖色" : isCool ? "冷色" : ""}${kind}（强度 ${light.intensity}）`, actions };
  }

  // 3. 环境类指令
  if (/环境|背景|棚|hdr/i.test(text)) {
    const preset = /暖|黄昏|金/.test(text) ? "golden_hour" : /冷|蓝/.test(text) ? "cool_studio" : "room";
    actions.push({ type: "setEnvironment", env: { preset, hdrKey: null } });
    return { summary: `环境已切换：${preset === "golden_hour" ? "暖光 Golden" : preset === "cool_studio" ? "冷调棚 Cool" : "摄影棚 Room"}`, actions };
  }

  // 4. 相机/视角类
  if (/相机|视角|镜头|焦距/.test(text)) {
    const fov = /广角/.test(text) ? 60 : /长焦/.test(text) ? 20 : 35;
    actions.push({ type: "setCamera", camera: { fov } });
    return { summary: `相机 FOV 已设为 ${fov}°`, actions };
  }

  // 5. 渲染出图类
  if (/出图|渲染|导出|png/.test(text)) {
    actions.push({ type: "setRenderSetting", key: "mode", value: "pathtrace" });
    return { summary: "已切到路径追踪模式，点击「渲染出图」导出 PNG（WebGPU 加速）", actions };
  }

  // 未命中 → 提示 AI Provider 预留
  return {
    summary: "AI Provider 尚未接入（接口已预留）。当前可用指令：材质/灯光/环境/相机/出图",
    actions: [],
  };
}

function selectedObject(scene: SceneJSON): string | null {
  return useSceneStore.getState().selectedObjectId;
}

function objectName(scene: SceneJSON, id: string): string {
  for (const o of scene.objects) {
    if (o.id === id) return o.name;
    const c = (o.children ?? []).find((x) => x.id === id);
    if (c) return c.name;
  }
  return id;
}

const _unused = findMaterial; // 保留扩展点
