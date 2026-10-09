// MRender-Web AI 接口层 —— 预留定义（本阶段不实现 AI 后端）
// 设计原则：AI 与 UI 操作同一份场景数据、同一套动作 API。

/** 场景数据类型（与 src/core 数据模型一致，此处引用其类型） */
import type { SceneJSON } from "../core/types";

/** 场景动作 —— UI 与 AI 共用，AI 把指令翻译成动作序列 */
export type SceneAction =
  | { type: "setMaterialProperty"; materialId: string; property: string; value: number | [number, number, number] | string }
  | { type: "assignMaterial"; objectId: string; materialId: string }
  | { type: "addLight"; light: Record<string, unknown> }
  | { type: "setLightProperty"; lightId: string; property: string; value: number }
  | { type: "setEnvironment"; env: Partial<Record<string, unknown>> }
  | { type: "setCamera"; camera: Partial<Record<string, unknown>> }
  | { type: "setRenderSetting"; key: string; value: number | boolean | string }
  | { type: "addLightPin"; pin: Record<string, unknown> }
  | { type: "updateLightPin"; pinId: string; property: string; value: number | [number, number, number] | string | boolean }
  | { type: "removeLightPin"; pinId: string }
  | { type: "transformObject"; objectId: string; transform: Partial<Record<string, unknown>> }
  | { type: "selectObject"; objectId: string | null };

/** AI 给出的建议项（如"推荐使用 300W 柔光箱"） */
export interface Suggestion {
  kind: "material" | "light" | "environment" | "camera" | "render" | "message";
  title: string;
  detail?: string;
  /** 应用该建议所需的动作序列 */
  actions: SceneAction[];
}

/** AI Provider 统一接口 —— 后续接 Ollama / OpenAI / 自建服务都实现它 */
export interface AIProvider {
  /** 自然语言指令 → 动作序列 */
  parseInstruction(input: string, scene: SceneJSON): Promise<SceneAction[]>;
  /** 根据场景上下文生成建议（可选能力） */
  suggest?(context: SceneJSON): Promise<Suggestion[]>;
}

/** 注册表：可同时挂多个 Provider，按需切换 */
const registry = new Map<string, AIProvider>();

export function registerAIProvider(name: string, provider: AIProvider): void {
  registry.set(name, provider);
}

export function getAIProvider(name: string): AIProvider | undefined {
  return registry.get(name);
}

export function listAIProviders(): string[] {
  return [...registry.keys()];
}
