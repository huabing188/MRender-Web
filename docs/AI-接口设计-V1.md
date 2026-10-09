# MRender-Web AI 接口设计 V1.0（预留）

> 目的：从架构第一天就为 AI 功能留好位置，后面接 AI 时不改架构、只填实现。
> 本阶段（一周 Beta）**只定义接口与数据结构，不实现 AI 功能**。

## 一、核心设计原则

**AI 与 UI 是平等的"操作者"** —— 用户点参数面板改材质，AI 说"换成磨砂玻璃"，走的是**同一条路**：

```
用户操作 ──┐
           ├─→ 动作 API（Action Bus）─→ 场景数据（Scene Data）─→ 渲染引擎
AI 指令  ──┘
```

这个设计意味着：
- AI 不需要理解 Three.js，只需要读写 JSON 场景数据
- 所有 UI 能做的调整，AI 都能做（天然能力对等）
- 以后接任何 AI 后端（本地 Ollama / 云端 API）都不动架构

## 二、数据层（AI 可读写的完整场景快照）

`src/core/` 里定义纯 JSON 数据模型，整个场景就是一个可序列化对象：

```json
{
  "version": 1,
  "objects": [
    {
      "id": "obj_bottle_001",
      "name": "白酒瓶",
      "type": "mesh",
      "mesh": "model:jiu_ping.obj",
      "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "materialId": "mat_glass_001",
      "visible": true
    }
  ],
  "materials": {
    "mat_glass_001": {
      "name": "磨砂玻璃",
      "baseColor": [0.9, 0.95, 0.95],
      "metallic": 0.0,
      "roughness": 0.08,
      "transmission": 0.95,
      "ior": 1.5,
      "clearcoat": 0.0,
      "maps": { "color": "tex:label_a.png", "normal": null }
    }
  },
  "environment": {
    "hdr": "hdr:studio_soft.hdr",
    "intensity": 1.0,
    "rotation": 30,
    "background": { "mode": "hdr", "color": [0.05, 0.05, 0.06] }
  },
  "lights": [
    { "id": "light_01", "type": "area", "position": [2, 3, 4], "intensity": 300, "color": [1, 1, 1], "size": [1, 2] }
  ],
  "camera": {
    "fov": 35, "focalLength": 50, "aperture": 2.8, "dof": false,
    "exposure": 0.0, "whiteBalance": 6500,
    "position": [0, 0, 8], "target": [0, 0.5, 0]
  },
  "render": {
    "resolution": [1920, 1080], "samples": 512, "denoise": true,
    "transparentBackground": true
  }
}
```

**关键点：这个 JSON 就是 AI 与软件之间的"共同语言"。** 项目保存/打开也用它。

## 三、动作层（Action Bus）

所有对场景的操作都是"动作"，UI 和 AI 共用同一套：

```ts
type SceneAction =
  | { type: "setMaterialProperty"; materialId: string; property: string; value: number | [number, number, number] | string }
  | { type: "assignMaterial"; objectId: string; materialId: string }
  | { type: "addLight"; light: LightData }
  | { type: "setLightProperty"; lightId: string; property: string; value: number }
  | { type: "setEnvironment"; env: Partial<EnvironmentData> }
  | { type: "setCamera"; camera: Partial<CameraData> }
  | { type: "setRenderSetting"; key: string; value: number | boolean }
  | { type: "transformObject"; objectId: string; transform: Partial<TransformData> }
  | { type: "selectObject"; objectId: string | null };
```

## 四、AI Provider 抽象（预留接口）

`src/ai/provider.ts` 定义统一接口，本阶段只声明不实现：

```ts
interface AIProvider {
  /** 自然语言 → 动作序列：AI 把用户的话翻译成 SceneAction[] */
  parseInstruction(input: string, sceneSnapshot: SceneJSON): Promise<SceneAction[]>;
  /** 根据场景上下文生成建议（可选） */
  suggest?(context: SceneJSON): Promise<Suggestion[]>;
}
```

计划接入的后端（后续阶段）：
1. **本地优先**：Ollama（Qwen 等开源模型，数据不出本机）
2. **云端可选**：OpenAI / 国产大模型 API
3. 通过 `AIProvider` 接口切换，UI 层无感知

## 五、预留的 AI 场景（Beta 后迭代）

| AI 能力 | 原理 | 依赖 |
|---|---|---|
| 自然语言指令 | "把瓶身材质换成磨砂玻璃" → parseInstruction → 动作序列 | AIProvider |
| 自动布光 | AI 读场景 + 摄影棚知识 → 生成灯光组合 | suggest + 灯光预设库 |
| 材质推荐 | 根据模型类别（酒瓶→玻璃/陶瓷）推荐材质 | suggest + 材质库 |
| 标签生成 | 文字/Logo → 生成贴图 PNG | 图像生成 API |
| 渲染参数优化 | 分析画面（过曝/噪点）→ 建议曝光/采样数 | suggest |

## 六、本阶段的落地承诺

- [x] `src/ai/` 目录预留（provider.ts 接口声明 + types.ts 类型定义）
- [ ] 数据模型 JSON 化（`src/core/`，D1-D3 随开发落地）
- [ ] Action Bus 实现（UI 操作即动作，随 D2-D6 落地）
- [ ] AIProvider 接口声明文件（D1 与脚手架一起建好）
- **本阶段不接入任何 AI 后端**，接口留好即可
