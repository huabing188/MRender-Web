# MRender-Web · 项目记忆

## 定位
网页版实时渲染软件，KeyShot 式工作流，纯 Web/HTML 架构，调用本地 GPU，跨平台。
**在研主项目**（最大，233MB，含 verify/ 下 176 张验证截图）。

## 项目边界（铁律）
- 与 `~/Desktop/codex文件/MRender/`（原生 AppKit / Swift + Metal 版）**完全独立，互不影响、互不参考**。原生版由 Codex 做，Web 版由我（WorkBuddy）做。
- 不写渲染引擎底层，全部用现成成熟库。
- **所有产出只放本文件夹内**，不散落其他目录。

## 架构：双引擎 + 单一数据源
- 实时预览：`Three.js` 光栅化（调参丝滑）
- 高质量出图：`WebGPU` 路径追踪（玻璃 / 液体 / HDRI 反射 / 景深）
- 场景 / 材质 / 灯光 / 相机 / 环境 = **纯 JSON 数据模型**，两个引擎共用；UI 参数面板与未来 AI 都只改这一份数据

## 技术栈
React 18 + TypeScript + Vite + Zustand + three 0.185 + three-gpu-pathtracer + rhino3dm

## 目录
```
src/ai/         AI 接口层（预留，本阶段只定义接口不实现）
src/core/       场景数据模型（纯 JSON，全项目唯一数据源）
src/engine/     Three.js 渲染引擎封装（实时预览）
src/pathtracer/ 路径追踪封装（出图）
src/store/      Zustand 状态管理
src/ui/         UI 组件（KeyShot 风格）
public/         静态资源（HDR/贴图/模型）
docs/           技术方案-V1 / AI-接口设计-V1 / keyshot-reference
research/       素材来源清单
verify/         验证截图（176 张）
```

## 排期（一周 Beta）
D1 WebGPU 验证+脚手架+三栏 UI → D2 OBJ/GLTF 导入+场景树+Gizmo → D3 材质系统 → D4 标签贴图+HDRI → D5 灯光相机 → D6 路径追踪出图+PNG 导出 → D7 项目保存/打开

## 关键文件
- `README.md` — 项目章程
- `docs/技术方案-V1.md` — 技术选型 + 7 天排期 + 验收清单
- `docs/AI-接口设计-V1.md` — AI 接口预留设计（重要）
- `启动软件.command` / `start-mrender.sh` / `serve-dist.sh`

## 注意
- `node_modules` **不归档**，需自行 `npm install`
- 根目录有两个 vite 临时配置文件（`vite.config.ts.timestamp-*.mjs`），是构建残留，可清理
