// 左侧 Library 资源库（七子库页签）
import React, { useMemo } from "react";
import { useSceneStore } from "../store/sceneStore";
import { BUILTIN_MATERIALS, ENV_PRESETS, BUILTIN_TEXTURES, generateProceduralTexture } from "../core/defaultScene";
import { ICONS } from "./common";
import { addModelFromFile } from "../engine/ThreeEngine";
import { getEngine } from "./engineBridge";
import { parseKeyshotMaterialLibrary, readFileAsArrayBuffer } from "../engine/keyshotImport";
import type { TextureAsset } from "../core/types";

const LIB_TABS = [
  { id: "materials", label: "材质", icon: ICONS.palette },
  { id: "colors", label: "颜色", icon: ICONS.palette },
  { id: "textures", label: "纹理", icon: ICONS.texture },
  { id: "environments", label: "环境", icon: ICONS.sun },
  { id: "backgrounds", label: "背景", icon: ICONS.image },
  { id: "favorites", label: "收藏夹", icon: ICONS.star },
  { id: "models", label: "模型", icon: ICONS.box },
] as const;

type LibTabId = (typeof LIB_TABS)[number]["id"];

/** 材质球缩略图：径向渐变模拟球体 */
function SphereThumb({ color, metallic, roughness }: { color: [number, number, number]; metallic: number; roughness: number }) {
  const r = Math.round(color[0] * 255);
  const g = Math.round(color[1] * 255);
  const b = Math.round(color[2] * 255);
  const base = `rgb(${r},${g},${b})`;
  const dark = metallic
    ? `rgb(${Math.round(r * 0.55)},${Math.round(g * 0.55)},${Math.round(b * 0.55)})`
    : `rgb(${Math.round(r * (1 - roughness * 0.5))},${Math.round(g * (1 - roughness * 0.5))},${Math.round(b * (1 - roughness * 0.5))})`;
  return (
    <div
      className="swatch-sphere"
      style={{
        ["--hi" as string]: metallic ? `linear-gradient(135deg, rgba(255,255,255,0.85), ${base})` : base,
        ["--lo" as string]: dark,
        background: `radial-gradient(circle at 32% 30%, ${base}, ${dark} 72%)`,
      }}
    />
  );
}

