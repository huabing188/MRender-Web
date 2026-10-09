// 右侧项目面板：六页签（场景 / 材质 / 环境 / 照明 / 相机 / 图像）
import React from "react";
import { useSceneStore } from "../store/sceneStore";
import { ICONS, Section, SliderRow, ToggleRow, ColorRow, SelectRow, NumberRow, GroupLabel } from "./common";
import { ENV_PRESETS, BUILTIN_MATERIALS, MATERIAL_TYPES } from "../core/defaultScene";
import type { LabelData } from "../core/types";
import { getEngine } from "./engineBridge";

const TABS = [
  { id: "scene", label: "场景", icon: ICONS.cube },
  { id: "material", label: "材质", icon: ICONS.palette },
  { id: "environment", label: "环境", icon: ICONS.sun },
  { id: "light", label: "照明", icon: ICONS.light },
  { id: "camera", label: "相机", icon: ICONS.camera },
  { id: "image", label: "图像", icon: ICONS.image },
] as const;

export function ProjectPanel() {
  const activeTab = useSceneStore((s) => s.activeTab);
  return (
    <div className="panel" style={{ width: 318, flexShrink: 0, borderLeft: "1px solid var(--border)" }}>
      <div className="tabs">
        {TABS.map((t) => (
          <div key={t.id} className={`tab ${activeTab === t.id ? "active" : ""}`} onClick={() => useSceneStore.getState().setActiveTab(t.id as typeof activeTab)}>
            {t.icon}
            <span style={{ marginLeft: 4 }}>{t.label}</span>
          </div>
        ))}
      </div>
      <div className="panel-body">
        {activeTab === "scene" && <SceneTab />}
        {activeTab === "material" && <MaterialTab />}
        {activeTab === "environment" && <EnvironmentTab />}
        {activeTab === "light" && <LightTab />}
        {activeTab === "camera" && <CameraTab />}
        {activeTab === "image" && <ImageTab />}
      </div>
    </div>
  );
}

/* ================= 场景页签（Outliner 场景树） ================= */
function SceneTab() {
  const scene = useSceneStore((s) => s.scene);
  const selectedObjectId = useSceneStore((s) => s.selectedObjectId);
  const selectObject = useSceneStore((s) => s.selectObject);
  const removeObject = useSceneStore((s) => s.removeObject);
  const updateObject = useSceneStore((s) => s.updateObject);
  const setGizmoMode = useSceneStore((s) => s.setGizmoMode);
  const gizmoMode = useSceneStore((s) => s.gizmoMode);

  const onSelect = (id: string) => {
    selectObject(id);
    const mode = useSceneStore.getState().gizmoMode;
    getEngine()?.setGizmoMode(mode, id);
  };

  const selectedObj = scene.objects.find((o) => o.id === selectedObjectId);

  return (
    <>
      <div className="row" style={{ padding: "8px 10px 4px" }}>
        <span className="label" style={{ fontWeight: 600, color: "var(--text)" }}>场景层级</span>
        <button className="btn small" onClick={() => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".obj,.gltf,.glb,.stl,.ply,.fbx,.3dm";
          input.onchange = async () => {
            const f = input.files?.[0];
            if (!f) return;
            try {
              const { addModelFromFile } = await import("../engine/ThreeEngine");
              await addModelFromFile(f, (msg) => useSceneStore.getState().setStatus(msg));
            } catch (e) {
              useSceneStore.getState().setStatus(`导入失败: ${(e as Error).message}`);
            }
          };
          input.click();
        }}>导入</button>
      </div>
      <div style={{ padding: "2px 0 8px" }}>
        {scene.objects.map((o) => (
          <OutlinerRow
            key={o.id}
            id={o.id}
            name={o.name}
            depth={0}
            selected={selectedObjectId === o.id}
            visible={o.visible}
            badge={o.source === "builtin:demo_bottle" ? "示例" : o.source ? "模型" : undefined}
            onSelect={() => onSelect(o.id)}
            onToggleVisible={() => updateObject(o.id, { visible: !o.visible })}
            onRemove={() => { removeObject(o.id); getEngine()?.setGizmoMode("off"); }}
          />
        ))}
        {scene.objects.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 11 }}>
            场景为空<br />导入模型或添加示例对象
          </div>
        )}
      </div>

      {/* 选中对象的变换控制 */}
      {selectedObj && (
        <>
          <Section title={`变换 — ${selectedObj.name}`} defaultOpen={true}>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <button className={`btn small ${gizmoMode === "translate" ? "primary" : ""}`} onClick={() => { setGizmoMode("translate"); getEngine()?.setGizmoMode("translate", selectedObj.id); }}>✥ 移动</button>
              <button className={`btn small ${gizmoMode === "rotate" ? "primary" : ""}`} onClick={() => { setGizmoMode("rotate"); getEngine()?.setGizmoMode("rotate", selectedObj.id); }}>↻ 旋转</button>
              <button className={`btn small ${gizmoMode === "scale" ? "primary" : ""}`} onClick={() => { setGizmoMode("scale"); getEngine()?.setGizmoMode("scale", selectedObj.id); }}>⬒ 缩放</button>
              <button className={`btn small ${gizmoMode === "off" ? "primary" : ""}`} onClick={() => { setGizmoMode("off"); getEngine()?.setGizmoMode("off"); }}>关闭</button>
            </div>
            <GroupLabel text="位置（mm）" />
            <NumberRow label="X" value={selectedObj.transform.position[0]} step={1} onChange={(v) => updateObject(selectedObj.id, { transform: { ...selectedObj.transform, position: [v, selectedObj.transform.position[1], selectedObj.transform.position[2]] } })} />
            <NumberRow label="Y" value={selectedObj.transform.position[1]} step={1} onChange={(v) => updateObject(selectedObj.id, { transform: { ...selectedObj.transform, position: [selectedObj.transform.position[0], v, selectedObj.transform.position[2]] } })} />
            <NumberRow label="Z" value={selectedObj.transform.position[2]} step={1} onChange={(v) => updateObject(selectedObj.id, { transform: { ...selectedObj.transform, position: [selectedObj.transform.position[0], selectedObj.transform.position[1], v] } })} />
            <GroupLabel text="旋转 (°)" />
            <NumberRow label="X" value={selectedObj.transform.rotation[0]} step={1} onChange={(v) => updateObject(selectedObj.id, { transform: { ...selectedObj.transform, rotation: [v, selectedObj.transform.rotation[1], selectedObj.transform.rotation[2]] } })} />
            <NumberRow label="Y" value={selectedObj.transform.rotation[1]} step={1} onChange={(v) => updateObject(selectedObj.id, { transform: { ...selectedObj.transform, rotation: [selectedObj.transform.rotation[0], v, selectedObj.transform.rotation[2]] } })} />
            <NumberRow label="Z" value={selectedObj.transform.rotation[2]} step={1} onChange={(v) => updateObject(selectedObj.id, { transform: { ...selectedObj.transform, rotation: [selectedObj.transform.rotation[0], selectedObj.transform.rotation[1], v] } })} />
            <GroupLabel text="缩放" />
            <NumberRow label="X" value={selectedObj.transform.scale[0]} step={0.1} onChange={(v) => updateObject(selectedObj.id, { transform: { ...selectedObj.transform, scale: [v, selectedObj.transform.scale[1], selectedObj.transform.scale[2]] } })} />
            <NumberRow label="Y" value={selectedObj.transform.scale[1]} step={0.1} onChange={(v) => updateObject(selectedObj.id, { transform: { ...selectedObj.transform, scale: [selectedObj.transform.scale[0], v, selectedObj.transform.scale[2]] } })} />
            <NumberRow label="Z" value={selectedObj.transform.scale[2]} step={0.1} onChange={(v) => updateObject(selectedObj.id, { transform: { ...selectedObj.transform, scale: [selectedObj.transform.scale[0], selectedObj.transform.scale[1], v] } })} />
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn small" style={{ color: "var(--text-faint)" }} onClick={() => updateObject(selectedObj.id, { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } })}>重置变换</button>
              <button className="btn small" style={{ color: "var(--text-faint)" }} onClick={async () => {
                const eng = getEngine();
                if (!eng) return;
                const res = await eng.ungroupObject(selectedObj.id);
                if (res.ok) {
                  useSceneStore.getState().setStatus(res.message);
                } else {
                  useSceneStore.getState().setStatus(res.message);
                }
              }}>打散物件</button>
              {/* 打散后引擎会选中第一个部件，这里不再取消选中，方便继续操作 */}
            </div>
          </Section>
        </>
      )}

      {/* 灯光/相机在场景树下的分组（只读列表） */}
      <GroupLabel text="灯光与相机" />
      {scene.lights.map((l) => (
        <OutlinerRow
          key={l.id} id={l.id} name={l.name} depth={0} selected={false} visible={l.visible}
          badge={l.type} onSelect={() => { useSceneStore.getState().setActiveTab("light"); }} onToggleVisible={() => useSceneStore.getState().updateLight(l.id, { visible: !l.visible })} onRemove={() => useSceneStore.getState().removeLight(l.id)} icon={ICONS.light}
        />
      ))}
    </>
  );
}

