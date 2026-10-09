# KeyShot 参数体系参考（MRender 设计依据）

> 来源：KeyShot 官方手册 (manual.keyshot.com / manuals.keyshot.com)、KeyShot 博客与社区教程。
> 用途：MRender-Web 的环境、灯光针、路径追踪渲染、图像风格、相机等模块对标 KeyShot 的参数设计。

## 1. 环境 Environment（Project 窗口 → Environment 页签）

### 1.1 文件 File
- 从文件载入 HDRI（.hdri / .hdz / .exr）；可重载；右键复制路径/在资源管理器显示/重载/打开新环境。

### 1.2 调整 Adjustments
- **Brightness 亮度**：整体提亮/压暗整个 HDRI（从阴影到高光等比）。
- **Contrast 对比度**：加大暗部与亮部间隔，使阴影更暗、高光更亮。

### 1.3 变换 Transform
- **Size 尺寸**：环境整体大小。
- **Height 高度**：环境相对地平面的**垂直位置**（抬高/压低地平线）。
- **Rotation 旋转**：旋转环境（水平方位）。

### 1.4 背景 Background
- **Lighting Environment**：用环境图本身作背景（热键 E）。
- **Color**：纯色背景（热键 C）。注意：纯色也可在 Photographic Image Style 中设置，会覆盖此处。
- **Backplate Image**：用图片作背景（热键 B）。支持 jpg/jpeg/tif/tiff/bmp/png/gif/dds/hdr/hdz/exr/tga/ppm/ktx/psd。

### 1.5 地面 Ground
- **Ground Shadows**：地面阴影可见性 + 基础色。
- **Occlusion Ground Shadows**：以环境光遮蔽阴影替代投影阴影。
- **Ground Reflections**：地面反射可见性。
- **Flatten Ground**：把地平线以下的那部分环境投影到地面（环境图作背景时关联高宽），热键 G。
- **Ground Size**：虚拟地平面尺寸（只影响地面阴影）。

## 2. 灯光针 Light Pins（HDRI Editor，环境上的「灯」）

> Pins are lights。在环境球上放置可编辑光源，实时编辑亮度/颜色/形状/柔边，并即时反映到实时视图。

- **形状**：Circular（圆形）/ Rectangular（矩形）/ Image（图像针，用 HDR/HDZ/EXR/JPG/PNG 作为针，做特定反射、灯光阵列）。
- **调整 Adjustments**：Brightness、Contrast、Saturation、Hue、Colorize（颜色叠加）。
- **变换 Transforms**：
  - **Azimuth 方位角**：水平位置。
  - **Elevation 高度角**：垂直位置（针的高度）。
  - Angle（仅矩形针旋转）、Rounded corner（矩形圆角）、Half（半切）。
- **Falloff 衰减**：边缘柔化程度；Falloff Mode 控制衰减方式（中心向外）。
- **Blend Mode**：针之间如何混合/叠加（顺序很重要）。
- **Set Highlight Target**：点选模型上某点，KeyShot 自动把灯放到环境对应位置，使高光打在该点（Key/ Fill/ Rim 布光法：Rim 最亮做边缘光晕，Key 次亮打正面，Fill 最弱补光）。

## 3. 渲染质量 / Path Tracing（Render 对话框 → Quality）

KeyShot 实时视图与最终渲染用不同技术；最终写实图走 **Path Tracing / Custom Control** 路径追踪。

- **Samples 采样**：每像素发射的光线数。典型 8–16；终稿 256–512（玻璃/透明可更高）。越低噪点越多。
- **Ray Bounces 光线反弹**：光线在场景反弹次数。玻璃/液体/透明件要调高，否则玻璃发黑、折射不全；不透明件高值几乎无差。
- **Anti-Aliasing Quality**：抗锯齿 1–5（默认 1；透明+近似背景色时调到 5 防 artifact）。
- **Shadow Quality**：阴影质量 1–3（调高显著增加时间，亮漫反射如白塑料最明显）。
- **Global Illumination Quality**：间接光质量（默认 1，通常够；关 GI 时置灰）。
- **Pixel Filter Size**：像素模糊 1–3（默认 1.5；1=不模糊；高分辩率可用更大值软化锐利感）。
- **DOF Quality**：景深质量（开 DOF 时 3–5 为佳）。
- **Caustics Quality**：焦散质量（开焦散时）。
- **AI Denoise**：实时视图 1s 后启动、每 5s 刷新；Denoise Blend 控制强度（细节多则调低避免抹细节）。
- **Firefly Filter**：消除异常亮像素（强度可调，过高会丢细节）。
- **Bloom**：Intensity 0–2、Radius 0–128px、Threshold（越大越只限最亮像素）。

## 4. 图像风格 Image Style（Project → Image 页签）

两类：**Basic**（Exposure/Gamma + Denoise/Bloom/Vignette/Chromatic Aberration）与 **Photographic**（加 Tone Mapping/Curve/Color/Layers/White Balance/Saturation/Contrast）。非破坏式，渲染后处理应用，不影响渲染性能。

- **Exposure 曝光 (EV)**：+1 翻倍进光量。
- **Gamma**：图像强度（降 gamma 变暗、升 gamma 变亮）。
- **Denoise / Denoise Blend**：降噪与混合强度。
- **Firefly Filter**：异常亮像素滤除。
- **Bloom**：Intensity / Radius(px) / Threshold。
- **Vignette**：Strength + Color（默认黑）。
- **Chromatic Aberration**：Strength + Bias（镜头色散边缘）。
- Photographic 额外：Tone Mapping、Curve、Color、Layers、White Balance、Saturation、Contrast。

## 5. 相机 Camera

- **Focal Length 焦距** / **Aperture (f-stop) 光圈** → 决定 **DOF 景深**。
- **Perspective 透视**；DOF Quality 在渲染设置中控制景深质量。

## 6. 对 MRender 的落地映射

| KeyShot | MRender 落地 |
|---|---|
| Environment: Brightness/Contrast/Rotation/Size/Height | EnvironmentData: brightness/contrast/rotation/height/size（store→引擎） |
| Background: Env/Color/Backplate | EnvironmentData.background {mode:'hdr'\|'color'\|'image', color, image} |
| Ground: shadows/reflections/flatten/size | EnvironmentData.ground {shadow, reflection, flatten, size} |
| Light Pins (Azimuth/Elevation/Brightness/shape/Falloff) | SceneJSON.lightPins[] → 引擎映射为 RectAreaLight（球坐标→方向） |
| Path Tracing: Samples/RayBounces/AA/Shadow/GI/Denoise | 出图用 three-gpu-pathtracer：samples/bounces/denoise |
| Image Style: Exposure/Gamma/Bloom/Vignette/CA | 后处理 pass（Exposure/Bloom/Vignette/CA） |
| Camera: Focal/Aperture/DOF | 已有焦距↔FOV；加 aperture/DOF |
