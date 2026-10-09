# MRender-Web

网页版实时渲染软件，KeyShot 式工作流。纯 Web 架构，调用本地 GPU，跨平台运行。

导入模型 → 拖材质 → 调灯光环境 → 出图。全部在浏览器里完成。

## 快速开始

```bash
npm install
npm run dev      # 默认 http://localhost:5173
```

生产构建：

```bash
npm run build    # 产物在 dist/
npm run preview
```

**浏览器要求**：Chrome / Edge 113+（需 WebGL2）。路径追踪出图建议独立显卡；软件渲染（SwiftShader）下高采样会非常慢。

## 特性

- **双引擎**
  - 实时预览：Three.js 光栅化，调参丝滑
  - 高质量出图：GPU 路径追踪（`three-gpu-pathtracer`），支持玻璃 / HDRI 反射 / 软阴影 / 全局光照
- **单一数据源**：场景 / 材质 / 灯光 / 相机 / 环境全是纯 JSON，两个引擎共用，UI 与未来的 AI 改的是同一份数据
- **模型导入**：3DM（Rhino，含图层与命名）、OBJ、STL。实测可处理 600 万三角面
- **材质**：36 个内置预设（玻璃 / 陶瓷 / 金属 / 塑料 / 车漆…），完整 PBR 参数与贴图槽（color / normal / roughness / metallic）
- **环境**：10 个 HDRI 预设，支持旋转、亮度、对比度、背景切换（HDR / 纯色 / 透明）
- **阴影**：KeyShot 式环境驱动——切 HDR 时主光方向与阴影角度自动跟随
- **标签贴花**：把平面图片贴到模型表面做包装标签
- **出图**：PNG 导出（支持透明背景、自定义分辨率）
- **项目文件**：场景保存 / 加载为 JSON

## 架构

```
src/
├── core/        场景数据模型（纯 JSON，全项目唯一数据源）
├── engine/      Three.js 渲染引擎封装（实时预览 + 路径追踪出图）
├── store/       Zustand 状态管理（含 undo/redo）
├── ui/          UI 组件（KeyShot 风格三栏布局）
└── ai/          AI 接口层（预留，已定义接口，未实现）
```

设计要点：**AI 与 UI 操作的是同一份场景数据、同一套动作 API**。详见 `docs/AI-接口设计-V1.md`。

## 素材与授权

代码以 MIT 开源。素材授权如下：

| 素材 | 来源 | 授权 |
|---|---|---|
| HDRI `ph_*` | Poly Haven | CC0 |
| HDRI `env_*` | three.js 官方示例 | MIT |
| HDRI `keyshot_startup` / `user_startup` / `panels_tilted` | 自有 / KeyShot 导出 | 自有 |
| 纹理 `ambientcg/*` | ambientCG | CC0 |

### 关于商业 HDRI（重要）

`public/assets/hdri/dosch/` 与 `public/assets/hdri/hdrimaps/` **不在本仓库中**——它们来自 Dosch Design 与 HDRI Maps，属商业授权，公开分发会侵权。

这两个目录**不影响任何功能**：代码对它们零引用，10 个内置环境预设全部来自上表的 CC0 / 自有素材。

如果你本地已购买这些素材，拷回这两个目录即可被环境库自动识别。

## 已知问题

- **白平衡导出不一致**：白平衡是画在 canvas 上的 CSS 滤镜，预览生效，但导出 PNG 取的是画布像素、不含 CSS 滤镜，因此导出图为中性色。待改为 shader 内实现。
- **超大模型**：600 万三角面可导入并实时预览，但路径追踪出图对显存要求高，软件渲染环境建议先降采样。
- **打包体积**：单 chunk 约 1.7MB（gzip 525KB），主要来自 three.js 与 rhino3dm，未做代码分割。

## 文档

- `docs/技术方案-V1.md` — 技术选型与验收清单
- `docs/AI-接口设计-V1.md` — AI 接口预留设计
- `docs/keyshot-reference.md` — KeyShot 工作流对照

## 许可证

[MIT](LICENSE) © 2026 huabing188
