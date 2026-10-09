// 中央 3D 视口：引擎画布 + 视图条 + Gizmo 工具 + 渲染统计 + 拖拽导入 + AI 指令条
import React, { forwardRef, useState } from "react";
import { useSceneStore } from "../store/sceneStore";
import { getEngine } from "./engineBridge";
import { addModelFromFile } from "../engine/ThreeEngine";
import { dispatchAIInstruction } from "../ai/instructions";

const VIEW_MODES = ["透视", "前视", "后视", "左视", "右视", "顶视", "底视", "查看全部"];

const GIZMO_MODES = [
  { id: "translate", label: "移动", icon: "✥" },
  { id: "rotate", label: "旋转", icon: "↻" },
  { id: "scale", label: "缩放", icon: "⬒" },
] as const;

export const Viewport = forwardRef<HTMLDivElement>(function Viewport(_props, ref) {
  const [dragOver, setDragOver] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string } | null>(null);
  const [showAI, setShowAI] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);

  const stats = useSceneStore((s) => s.stats);
  const showStats = useSceneStore((s) => s.showStats);
  const setShowStats = useSceneStore((s) => s.setShowStats);
  const gizmoMode = useSceneStore((s) => s.gizmoMode);
  const setGizmoMode = useSceneStore((s) => s.setGizmoMode);
  const selectedObjectId = useSceneStore((s) => s.selectedObjectId);
  const viewMode = useSceneStore((s) => s.viewMode);
  const setViewMode = useSceneStore((s) => s.setViewMode);
  const setStatus = useSceneStore((s) => s.setStatus);
  const scene = useSceneStore((s) => s.scene);

  const setGizmo = (mode: (typeof GIZMO_MODES)[number]["id"] | "off") => {
    setGizmoMode(mode);
    const eng = getEngine();
    if (eng) eng.setGizmoMode(mode, selectedObjectId);
  };

  const setView = (v: string) => {
    setViewMode(v);
    getEngine()?.setViewMode(v);
  };

  const onDropFile = async (files: FileList) => {
    for (const f of Array.from(files)) {
      const name = f.name.toLowerCase();
      if (name.endsWith(".hdr") || name.endsWith(".exr")) {
        getEngine()?.importHdrFile(f);
        setStatus(`正在加载 HDR：${f.name}`);
        continue;
      }
      try {
        await addModelFromFile(f, setStatus);
      } catch (e) {
        setStatus(`导入失败 ${f.name}: ${(e as Error).message}`);
      }
    }
  };

  const runAI = async () => {
    const text = aiInput.trim();
    if (!text || aiBusy) return;
    setAiBusy(true);
    setAiResult(null);
    try {
      const result = await dispatchAIInstruction(text, scene);
      setAiResult(result.summary);
      setAiInput("");
      if (result.actions.length === 0 && result.summary.includes("未接入")) {
        setShowAI(false);
      }
    } catch (e) {
      setAiResult(`AI 指令处理失败: ${(e as Error).message}`);
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div
      className="viewport-wrap"
      ref={ref}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) onDropFile(e.dataTransfer.files);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const eng = getEngine();
        if (!eng) return;
        const id = eng.pickAt(e.clientX, e.clientY);
        if (id) {
          useSceneStore.getState().selectObject(id);
          setCtx({ x: e.clientX, y: e.clientY, id });
        }
      }}
      onClick={(e) => {
        // 点击空白处取消选中
        const t = e.target as HTMLElement;
        if (t.classList?.contains("viewport-wrap")) {
          useSceneStore.getState().selectObject(null);
        }
      }}
    >
      {dragOver && <div className="drag-overlay">释放以导入模型 / HDR</div>}

      {/* 视图条（顶部中央） */}
      <div className="view-strip">
        {VIEW_MODES.map((v) => (
          <button key={v} className={`vp-btn ${viewMode === v ? "active" : ""}`} onClick={() => setView(v)} style={{ fontSize: 10 }}>
            {v}
          </button>
        ))}
      </div>

      {/* Gizmo 工具条（左上） */}
      <div className="viewport-tools">
        {GIZMO_MODES.map((m) => (
          <button
            key={m.id}
            className={`vp-btn ${gizmoMode === m.id ? "active" : ""}`}
            onClick={() => setGizmo(gizmoMode === m.id ? "off" : m.id)}
            title={`${m.label} (选中对象后启用)`}
          >
            {m.icon} {m.label}
          </button>
        ))}
        <button className={`vp-btn ${gizmoMode === "off" ? "active" : ""}`} onClick={() => setGizmo("off")}>关闭</button>
        <div className="vp-sep" />
        <button className={`vp-btn ${showStats ? "active" : ""}`} onClick={() => setShowStats(!showStats)}>统计</button>
        <button className="vp-btn" onClick={() => setShowAI(!showAI)} style={{ borderColor: "var(--accent)", color: "var(--accent-text)" }}>
          ✦ AI
        </button>
      </div>

      {/* 渲染统计浮窗 */}
      {showStats && stats && (
        <div className="stats-overlay">
          <div className="st-title">渲染统计</div>
          <div>帧率 FPS <span className="st-val">{stats.fps}</span></div>
          <div>三角形 <span className="st-val">{(stats.triangles / 1000).toFixed(1)}k</span></div>
          <div>顶点 <span className="st-val">{(stats.vertices / 1000).toFixed(1)}k</span></div>
          <div>绘制调用 <span className="st-val">{stats.drawCalls}</span></div>
        </div>
      )}

      {/* 坐标轴徽标（左下） */}
      <svg className="axis-badge" viewBox="0 0 68 68">
        <g transform="translate(40 40)">
          <line x1="0" y1="0" x2="26" y2="0" stroke="#e0605f" strokeWidth="3" />
          <line x1="0" y1="0" x2="0" y2="-26" stroke="#4caf7d" strokeWidth="3" />
          <line x1="0" y1="0" x2="-18" y2="13" stroke="#3f8cff" strokeWidth="3" />
          <text x="29" y="4" fontSize="11" fill="#e0605f" fontFamily="monospace">X</text>
          <text x="5" y="-28" fontSize="11" fill="#4caf7d" fontFamily="monospace">Y</text>
          <text x="-28" y="20" fontSize="11" fill="#3f8cff" fontFamily="monospace">Z</text>
        </g>
      </svg>

      {/* 视口提示 */}
      <div className="viewport-hint">
        左键旋转 · 右键平移 · 滚轮缩放 · 拖入模型/HDR 导入 · 右键对象 = 菜单 · 空格 = Gizmo 移动
      </div>

      {/* 右键上下文菜单 */}
      {ctx && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 50 }}
            onClick={() => setCtx(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtx(null); }}
          />
          <div className="ctx-menu" style={{ left: ctx.x, top: ctx.y }}>
            {(() => {
              const eng = getEngine();
              const splittable = eng ? !!eng.explodeModel(ctx.id) : false;
              const obj = useSceneStore.getState().scene.objects.find((o) => o.id === ctx.id);
              return (
                <>
                  <div
                    className="ctx-item"
                    onClick={() => {
                      const r = eng?.groupObjects(ctx.id);
                      if (r) useSceneStore.getState().setStatus(r.message);
                      setCtx(null);
                    }}
                  >
                    ⛓ 群组物件
                  </div>
                  <div
                    className="ctx-item"
                    style={splittable ? {} : { opacity: 0.4, pointerEvents: "none" }}
                    onClick={async () => {
                      if (eng) {
                        const r = await eng.ungroupObject(ctx.id);
                        useSceneStore.getState().setStatus(r.message);
                      }
                      setCtx(null);
                    }}
                  >
                    ✂ 打散物件
                  </div>
                  <div
                    className="ctx-item"
                    onClick={() => {
                      useSceneStore.getState().updateObject(ctx.id, { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
                      setCtx(null);
                    }}
                  >
                    ↺ 重置变换
                  </div>
                  <div
                    className="ctx-item"
                    onClick={() => {
                      if (obj) useSceneStore.getState().updateObject(ctx.id, { visible: !obj.visible });
                      setCtx(null);
                    }}
                  >
                    {obj?.visible ? "🙈 隐藏" : "👁 显示"}
                  </div>
                  <div className="ctx-sep" />
                  <div
                    className="ctx-item danger"
                    onClick={() => {
                      useSceneStore.getState().removeObject(ctx.id);
                      getEngine()?.setGizmoMode("off");
                      setCtx(null);
                    }}
                  >
                    🗑 删除
                  </div>
                </>
              );
            })()}
          </div>
        </>
      )}

      {/* AI 指令条 */}
      {showAI && (
        <div className="ai-bar">
          <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 12 }}>✦</span>
          <input
            autoFocus
            placeholder='AI 指令（预留接口）：如"把瓶身材质换成磨砂玻璃" / "加一盏暖色轮廓光"'
            value={aiInput}
            onChange={(e) => setAiInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runAI()}
          />
          <button className="btn primary ai-send" onClick={runAI} disabled={aiBusy}>
            {aiBusy ? "处理中…" : "执行"}
          </button>
          {aiResult && (
            <span style={{ position: "absolute", top: "-26px", left: 10, background: "rgba(35,37,43,0.95)", border: "1px solid var(--border)", borderRadius: 4, padding: "3px 8px", fontSize: 10.5, color: "var(--accent-text)", whiteSpace: "nowrap" }}>
              {aiResult}
            </span>
          )}
        </div>
      )}
    </div>
  );
});