function OutlinerRow({ id, name, depth, selected, visible, badge, onSelect, onToggleVisible, onRemove, icon }: {
  id: string; name: string; depth: number; selected: boolean; visible: boolean;
  badge?: string; onSelect: () => void; onToggleVisible: () => void; onRemove: () => void; icon?: React.ReactNode;
}) {
  return (
    <div className={`outliner-row ${selected ? "selected" : ""}`} onClick={onSelect}>
      {Array.from({ length: depth }).map((_, i) => <div key={i} className="tree-indent" />)}
      <span className="tree-arrow">▸</span>
      <span className="ico">{icon ?? ICONS.cube}</span>
      <span className="t-name">{name}</span>
      {badge && <span className="t-badge">{badge}</span>}
      <span className="ico" style={{ cursor: "pointer" }} title={visible ? "隐藏" : "显示"} onClick={(e) => { e.stopPropagation(); onToggleVisible(); }}>
        <span style={{ opacity: visible ? 1 : 0.35 }}>{ICONS.eye}</span>
      </span>
      <span className="ico" style={{ cursor: "pointer" }} title="删除" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
        {ICONS.trash}
      </span>
    </div>
  );
}

/* ================= 材质页签 ================= */
function MaterialTab() {
  const scene = useSceneStore((s) => s.scene);
  const selectedObjectId = useSceneStore((s) => s.selectedObjectId);
  const updateMaterial = useSceneStore((s) => s.updateMaterial);
  const assignMaterial = useSceneStore((s) => s.assignMaterial);
  const selectedMaterialId = useSceneStore((s) => s.selectedMaterialId);

  const selectedObj = scene.objects.find((o) => o.id === selectedObjectId);
  const matId = selectedObj?.materialId ?? selectedMaterialId;
  const mat = matId ? scene.materials[matId] : null;

  const allSlots = ["color", "normal", "roughnessMap", "metallicMap", "bumpMap", "emissiveMap", "opacityMap"] as const;
  const slotLabels: Record<string, string> = {
    color: "颜色贴图", normal: "法线贴图", roughnessMap: "粗糙度贴图", metallicMap: "金属度贴图",
    bumpMap: "凹凸贴图", emissiveMap: "发光贴图", opacityMap: "不透明度贴图",
  };

  return (
    <>
      <Section title="材质图" defaultOpen={true}>
        <div className="row">
          <span className="label">对象</span>
          <select value={selectedObjectId ?? ""} onChange={(e) => { useSceneStore.getState().selectObject(e.target.value || null); }} style={{ flex: 1, maxWidth: "none" }}>
            <option value="">— 未选择 —</option>
            {scene.objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div className="row">
          <span className="label">材质</span>
          <select value={matId ?? ""} onChange={(e) => { if (selectedObjectId) assignMaterial(selectedObjectId, e.target.value || null); }} style={{ flex: 1, maxWidth: "none" }}>
            <option value="">— 无 —</option>
            {Object.values(scene.materials).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {selectedObjectId && !mat && <p style={{ fontSize: 10.5, color: "var(--yellow)", margin: "4px 0" }}>该对象暂无材质，请从左侧材质库选择一个</p>}
      </Section>

      {mat && (
        <>
          <Section title={`属性 — ${mat.name}`} defaultOpen={true}>
            <SelectRow label="材质类型" value={mat.type} options={MATERIAL_TYPES} onChange={(v) => updateMaterial(mat.id, { type: v as typeof mat.type })} />
            <ColorRow label="基础颜色" value={mat.baseColor} onChange={(v) => updateMaterial(mat.id, { baseColor: v })} />
            <SliderRow label="金属度" value={mat.metallic} min={0} max={1} onChange={(v) => updateMaterial(mat.id, { metallic: v })} />
            <SliderRow label="粗糙度" value={mat.roughness} min={0} max={1} onChange={(v) => updateMaterial(mat.id, { roughness: v })} />
            <SliderRow label="透射" value={mat.transmission} min={0} max={1} onChange={(v) => updateMaterial(mat.id, { transmission: v })} />
            <SliderRow label="折射率 IOR" value={mat.ior} min={1} max={2.5} onChange={(v) => updateMaterial(mat.id, { ior: v })} />
            <SliderRow label="厚度(体积)" value={mat.thickness} min={0} max={3} step={0.01} onChange={(v) => updateMaterial(mat.id, { thickness: v })} />
          </Section>

          <Section title="漆面 / 涂层" defaultOpen={false}>
            <SliderRow label="清漆强度" value={mat.clearcoat} min={0} max={1} onChange={(v) => updateMaterial(mat.id, { clearcoat: v })} />
            <SliderRow label="清漆粗糙度" value={mat.clearcoatRoughness} min={0} max={1} onChange={(v) => updateMaterial(mat.id, { clearcoatRoughness: v })} />
          </Section>

          <Section title="高级光学" defaultOpen={false}>
            <SliderRow label="各向异性" value={mat.anisotropy} min={0} max={1} onChange={(v) => updateMaterial(mat.id, { anisotropy: v })} />
            <SliderRow label="色散(棱镜)" value={mat.dispersion} min={0} max={1} step={0.005} onChange={(v) => updateMaterial(mat.id, { dispersion: v })} />
            <ColorRow label="光吸收色" value={mat.attenuationColor} onChange={(v) => updateMaterial(mat.id, { attenuationColor: v })} />
            <SliderRow label="吸收距离" value={mat.attenuationDistance} min={0.01} max={10} step={0.01} onChange={(v) => updateMaterial(mat.id, { attenuationDistance: v })} />
            <SliderRow label="镜面强度" value={mat.specularIntensity} min={0} max={1} onChange={(v) => updateMaterial(mat.id, { specularIntensity: v })} />
            <ColorRow label="镜面色" value={mat.specularColor} onChange={(v) => updateMaterial(mat.id, { specularColor: v })} />
          </Section>

          <Section title="织物 / Sheen" defaultOpen={false}>
            <SliderRow label="Sheen 强度" value={mat.sheen} min={0} max={1} onChange={(v) => updateMaterial(mat.id, { sheen: v })} />
            <ColorRow label="Sheen 色" value={mat.sheenColor} onChange={(v) => updateMaterial(mat.id, { sheenColor: v })} />
            <SliderRow label="Sheen 粗糙度" value={mat.sheenRoughness} min={0} max={1} onChange={(v) => updateMaterial(mat.id, { sheenRoughness: v })} />
          </Section>

          <Section title="自发光">
            <ColorRow label="发光色" value={mat.emissive} onChange={(v) => updateMaterial(mat.id, { emissive: v })} />
            <SliderRow label="强度" value={mat.emissiveIntensity} min={0} max={10} onChange={(v) => updateMaterial(mat.id, { emissiveIntensity: v })} />
          </Section>

          <Section title="基础属性" defaultOpen={false}>
            <SliderRow label="不透明度" value={mat.opacity} min={0} max={1} onChange={(v) => updateMaterial(mat.id, { opacity: v })} />
            <SelectRow label="双面渲染" value={mat.side} options={[{ value: "front", label: "单面" }, { value: "double", label: "双面" }]} onChange={(v) => updateMaterial(mat.id, { side: v as "front" | "double" })} />
            <SliderRow label="凹凸强度" value={mat.bumpScale} min={0} max={3} step={0.01} onChange={(v) => updateMaterial(mat.id, { bumpScale: v })} />
            <SliderRow label="位移强度" value={mat.displacementScale} min={0} max={2} step={0.01} onChange={(v) => updateMaterial(mat.id, { displacementScale: v })} />
          </Section>

          <Section title="纹理贴图" defaultOpen={false}>
            {allSlots.map((slot) => {
              const s = mat.maps[slot];
              const updateSlot = (patch: Partial<typeof s>) => {
                const maps = { ...mat.maps, [slot]: { ...s, ...patch } as typeof s };
                updateMaterial(mat.id, { maps });
              };
              return (
                <div key={slot} style={{ marginBottom: 8 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="label">{slotLabels[slot]}</span>
                    <div className="tex-slot" style={{ flex: 1, height: 34 }} onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file"; input.accept = "image/*";
                      input.onchange = () => {
                        const f = input.files?.[0]; if (!f) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          const maps = { ...mat.maps, [slot]: { src: reader.result as string, offset: [0, 0] as [number, number], rotation: 0, repeat: [1, 1] as [number, number] } };
                          updateMaterial(mat.id, { maps });
                        };
                        reader.readAsDataURL(f);
                      };
                      input.click();
                    }}>
                      {s?.src ? <img src={s.src} alt="" /> : "＋ 添加"}
                    </div>
                    {s?.src && <span className="ico" style={{ cursor: "pointer" }} title="清除" onClick={() => { const maps = { ...mat.maps, [slot]: null }; updateMaterial(mat.id, { maps }); }}>{ICONS.trash}</span>}
                  </div>
                  {s?.src && (
                    <div style={{ paddingLeft: 4, paddingTop: 4 }}>
                      <SliderRow label="U 缩放" value={s.repeat[0]} min={0.1} max={10} step={0.1} onChange={(v) => updateSlot({ repeat: [v, s.repeat[1]] })} />
                      <SliderRow label="V 缩放" value={s.repeat[1]} min={0.1} max={10} step={0.1} onChange={(v) => updateSlot({ repeat: [s.repeat[0], v] })} />
                      <SliderRow label="U 偏移" value={s.offset[0]} min={-2} max={2} step={0.01} onChange={(v) => updateSlot({ offset: [v, s.offset[1]] })} />
                      <SliderRow label="V 偏移" value={s.offset[1]} min={-2} max={2} step={0.01} onChange={(v) => updateSlot({ offset: [s.offset[0], v] })} />
                      <SliderRow label="旋转" value={s.rotation} min={0} max={6.28} step={0.05} unit="rad" onChange={(v) => updateSlot({ rotation: v })} />
                    </div>
                  )}
                </div>
              );
            })}
          </Section>

          {selectedObj && <LabelSection objectId={selectedObj.id} labels={selectedObj.labels ?? []} />}
        </>
      )}
    </>
  );
}

/* ================= 标签系统 ================= */
function LabelSection({ objectId, labels }: { objectId: string; labels: LabelData[] }) {
  const addLabel = useSceneStore((s) => s.addLabel);
  const updateLabel = useSceneStore((s) => s.updateLabel);
  const removeLabel = useSceneStore((s) => s.removeLabel);

  const handleAdd = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = () => {
      const f = input.files?.[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const lb: LabelData = {
          id: `lb_${Date.now().toString(36)}`,
          name: f.name.replace(/\.[^.]+$/, ""),
          src: reader.result as string,
          position: [0.5, 0.5], scale: [0.4, 0.4],
          rotation: 0, opacity: 1, doubleSide: false, materialId: null,
        };
        addLabel(objectId, lb);
      };
      reader.readAsDataURL(f);
    };
    input.click();
  };

  return (
    <Section title={`标签 (${labels.length})`} defaultOpen={false}>
      <div className="row"><button className="btn small" style={{ flex: 1 }} onClick={handleAdd}>＋ 添加标签贴图</button></div>
      {labels.map((lb) => (
        <div key={lb.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 6, marginTop: 6 }}>
          <div className="row">
            <span className="label" style={{ fontWeight: 600 }}>{lb.name}</span>
            <span className="ico" style={{ cursor: "pointer" }} title="删除" onClick={() => removeLabel(objectId, lb.id)}>{ICONS.trash}</span>
          </div>
          <div style={{ display: "flex", gap: 8, margin: "4px 0" }}>
            {lb.src && <img src={lb.src} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 4, border: "1px solid var(--border)" }} />}
          </div>
          <SliderRow label="U 位置" value={lb.position[0]} min={0} max={1} step={0.01} onChange={(v) => updateLabel(objectId, lb.id, { position: [v, lb.position[1]] })} />
          <SliderRow label="V 位置" value={lb.position[1]} min={0} max={1} step={0.01} onChange={(v) => updateLabel(objectId, lb.id, { position: [lb.position[0], v] })} />
          <SliderRow label="U 缩放" value={lb.scale[0]} min={0.05} max={2} step={0.01} onChange={(v) => updateLabel(objectId, lb.id, { scale: [v, lb.scale[1]] })} />
          <SliderRow label="V 缩放" value={lb.scale[1]} min={0.05} max={2} step={0.01} onChange={(v) => updateLabel(objectId, lb.id, { scale: [lb.scale[0], v] })} />
          <SliderRow label="旋转" value={lb.rotation} min={0} max={6.28} step={0.05} unit="rad" onChange={(v) => updateLabel(objectId, lb.id, { rotation: v })} />
          <SliderRow label="不透明度" value={lb.opacity} min={0} max={1} onChange={(v) => updateLabel(objectId, lb.id, { opacity: v })} />
          <ToggleRow label="双面" value={lb.doubleSide} onChange={(v) => updateLabel(objectId, lb.id, { doubleSide: v })} />
        </div>
      ))}
      {labels.length === 0 && <p style={{ fontSize: 10, color: "var(--text-faint)", textAlign: "center", padding: 8 }}>添加标签贴图到物件表面（如酒标、Logo）</p>}
    </Section>
  );
}

/* ================= 环境页签 ================= */
function EnvironmentTab() {
  const env = useSceneStore((s) => s.scene.environment);
  const customEnvs = useSceneStore((s) => s.scene.customEnvironments);
  const lightPins = useSceneStore((s) => s.scene.lightPins);
  const updateEnvironment = useSceneStore((s) => s.updateEnvironment);
  const addCustomEnvironment = useSceneStore((s) => s.addCustomEnvironment);
  const removeCustomEnvironment = useSceneStore((s) => s.removeCustomEnvironment);
  const addLightPin = useSceneStore((s) => s.addLightPin);
  const updateLightPin = useSceneStore((s) => s.updateLightPin);
  const removeLightPin = useSceneStore((s) => s.removeLightPin);
  const [selPin, setSelPin] = React.useState<string | null>(null);

  const isSelected = (id: string, hdrKey?: string | null) => {
    if (hdrKey) return env.hdrKey === hdrKey;
    return env.preset === id && !env.hdrKey;
  };

  const applyPreset = (id: string) => updateEnvironment({ preset: id, hdrKey: null, hdrUrl: null });
  const applyCustom = (ce: typeof customEnvs[number]) => updateEnvironment({ preset: "custom", hdrKey: ce.src, hdrUrl: null });

  const importHdr = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".hdr,.exr";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const src = reader.result as string;
        addCustomEnvironment({
          id: `env_${Date.now().toString(36)}`,
          name: file.name.replace(/\.[^.]+$/, ""),
          src,
          thumbnail: null,
        });
        updateEnvironment({ preset: "custom", hdrKey: src, hdrUrl: null });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const curPreset = ENV_PRESETS.find((p) => p.id === env.preset);
  const curCustom = env.hdrKey ? customEnvs.find((c) => c.src === env.hdrKey) : undefined;
  const curThumb = curCustom?.thumbnail || curPreset?.thumbUrl || null;
  const curName = curCustom?.name || curPreset?.name || env.preset;

  const addPin = () => {
    const id = `pin_${Date.now().toString(36)}`;
    addLightPin({
      id, name: `灯光针 ${lightPins.length + 1}`, shape: "circular",
      azimuth: 90, elevation: 35, brightness: 14, color: [1, 1, 1],
      size: 150, falloff: 0.5, half: false, image: null,
    });
    setSelPin(id);
  };

  const sel = lightPins.find((p) => p.id === selPin) || null;

  return (
    <>
      {/* 当前环境预览 + 名称（左栏缩略图 + 右栏参数 的核心对应） */}
      <div style={{ display: "flex", gap: 10, padding: "4px 12px 10px" }}>
        <div style={{ width: 96, height: 60, borderRadius: 6, overflow: "hidden", flexShrink: 0, border: "1px solid var(--border)", background: "#0c0d10" }}>
          {curThumb ? <img src={curThumb} alt={curName} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            : <div style={{ width: "100%", height: "100%", background: curPreset?.bg ? `linear-gradient(180deg, rgb(${(curPreset.bg[0] * 255) | 0},${(curPreset.bg[1] * 255) | 0},${(curPreset.bg[2] * 255) | 0}), #111)` : "#1a1d22" }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{curName}</div>
          <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>IBL 环境 · 强度 {env.intensity.toFixed(2)} · 旋转 {env.rotation.toFixed(0)}°</div>
        </div>
      </div>

      <Section title="环境调整" defaultOpen={true}>
        <SliderRow label="亮度 Brightness" value={env.brightness} min={0} max={3} step={0.05} onChange={(v) => updateEnvironment({ brightness: v, intensity: v })} />
        <SliderRow label="对比度 Contrast" value={env.contrast} min={0.2} max={3} step={0.05} onChange={(v) => updateEnvironment({ contrast: v })} />
        <SliderRow label="旋转 Rotation" value={env.rotation} min={0} max={360} step={1} unit="°" onChange={(v) => updateEnvironment({ rotation: v })} />
        <SliderRow label="高度 Height" value={env.height} min={-45} max={45} step={1} unit="°" onChange={(v) => updateEnvironment({ height: v })} />
        <SliderRow label="尺寸 Size" value={env.size} min={0.3} max={3} step={0.05} onChange={(v) => updateEnvironment({ size: v })} />
      </Section>

      <Section title="内置环境" defaultOpen={true}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          {ENV_PRESETS.map((p) => (
            <button
              key={p.id}
              className="env-card"
              onClick={() => applyPreset(p.id)}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                padding: 8, border: "1px solid var(--border)", borderRadius: 6,
                background: isSelected(p.id) ? "var(--accent)" : "var(--panel-bg)",
                color: isSelected(p.id) ? "#fff" : "var(--text)", cursor: "pointer",
              }}
            >
              <div style={{ width: "100%", height: 40, borderRadius: 4, overflow: "hidden" }}>
                {p.thumbUrl ? (
                  <img src={p.thumbUrl} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                ) : (
                  <div style={{ width: "100%", height: "100%", background: p.bg ? `linear-gradient(180deg, rgb(${(p.bg[0] * 255) | 0},${(p.bg[1] * 255) | 0},${(p.bg[2] * 255) | 0}), #111)` : "linear-gradient(180deg, #4a505a, #202329)" }} />
                )}
              </div>
              <span style={{ fontSize: 11, textAlign: "center" }}>{p.name}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="自定义 HDR" defaultOpen={false}>
        <button className="btn small" onClick={importHdr} style={{ width: "100%", marginBottom: 8 }}>＋ 导入 HDR / EXR</button>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {customEnvs.map((ce) => (
            <div
              key={ce.id}
              onClick={() => applyCustom(ce)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: 8,
                border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer",
                background: isSelected("custom", ce.src) ? "rgba(43, 214, 255, 0.12)" : "var(--panel-bg)",
              }}
            >
              <div style={{
                width: 48, height: 36, borderRadius: 4, flexShrink: 0,
                background: ce.thumbnail || "linear-gradient(135deg, #3a4a5a, #1a222a)",
                backgroundSize: "cover",
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ce.name}</div>
                <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{Math.round(ce.src.length / 1024)} KB</div>
              </div>
              <button
                className="btn tiny danger"
                onClick={(e) => { e.stopPropagation(); removeCustomEnvironment(ce.id); }}
                title="删除"
              >×</button>
            </div>
          ))}
          {customEnvs.length === 0 && (
            <p style={{ fontSize: 11, color: "var(--text-faint)", margin: 0 }}>暂无自定义 HDR，点击上方按钮导入</p>
          )}
        </div>
      </Section>

      <Section title="背景">
        <SelectRow
          label="背景模式"
          value={env.background.mode}
          options={[{ value: "hdr", label: "跟随环境" }, { value: "color", label: "纯色" }, { value: "transparent", label: "透明（出图）" }]}
          onChange={(v) => updateEnvironment({ background: { ...env.background, mode: v as typeof env.background.mode } })}
        />
        {env.background.mode === "color" && (
          <ColorRow label="背景色" value={env.background.color} onChange={(v) => updateEnvironment({ background: { ...env.background, color: v } })} />
        )}
      </Section>

      <Section title="地面">
        <ToggleRow label="显示地面" value={env.ground.enabled} onChange={(v) => updateEnvironment({ ground: { ...env.ground, enabled: v } })} />
        <ToggleRow label="接收阴影" value={env.ground.shadow} onChange={(v) => updateEnvironment({ ground: { ...env.ground, shadow: v } })} />
        <ToggleRow label="地面反射" value={env.ground.reflection} onChange={(v) => updateEnvironment({ ground: { ...env.ground, reflection: v } })} />
        <ToggleRow label="压平地面" value={env.ground.flatten} onChange={(v) => updateEnvironment({ ground: { ...env.ground, flatten: v } })} />
        <SliderRow label="地面尺寸" value={env.ground.size} min={100} max={3000} step={50} unit="mm" onChange={(v) => updateEnvironment({ ground: { ...env.ground, size: v } })} />
        <ColorRow label="地面颜色" value={env.ground.color} onChange={(v) => updateEnvironment({ ground: { ...env.ground, color: v } })} />
      </Section>

      {/* ===== KeyShot 式灯光针 ===== */}
      <Section title="灯光针 Light Pins" defaultOpen={true}>
        <button className="btn small" onClick={addPin} style={{ width: "100%", marginBottom: 8 }}>＋ 添加灯光针（圆形）</button>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {lightPins.map((p) => (
            <div
              key={p.id}
              onClick={() => setSelPin(p.id)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: 8,
                border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer",
                background: selPin === p.id ? "rgba(43, 214, 255, 0.12)" : "var(--panel-bg)",
              }}
            >
              <div style={{ width: 18, height: 18, borderRadius: p.shape === "circular" ? "50%" : 3, background: `rgb(${(p.color[0] * 255) | 0},${(p.color[1] * 255) | 0},${(p.color[2] * 255) | 0})`, boxShadow: "0 0 6px rgba(255,255,255,0.4)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{p.shape === "circular" ? "圆形" : p.shape === "rectangular" ? "矩形" : "图像"} · 亮度 {p.brightness.toFixed(0)}</div>
              </div>
              <button
                className="btn tiny danger"
                onClick={(e) => { e.stopPropagation(); removeLightPin(p.id); if (selPin === p.id) setSelPin(null); }}
                title="删除"
              >×</button>
            </div>
          ))}
          {lightPins.length === 0 && (
            <p style={{ fontSize: 11, color: "var(--text-faint)", margin: 0 }}>暂无灯光针。灯光针是放在环境球上的可调光源（方位角/高度角/亮度/颜色），实时改变照明。</p>
          )}
        </div>

        {sel && (
          <div style={{ marginTop: 10, padding: 10, border: "1px solid var(--border)", borderRadius: 6, background: "var(--panel-bg-2, #1a1d22)" }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{sel.name} 参数</div>
            <SelectRow
              label="形状"
              value={sel.shape}
              options={[{ value: "circular", label: "圆形" }, { value: "rectangular", label: "矩形" }, { value: "image", label: "图像" }]}
              onChange={(v) => updateLightPin(sel.id, { shape: v as typeof sel.shape })}
            />
            <SliderRow label="方位角 Azimuth" value={sel.azimuth} min={0} max={360} step={1} unit="°" onChange={(v) => updateLightPin(sel.id, { azimuth: v })} />
            <SliderRow label="高度角 Elevation" value={sel.elevation} min={-90} max={90} step={1} unit="°" onChange={(v) => updateLightPin(sel.id, { elevation: v })} />
            <SliderRow label="亮度 Brightness" value={sel.brightness} min={0} max={50} step={0.5} onChange={(v) => updateLightPin(sel.id, { brightness: v })} />
            <SliderRow label="尺寸 Size" value={sel.size} min={10} max={600} step={5} unit="mm" onChange={(v) => updateLightPin(sel.id, { size: v })} />
            <SliderRow label="衰减 Falloff" value={sel.falloff} min={0} max={1} step={0.05} onChange={(v) => updateLightPin(sel.id, { falloff: v })} />
            <ColorRow label="颜色 Color" value={sel.color} onChange={(v) => updateLightPin(sel.id, { color: v })} />
            <ToggleRow label="半切 Half" value={sel.half} onChange={(v) => updateLightPin(sel.id, { half: v })} />
          </div>
        )}
      </Section>
    </>
  );
}

/* ================= 照明页签 ================= */
function LightTab() {
  const lights = useSceneStore((s) => s.scene.lights);
  const addLight = useSceneStore((s) => s.addLight);
  const removeLight = useSceneStore((s) => s.removeLight);
  const updateLight = useSceneStore((s) => s.updateLight);

  const showLightHelpers = useSceneStore((s) => s.showLightHelpers);

  const addLightOfType = (type: "area" | "point" | "spot" | "sun") => {
    const names = { area: "区域光", point: "点光源", spot: "聚光灯", sun: "太阳光" };
    addLight({
      id: `light_${Date.now().toString(36)}`,
      name: `新建${names[type]}`,
      type,
      position: [150, 200, 200],
      target: [0, 100, 0],
      intensity: type === "area" ? 8 : type === "point" ? 5 : type === "sun" ? 2 : 10,
      color: [1, 1, 1],
      size: [80, 80],
      angle: 30,
      penumbra: 0.3,
      visible: true,
    });
  };

  return (
    <>
      <Section title="显示" defaultOpen={true}>
        <ToggleRow label="显示灯光辅助体" value={showLightHelpers} onChange={(v) => getEngine()?.setShowLightHelpers(v)} />
        <p style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 4 }}>关闭后画面不再显示灰色框，灯光仍然正常生效</p>
      </Section>
      <Section title="预设" defaultOpen={true}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button className="btn small" onClick={() => addLightOfType("area")}>＋ 区域光</button>
          <button className="btn small" onClick={() => addLightOfType("point")}>＋ 点光源</button>
          <button className="btn small" onClick={() => addLightOfType("spot")}>＋ 聚光灯</button>
          <button className="btn small" onClick={() => addLightOfType("sun")}>＋ 太阳光</button>
        </div>
      </Section>
      {lights.map((l) => (
        <Section key={l.id} title={`${l.name}（${l.type === "area" ? "区域" : l.type === "point" ? "点光" : l.type === "spot" ? "聚光" : "太阳"}）`} defaultOpen={false} badge={l.visible ? "" : "隐藏"}>
          <ToggleRow label="启用" value={l.visible} onChange={(v) => updateLight(l.id, { visible: v })} />
          <ColorRow label="颜色" value={l.color} onChange={(v) => updateLight(l.id, { color: v })} />
          <SliderRow label="强度" value={l.intensity} min={0} max={50} onChange={(v) => updateLight(l.id, { intensity: v })} />
          <GroupLabel text="位置（mm）" />
          <NumberRow label="X" value={l.position[0]} step={1} onChange={(v) => updateLight(l.id, { position: [v, l.position[1], l.position[2]] })} />
          <NumberRow label="Y" value={l.position[1]} step={1} onChange={(v) => updateLight(l.id, { position: [l.position[0], v, l.position[2]] })} />
          <NumberRow label="Z" value={l.position[2]} step={1} onChange={(v) => updateLight(l.id, { position: [l.position[0], l.position[1], v] })} />
          {(l.type === "spot" || l.type === "sun") && l.target && (
            <>
              <GroupLabel text="目标" />
              <NumberRow label="TX" value={l.target[0]} step={0.1} onChange={(v) => updateLight(l.id, { target: [v, l.target![1], l.target![2]] })} />
              <NumberRow label="TY" value={l.target[1]} step={0.1} onChange={(v) => updateLight(l.id, { target: [l.target![0], v, l.target![2]] })} />
              <NumberRow label="TZ" value={l.target[2]} step={0.1} onChange={(v) => updateLight(l.id, { target: [l.target![0], l.target![1], v] })} />
            </>
          )}
          {l.type === "area" && (
            <>
              <GroupLabel text="尺寸" />
              <NumberRow label="宽" value={l.size?.[0] ?? 1} step={0.1} onChange={(v) => updateLight(l.id, { size: [v, l.size?.[1] ?? 1] })} />
              <NumberRow label="高" value={l.size?.[1] ?? 1} step={0.1} onChange={(v) => updateLight(l.id, { size: [l.size?.[0] ?? 1, v] })} />
            </>
          )}
          {l.type === "spot" && (
            <>
              <SliderRow label="角度" value={l.angle ?? 30} min={1} max={90} step={1} unit="°" onChange={(v) => updateLight(l.id, { angle: v })} />
              <SliderRow label="羽化" value={l.penumbra ?? 0.3} min={0} max={1} onChange={(v) => updateLight(l.id, { penumbra: v })} />
            </>
          )}
          <div className="row">
            <button className="btn small" style={{ color: "var(--red)" }} onClick={() => removeLight(l.id)}>删除灯光</button>
          </div>
        </Section>
      ))}
      {lights.length === 0 && (
        <p style={{ padding: 16, textAlign: "center", color: "var(--text-faint)", fontSize: 11 }}>场景暂无灯光（环境 HDR 提供照明）</p>
      )}
    </>
  );
}

/* ================= 相机页签 ================= */
function CameraTab() {
  const cam = useSceneStore((s) => s.scene.camera);
  const updateCamera = useSceneStore((s) => s.updateCamera);
  const setViewMode = useSceneStore((s) => s.setViewMode);
  const getEngineSafe = () => getEngine();

  return (
    <>
      <Section title="位置与方向" defaultOpen={true}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {["透视", "前视", "后视", "左视", "右视", "顶视", "底视", "查看全部"].map((v) => (
            <button key={v} className="btn small" onClick={() => { setViewMode(v); getEngineSafe()?.setViewMode(v); }}>{v}</button>
          ))}
        </div>
        <NumberRow label="位置 X" value={cam.position[0]} step={1} onChange={(v) => updateCamera({ position: [v, cam.position[1], cam.position[2]] })} />
        <NumberRow label="位置 Y" value={cam.position[1]} step={1} onChange={(v) => updateCamera({ position: [cam.position[0], v, cam.position[2]] })} />
        <NumberRow label="位置 Z" value={cam.position[2]} step={1} onChange={(v) => updateCamera({ position: [cam.position[0], cam.position[1], v] })} />
        <NumberRow label="目标 X" value={cam.target[0]} step={1} onChange={(v) => updateCamera({ target: [v, cam.target[1], cam.target[2]] })} />
        <NumberRow label="目标 Y" value={cam.target[1]} step={1} onChange={(v) => updateCamera({ target: [cam.target[0], v, cam.target[2]] })} />
        <NumberRow label="目标 Z" value={cam.target[2]} step={1} onChange={(v) => updateCamera({ target: [cam.target[0], cam.target[1], v] })} />
      </Section>
      <Section title="镜头">
        <SliderRow label="视场角 FOV" value={cam.fov} min={10} max={90} step={1} unit="°" onChange={(v) => {
          // FOV → 焦距换算（35mm 全画幅，传感器高 24mm）
          const fl = 24 / (2 * Math.tan(v * Math.PI / 360));
          updateCamera({ fov: v, focalLength: Math.round(fl) });
        }} />
        <SliderRow label="焦距" value={cam.focalLength} min={16} max={200} step={1} unit="mm" onChange={(v) => {
          // 焦距 → FOV 换算
          const fov = 2 * Math.atan(24 / (2 * v)) * 180 / Math.PI;
          updateCamera({ focalLength: v, fov: Math.round(fov * 10) / 10 });
        }} />
        <SliderRow label="光圈" value={cam.aperture} min={1} max={22} step={0.1} format={(v) => `f/${v.toFixed(1)}`} onChange={(v) => updateCamera({ aperture: v })} />
        <ToggleRow label="景深 DOF" value={cam.dof} onChange={(v) => {
          updateCamera({ dof: v });
          if (v) useSceneStore.getState().setStatus("景深已开启 — 切换到路径追踪模式出图时生效（光栅化预览不显示 DOF）");
        }} />
        {cam.dof && (
          <p style={{ fontSize: 10, color: "var(--text-faint)", margin: "4px 0", lineHeight: 1.5 }}>
            DOF 在路径追踪出图时根据光圈值计算景深模糊。光圈越大（f 值越小），景深越浅。
          </p>
        )}
      </Section>
      <Section title="曝光">
        <SliderRow label="曝光补偿" value={cam.exposure} min={-3} max={3} step={0.1} unit="EV" onChange={(v) => updateCamera({ exposure: v })} />
        <SliderRow label="色温" value={cam.whiteBalance} min={3000} max={9000} step={100} unit="K" format={(v) => `${v.toFixed(0)}`} onChange={(v) => updateCamera({ whiteBalance: v })} />
        <NumberRow label="ISO" value={cam.iso} step={1} onChange={(v) => updateCamera({ iso: v })} />
        <NumberRow label="快门 1/" value={cam.shutter} step={1} onChange={(v) => updateCamera({ shutter: v })} />
      </Section>
    </>
  );
}

/* ================= 图像页签 ================= */
function ImageTab() {
  const scene = useSceneStore((s) => s.scene);
  const updateRender = useSceneStore((s) => s.updateRender);
  const setStatus = useSceneStore((s) => s.setStatus);
  const gpuAvailable = useSceneStore((s) => s.gpuAvailable);
  const [preview, setPreview] = React.useState<string | null>(null);

  const doRender = async () => {
    const eng = getEngine();
    if (!eng) return;
    const [w, h] = scene.render.resolution;
    const url = await eng.exportPNG([w, h], scene.render.preserveAlpha, scene.name);
    setPreview(url);
    setStatus(`渲染完成 ${w}×${h}（${scene.render.mode === "pathtrace" ? "路径追踪" : "光栅化"}）`);
  };

  return (
    <>
      <Section title="渲染设备" defaultOpen={true}>
        <div className="row" style={{ gap: 6 }}>
          <button
            className={`btn small ${scene.render.device === "cpu" ? "primary" : ""}`}
            onClick={() => updateRender({ device: "cpu" })}
            title="CPU 兼容模式（默认）：降分辨率、关闭阴影"
          >CPU 兼容</button>
          <button
            className={`btn small ${scene.render.device === "gpu" ? "primary" : ""}`}
            disabled={!gpuAvailable}
            onClick={() => updateRender({ device: "gpu" })}
            title={gpuAvailable ? "GPU 高性能模式：满分辨率 + 阴影" : "未检测到 GPU 加速"}
          >GPU 高性能</button>
        </div>
        <ToggleRow
          label="GPU 过载自动回退 CPU"
          value={scene.render.autoFallback}
          onChange={(v) => updateRender({ autoFallback: v })}
        />
        <p style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.6 }}>
          CPU 模式：像素比锁定 1x、关闭阴影，大幅降低 GPU 负载，保证流畅；GPU 模式：满分辨率（设备像素比）+ 阴影。
          {gpuAvailable ? "" : " 当前环境未检测到 GPU 加速，GPU 模式已禁用（自动使用 CPU 兼容模式）。"}
        </p>
      </Section>

      <Section title="渲染设置" defaultOpen={true}>
        <SelectRow
          label="渲染引擎"
          value={scene.render.mode}
          options={[
            { value: "raster", label: "光栅化（实时预览）" },
            { value: "pathtrace", label: "路径追踪（真实物理）" },
          ]}
          onChange={(v) => updateRender({ mode: v as "raster" | "pathtrace" })}
        />
        <div className="row">
          <span className="label">分辨率</span>
          <select
            value={`${scene.render.resolution[0]}x${scene.render.resolution[1]}`}
            onChange={(e) => {
              const [w, h] = e.target.value.split("x").map(Number);
              updateRender({ resolution: [w, h] });
            }}
          >
            {[["1280x720", "1280 × 720"], ["1920x1080", "1920 × 1080"], ["2560x1440", "2560 × 1440"], ["3840x2160", "3840 × 2160 (4K)"]].map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </div>
        <SliderRow label="采样数（路径追踪）" value={scene.render.samples} min={64} max={2048} step={64} format={(v) => `${v.toFixed(0)}`} onChange={(v) => updateRender({ samples: v })} />
        <SliderRow label="光线反弹（路径追踪）" value={scene.render.bounces} min={1} max={16} step={1} onChange={(v) => updateRender({ bounces: v })} />
        <div className="row">
          <span className="label">输出格式</span>
          <select
            value={scene.render.format || "png"}
            onChange={(e) => updateRender({ format: e.target.value as "png" | "jpeg" })}
          >
            <option value="png">PNG（支持透明）</option>
            <option value="jpeg">JPEG（更小）</option>
          </select>
        </div>
        <SliderRow label="采样数（路径追踪）" value={scene.render.samples} min={64} max={2048} step={64} format={(v) => `${v.toFixed(0)}`} onChange={(v) => updateRender({ samples: v })} />
        <SliderRow label="光线反弹（路径追踪）" value={scene.render.bounces} min={1} max={16} step={1} onChange={(v) => updateRender({ bounces: v })} />
        <ToggleRow label="降噪" value={scene.render.denoise} onChange={(v) => updateRender({ denoise: v })} />
        <ToggleRow label="透明背景" value={scene.render.preserveAlpha} onChange={(v) => updateRender({ preserveAlpha: v })} />
      </Section>
      <Section title="渲染输出" defaultOpen={true}>
        <div className="row">
          <button className="btn primary" style={{ flex: 1 }} onClick={doRender}>⬇ 渲染出图（PNG）</button>
        </div>
        <p style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.6 }}>
          当前使用 {scene.render.mode === "pathtrace" ? "路径追踪（GPU 物理级：真实折射/反射/软阴影/焦散）" : "光栅化实时渲染"}。路径追踪为最终出图模式，实时预览仍为光栅化。
        </p>
      </Section>

      {preview && (
        <div className="render-preview" onClick={() => setPreview(null)}>
          <img src={preview} alt="渲染结果" />
        </div>
      )}
    </>
  );
}
