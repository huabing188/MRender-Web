// 底部状态栏
import React from "react";
import { useSceneStore } from "../store/sceneStore";
import { getEngine } from "./engineBridge";
import { addModelFromFile } from "../engine/ThreeEngine";

const SEGS = [
  { key: "cloud", label: "云端", dot: false, action: "cloud" },
  { key: "import", label: "导入", dot: false, action: "import" },
  { key: "library", label: "库", dot: true, action: "library" },
  { key: "project", label: "项目", dot: true, action: "project" },
  { key: "animation", label: "动画", dot: false, action: "animation" },
  { key: "xr", label: "KeyShotXR", dot: false, action: "xr" },
  { key: "render", label: "渲染", dot: true, action: "render" },
] as const;

export function StatusBar() {
  const statusMessage = useSceneStore((s) => s.statusMessage);
  const stats = useSceneStore((s) => s.stats);
  const scene = useSceneStore((s) => s.scene);

  const handleSeg = (action: string) => {
    const st = useSceneStore.getState();
    switch (action) {
      case "cloud":
        st.setStatus("云端同步：后续版本支持项目云存储");
        break;
      case "import": {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".obj,.gltf,.glb,.stl,.ply,.fbx,.3dm";
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) return;
          try {
            await addModelFromFile(f, (msg) => st.setStatus(msg));
          } catch (e) {
            st.setStatus(`导入失败: ${(e as Error).message}`);
          }
        };
        input.click();
        break;
      }
      case "library":
        st.setLibraryTab("materials");
        st.setStatus("已切换到材质库");
        break;
      case "project":
        st.setActiveTab("scene");
        st.setStatus("已切换到场景面板");
        break;
      case "animation":
        st.setStatus("动画功能：后续版本支持关键帧动画与产品旋转展示");
        break;
      case "xr":
        st.setStatus("KeyShotXR 交互式 360° 展示：后续版本支持");
        break;
      case "render": {
        const eng = getEngine();
        if (!eng) return;
        const [w, h] = scene.render.resolution;
        eng.exportPNG([w, h], scene.render.preserveAlpha, scene.name);
        st.setStatus(`已导出渲染图 ${w}x${h}`);
        break;
      }
    }
  };

  return (
    <div className="status-bar">
      <div className="status-left">{statusMessage}</div>
      {SEGS.map((s) => (
        <div
          key={s.key}
          className="status-seg"
          onClick={() => handleSeg(s.action)}
          title={s.label}
          style={{ cursor: "pointer" }}
        >
          <span className={`dot ${s.dot ? "" : "off"}`} />
          {s.label}
        </div>
      ))}
      <div className="status-seg" style={{ borderLeft: "1px solid var(--border)" }}>
        {stats ? `${stats.fps} FPS | ${(stats.triangles / 1000).toFixed(1)}k 三角 | ${scene.render.device === "gpu" ? "GPU" : "CPU"} 模式` : "引擎启动中…"}
      </div>
      <div className="status-seg" style={{ color: "var(--text-faint)" }}>
        {scene.render.resolution[0]}x{scene.render.resolution[1]}
      </div>
    </div>
  );
}