export function LibraryPanel() {
  const libraryTab = useSceneStore((s) => s.libraryTab);
  const setLibraryTab = useSceneStore((s) => s.setLibraryTab);
  const scene = useSceneStore((s) => s.scene);
  const selectedObjectId = useSceneStore((s) => s.selectedObjectId);
  const assignMaterial = useSceneStore((s) => s.assignMaterial);
  const setActiveTab = useSceneStore((s) => s.setActiveTab);
  const selectMaterial = useSceneStore((s) => s.selectMaterial);
  const setStatus = useSceneStore((s) => s.setStatus);
  const updateEnvironment = useSceneStore((s) => s.updateEnvironment);
  const addObject = useSceneStore((s) => s.addObject);
  const updateRender = useSceneStore((s) => s.updateRender);
  const importKeyShot = useSceneStore((s) => s.importKeyShot);
  const [query, setQuery] = React.useState("");

  // 材质库：内置预设 + 已导入（scene.materials 中与内置不同的部分）
  const materials = useMemo(() => {
    const builtinIds = new Set(Object.keys(BUILTIN_MATERIALS));
    const imported = Object.values(scene.materials).filter((m) => !builtinIds.has(m.id));
    return [...Object.values(BUILTIN_MATERIALS), ...imported];
  }, [scene.materials]);

  const importKmp = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".kmp";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      setStatus(`正在解析 KeyShot 材质库：${f.name} …`);
      try {
        const buf = await readFileAsArrayBuffer(f);
        const res = await parseKeyshotMaterialLibrary(buf);
        importKeyShot(res.materials, res.textures);
        setStatus(`已导入 ${res.materials.length} 个 KeyShot 材质${res.textures.length ? ` + ${res.textures.length} 张关联纹理` : ""}`);
      } catch (e) {
        setStatus(`KeyShot 材质库导入失败：${(e as Error).message}`);
      }
    };
    input.click();
  };

  const importTextureImages = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (!files.length) return;
      let pending = files.length;
      const added: TextureAsset[] = [];
      files.forEach((f) => {
        const reader = new FileReader();
        reader.onload = () => {
          added.push({ id: `tex_${Date.now().toString(36)}_${f.name}`, name: f.name.replace(/\.[^.]+$/, ""), src: reader.result as string, kind: "image" });
          pending--;
          if (pending === 0) {
            importKeyShot([], added);
            setStatus(`已导入 ${added.length} 张纹理到纹理库`);
          }
        };
        reader.readAsDataURL(f);
      });
    };
    input.click();
  };

  const applyMaterial = (matId: string) => {
    const st = useSceneStore.getState();
    if (selectedObjectId) {
      assignMaterial(selectedObjectId, matId);
      selectMaterial(matId);
      setActiveTab("material");
      setStatus(`材质「${st.scene.materials[matId]?.name ?? matId}」已应用到选中对象`);
    } else {
      selectMaterial(matId);
      setActiveTab("material");
      setStatus("已选中材质（在右侧面板编辑，或先选择对象再应用）");
    }
  };

  const addDemoBottle = () => {
    addObject({
      id: `obj_demo_${Date.now().toString(36)}`,
      name: "白酒瓶",
      type: "group",
      source: "builtin:demo_bottle",
      transform: { position: [0, 1.2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      materialId: null,
      visible: true,
    });
    setStatus("已添加示例白酒瓶");
  };

  /** 添加内置基础几何体 */
  const addPrimitive = (source: string, name: string, y: number) => {
    addObject({
      id: `obj_${Date.now().toString(36)}`,
      name,
      type: "mesh",
      source,
      transform: { position: [0, y, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      materialId: null,
      visible: true,
    });
    setStatus(`已添加 ${name}`);
  };

  const importFile = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".obj,.gltf,.glb,.stl,.ply,.fbx,.3dm";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        await addModelFromFile(f, setStatus);
      } catch (e) {
        setStatus(`导入失败: ${(e as Error).message}`);
      }
    };
    input.click();
  };

  const filtered = materials.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="panel" style={{ width: 252, flexShrink: 0, borderRight: "1px solid var(--border)" }}>
      <div className="tabs" style={{ height: 30, padding: "0 4px" }}>
        {LIB_TABS.map((t) => (
          <div
            key={t.id}
            className={`tab ${libraryTab === t.id ? "active" : ""}`}
            onClick={() => setLibraryTab(t.id as LibTabId)}
            title={t.label}
            style={{ padding: "0 7px" }}
          >
            {t.icon}
          </div>
        ))}
      </div>

      <div className="panel-body">
        {/* ===== 材质库 ===== */}
        {libraryTab === "materials" && (
          <>
            <div className="search">
              {ICONS.search}
              <input placeholder="搜索材质…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="lib-grid">
              {filtered.map((m) => (
                <div key={m.id} className="lib-card" onClick={() => applyMaterial(m.id)} title="点击应用到选中对象">
                  <div className="thumb">
                    <SphereThumb color={m.baseColor} metallic={m.metallic} roughness={m.roughness} />
                  </div>
                  <div className="name">{m.name.split(" ")[0]}</div>
                  <div className="sub" style={{ padding: "0 6px 5px" }}>{m.name.split(" ").slice(1).join(" ")}</div>
                </div>
              ))}
            </div>
            <button className="btn" style={{ margin: "4px 10px 12px", width: "calc(100% - 20px)" }} onClick={importKmp}>
              导入 KeyShot 材质库 (.kmp)
            </button>
          </>
        )}

        {/* ===== 颜色 ===== */}
        {libraryTab === "colors" && (
          <div className="lib-grid">
            {[
              ["#ffffff", "白"], ["#d8dae0", "浅灰"], ["#8a8d96", "中灰"], ["#33363f", "深灰"],
              ["#000000", "黑"], ["#e0605f", "红"], ["#d9a441", "金"], ["#4caf7d", "绿"],
              ["#3f8cff", "蓝"], ["#7a5cff", "紫"], ["#e8895f", "橙"], ["#c98a4b", "铜"],
            ].map(([hex, name]) => (
              <div
                key={hex} className="lib-card"
                onClick={() => {
                  const st = useSceneStore.getState();
                  const sel = st.selectedObjectId;
                  if (!sel) { setStatus("请先在场景中选择一个对象"); return; }
                  const obj = st.scene.objects.find((o) => o.id === sel);
                  const matId = obj?.materialId;
                  if (!matId) { setStatus("该对象没有材质，请先在材质库应用一个材质"); return; }
                  const r = parseInt(hex.slice(1, 3), 16) / 255;
                  const g = parseInt(hex.slice(3, 5), 16) / 255;
                  const b = parseInt(hex.slice(5, 7), 16) / 255;
                  st.updateMaterial(matId, { baseColor: [r, g, b] });
                  setStatus(`已设置颜色 ${name}`);
                }}
              >
                <div className="thumb" style={{ background: hex }} />
                <div className="name">{name}</div>
              </div>
            ))}
          </div>
        )}

        {/* ===== 纹理 ===== */}
        {libraryTab === "textures" && (
          <div style={{ padding: 10 }}>
            <p style={{ fontSize: 10.5, color: "var(--text-dim)", lineHeight: 1.6, marginBottom: 8 }}>
              点击纹理可贴到选中对象的「颜色贴图」槽；也支持批量导入本地图片到纹理库。
            </p>
            <div className="lib-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
              {BUILTIN_TEXTURES.map((t) => (
                <div
                  key={t.id} className="lib-card"
                  onClick={() => {
                    const st = useSceneStore.getState();
                    const matId = st.selectedObjectId ? st.scene.objects.find((o) => o.id === st.selectedObjectId)?.materialId : null;
                    if (!matId) { setStatus("请先选中对象并应用一个材质，再点击纹理贴图"); return; }
                    const dataUrl = generateProceduralTexture(t.kind);
                    const mat = st.scene.materials[matId];
                    if (!mat) return;
                    const maps = { ...mat.maps, color: { src: dataUrl, offset: [0, 0] as [number, number], rotation: 0, repeat: [1, 1] as [number, number] } };
                    st.updateMaterial(matId, { maps });
                    setStatus(`已应用程序化 ${t.name} 纹理到「${mat.name}」`);
                  }}
                >
                  <div className="thumb" style={{ borderBottom: "1px solid var(--border-soft)" }}>
                    <div style={{ width: "100%", height: "100%", background: t.kind === "wood" ? "linear-gradient(#6b4423,#3e2714)" : t.kind === "leather" ? "radial-gradient(#3d2118,#1f0f0b)" : "repeating-linear-gradient(45deg,#555,#333 4px)" }} />
                  </div>
                  <div className="name">{t.name}</div>
                </div>
              ))}
              {scene.textures.map((t) => (
                <div
                  key={t.id} className="lib-card"
                  title="点击贴到选中对象颜色槽"
                  onClick={() => {
                    const st = useSceneStore.getState();
                    const matId = st.selectedObjectId ? st.scene.objects.find((o) => o.id === st.selectedObjectId)?.materialId : null;
                    if (!matId) { setStatus("请先选中对象并应用一个材质，再点击纹理贴图"); return; }
                    const mat = st.scene.materials[matId];
                    if (!mat) return;
                    const maps = { ...mat.maps, color: { src: t.src, offset: [0, 0] as [number, number], rotation: 0, repeat: [1, 1] as [number, number] } };
                    st.updateMaterial(matId, { maps });
                    setStatus(`已贴纹理「${t.name}」到「${mat.name}」`);
                  }}
                >
                  <div className="thumb" style={{ borderBottom: "1px solid var(--border-soft)" }}>
                    <img src={t.src} alt={t.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                  <div className="name">{t.name}</div>
                </div>
              ))}
            </div>
            <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={importTextureImages}>
              导入纹理图片（可多选）…
            </button>
          </div>
        )}

        {/* ===== 环境 ===== */}
        {libraryTab === "environments" && (
          <>
            <div className="lib-grid">
              {ENV_PRESETS.map((env) => (
                <div
                  key={env.id} className="lib-card"
                  onClick={() => {
                    const bgColor = env.bg ?? [0.13, 0.14, 0.16];
                    if (env.hdrUrl) {
                      updateEnvironment({ preset: env.id, hdrUrl: env.hdrUrl, hdrKey: null, background: { mode: "hdr", color: bgColor } });
                    } else {
                      updateEnvironment({ preset: env.id, hdrUrl: null, hdrKey: null, background: { mode: "color", color: bgColor } });
                    }
                    setActiveTab("environment");
                    setStatus(`环境已切换：${env.name}`);
                  }}
                >
                  <div className="thumb">
                    {env.thumbUrl ? (
                      <img src={env.thumbUrl} alt={env.name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 4, display: "block" }} />
                    ) : (
                      <div className="env-thumb">
                        <div className="sky" style={{ ["--t" as string]: `rgb(${Math.round((env.bg ?? [0.3, 0.3, 0.34])[0] * 255)},${Math.round((env.bg ?? [0.3, 0.3, 0.34])[1] * 255)},${Math.round((env.bg ?? [0.3, 0.3, 0.34])[2] * 255)})`, ["--b" as string]: "#0c0d10" }} />
                        <div className="floor" />
                      </div>
                    )}
                  </div>
                  <div className="name">{env.name}</div>
                </div>
              ))}
            </div>
            <button className="btn" style={{ margin: "4px 10px 12px", width: "calc(100% - 20px)" }} onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".hdr,.exr";
              input.onchange = () => {
                const f = input.files?.[0];
                if (!f) return;
                const eng = getEngine();
                if (eng) eng.importHdrFile(f);
                setStatus(`正在加载 HDR：${f.name}`);
              };
              input.click();
            }}>
              导入 HDR 环境…
            </button>
          </>
        )}

        {/* ===== 背景 ===== */}
        {libraryTab === "backgrounds" && (
          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { mode: "hdr", label: "跟随环境 HDR" },
              { mode: "color", label: "纯色背景" },
              { mode: "transparent", label: "透明背景（出图）" },
            ].map((b) => (
              <div key={b.mode} className="lib-card" style={{ padding: "9px 10px", display: "flex", alignItems: "center", gap: 8 }}
                onClick={() => {
                  const bg = scene.environment.background;
                  updateEnvironment({ background: { ...bg, mode: b.mode as typeof bg.mode } });
                  setStatus(`背景模式：${b.label}`);
                }}>
                <div className="thumb" style={{ width: 30, height: 30, borderRadius: 3, background: b.mode === "transparent" ? "repeating-conic-gradient(#3c404a 0% 25%, #2a2d34 0% 50%) 50%/16px 16px" : b.mode === "color" ? "#22242a" : "linear-gradient(135deg,#5a6472,#1a1d22)" }} />
                <span style={{ fontSize: 11 }}>{b.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* ===== 收藏夹 ===== */}
        {libraryTab === "favorites" && (
          <div style={{ padding: 16, textAlign: "center", color: "var(--text-faint)", fontSize: 11, lineHeight: 1.8 }}>
            收藏夹为空<br />
            <span style={{ fontSize: 10 }}>右键材质/环境可加入收藏（后续版本）</span>
          </div>
        )}

        {/* ===== 模型 ===== */}
        {libraryTab === "models" && (
          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <button className="btn primary" style={{ width: "100%" }} onClick={importFile}>
              ＋ 导入模型文件
            </button>
            <div className="lib-grid">
              <div className="lib-card" onClick={addDemoBottle} title="内置示例模型">
                <div className="thumb" style={{ background: "linear-gradient(160deg,#6a7a92 0%,#2c3440 60%)", position: "relative" }}>
                  <svg viewBox="0 0 40 40" style={{ width: 26, height: 26, position: "absolute", inset: "50% auto auto 50%", transform: "translate(-50%,-50%)" }}>
                    <path d="M18 6h4v4h-4zM17 10h6l-1 10h-4zM19 20h2l1 8h-4z" fill="#aebdd6" opacity="0.9" />
                  </svg>
                </div>
                <div className="name">白酒瓶（示例）</div>
              </div>
              <div className="lib-card" onClick={() => addPrimitive("builtin:cube", "立方体", 1)} title="立方体">
                <div className="thumb" style={{ background: "linear-gradient(160deg,#5a6a7a 0%,#2a3038 60%)", position: "relative" }}>
                  <svg viewBox="0 0 40 40" style={{ width: 24, height: 24, position: "absolute", inset: "50% auto auto 50%", transform: "translate(-50%,-50%)" }}>
                    <path d="M20 8L32 14V28L20 34L8 28V14Z" fill="none" stroke="#aebdd6" strokeWidth="1.5" />
                    <path d="M20 8L20 34M8 14L32 14" stroke="#aebdd6" strokeWidth="0.8" opacity="0.5" />
                  </svg>
                </div>
                <div className="name">立方体</div>
              </div>
              <div className="lib-card" onClick={() => addPrimitive("builtin:sphere", "球体", 1.2)} title="球体">
                <div className="thumb" style={{ background: "linear-gradient(160deg,#6a7a92 0%,#2c3440 60%)", position: "relative" }}>
                  <svg viewBox="0 0 40 40" style={{ width: 24, height: 24, position: "absolute", inset: "50% auto auto 50%", transform: "translate(-50%,-50%)" }}>
                    <circle cx="20" cy="20" r="12" fill="none" stroke="#aebdd6" strokeWidth="1.5" />
                    <ellipse cx="20" cy="20" rx="12" ry="4" fill="none" stroke="#aebdd6" strokeWidth="0.8" opacity="0.5" />
                  </svg>
                </div>
                <div className="name">球体</div>
              </div>
              <div className="lib-card" onClick={() => addPrimitive("builtin:cylinder", "圆柱", 1.25)} title="圆柱">
                <div className="thumb" style={{ background: "linear-gradient(160deg,#5a6a7a 0%,#2a3038 60%)", position: "relative" }}>
                  <svg viewBox="0 0 40 40" style={{ width: 24, height: 24, position: "absolute", inset: "50% auto auto 50%", transform: "translate(-50%,-50%)" }}>
                    <ellipse cx="20" cy="10" rx="10" ry="3" fill="none" stroke="#aebdd6" strokeWidth="1.5" />
                    <path d="M10 10V30M30 10V30" stroke="#aebdd6" strokeWidth="1.5" />
                    <ellipse cx="20" cy="30" rx="10" ry="3" fill="none" stroke="#aebdd6" strokeWidth="1.5" />
                  </svg>
                </div>
                <div className="name">圆柱</div>
              </div>
              <div className="lib-card" onClick={() => addPrimitive("builtin:plane", "平面", 0)} title="平面">
                <div className="thumb" style={{ background: "linear-gradient(160deg,#5a6a7a 0%,#2a3038 60%)", position: "relative" }}>
                  <svg viewBox="0 0 40 40" style={{ width: 24, height: 24, position: "absolute", inset: "50% auto auto 50%", transform: "translate(-50%,-50%)" }}>
                    <path d="M8 28L20 12L32 28L20 32Z" fill="none" stroke="#aebdd6" strokeWidth="1.5" />
                  </svg>
                </div>
                <div className="name">平面</div>
              </div>
              <div className="lib-card" onClick={() => addPrimitive("builtin:torus", "圆环", 1)} title="圆环">
                <div className="thumb" style={{ background: "linear-gradient(160deg,#6a7a92 0%,#2c3440 60%)", position: "relative" }}>
                  <svg viewBox="0 0 40 40" style={{ width: 24, height: 24, position: "absolute", inset: "50% auto auto 50%", transform: "translate(-50%,-50%)" }}>
                    <ellipse cx="20" cy="20" rx="13" ry="6" fill="none" stroke="#aebdd6" strokeWidth="1.5" />
                    <ellipse cx="20" cy="20" rx="6" ry="2.5" fill="none" stroke="#aebdd6" strokeWidth="1" opacity="0.5" />
                  </svg>
                </div>
                <div className="name">圆环</div>
              </div>
            </div>
            <p style={{ fontSize: 10, color: "var(--text-faint)", lineHeight: 1.6, marginTop: 4 }}>
              支持格式：OBJ / GLTF / GLB / STL / PLY / FBX / 3DM（Rhino）<br />
              拖拽文件到视口即可导入
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
