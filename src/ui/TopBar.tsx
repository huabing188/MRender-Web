// 顶部：菜单栏（含下拉菜单） + 工具栏
import React, { useState, useRef, useEffect } from "react";
import { useSceneStore } from "../store/sceneStore";
import { getEngine } from "./engineBridge";
import { ICONS } from "./common";
import { addModelFromFile } from "../engine/ThreeEngine";
import { sk } from "../core/platform";

/** 下拉菜单项 */
interface MenuItem {
  label?: string;
  shortcut?: string;
  sep?: boolean;
  onClick?: () => void;
}

function MenuDropdown({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="menu-dropdown-wrap">
      <span
        className={`menu-item ${open ? "active" : ""}`}
        onClick={() => setOpen(!open)}
      >
        {label}
      </span>
      {open && (
        <div className="menu-dropdown">
          {items.map((item, i) =>
            item.sep ? (
              <div key={i} className="menu-sep" />
            ) : (
              <div
                key={i}
                className="menu-dropdown-item"
                onClick={() => {
                  item.onClick?.();
                  setOpen(false);
                }}
              >
                <span>{item.label}</span>
                {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const setActiveTab = useSceneStore((s) => s.setActiveTab);
  const setLibraryTab = useSceneStore((s) => s.setLibraryTab);
  const setStatus = useSceneStore((s) => s.setStatus);
  const updateRender = useSceneStore((s) => s.updateRender);
  const scene = useSceneStore((s) => s.scene);
  const resetScene = useSceneStore((s) => s.resetScene);
  const selectedObjectId = useSceneStore((s) => s.selectedObjectId);
  const canUndo = useSceneStore((s) => s.undoStack.length > 0);
  const canRedo = useSceneStore((s) => s.redoStack.length > 0);
  const gpuAvailable = useSceneStore((s) => s.gpuAvailable);
  const device = scene.render.device;

  const doExport = () => {
    const eng = getEngine();
    if (!eng) return;
    const [w, h] = scene.render.resolution;
    eng.exportPNG([w, h], scene.render.preserveAlpha, scene.name);
    setStatus(`已导出渲染图 ${w}x${h}（PNG）`);
  };

  const openFile = () => {
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

  const openProject = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mrender.json,.json";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          useSceneStore.getState().loadScene(data);
          setStatus(`已打开项目 ${f.name}`);
        } catch (e) {
          setStatus(`项目打开失败: ${(e as Error).message}`);
        }
      };
      reader.readAsText(f);
    };
    input.click();
  };

  const saveProject = () => {
    const data = JSON.stringify(scene, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scene.name || "MRender项目"}.mrender.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`项目已保存（${(blob.size / 1024).toFixed(0)} KB）`);
  };

  const setView = (v: string) => {
    useSceneStore.getState().setViewMode(v);
    getEngine()?.setViewMode(v);
  };

  const doUngroup = async () => {
    const eng = getEngine();
    if (!eng || !selectedObjectId) return;
    const res = await eng.ungroupObject(selectedObjectId);
    setStatus(res.message);
  };

  const doGroup = () => {
    const eng = getEngine();
    if (!eng || !selectedObjectId) return;
    const res = eng.groupObjects(selectedObjectId);
    setStatus(res.message);
  };

  const doDelete = () => {
    if (!selectedObjectId) return;
    useSceneStore.getState().removeObject(selectedObjectId);
    getEngine()?.setGizmoMode("off");
    setStatus("已删除选中对象");
  };

  const onToggleGpu = () => {
    if (!gpuAvailable) {
      setStatus("当前浏览器为软件渲染，未检测到 GPU 加速，已保持 CPU 模式");
      return;
    }
    updateRender({ device: "gpu" });
    setStatus("已切换到 GPU 高性能模式（满分辨率 + 阴影）");
  };

  const fileMenu: MenuItem[] = [
    { label: "新建场景", shortcut: sk("N"), onClick: () => { if (confirm("新建空场景？当前内容将丢失（可撤销）")) { useSceneStore.getState().newScene(); setStatus("已新建空场景"); } } },
    { label: "导入模型…", shortcut: sk("O"), onClick: openFile },
    { label: "导入并打散…", onClick: () => {
      const input = document.createElement("input");
      input.type = "file"; input.accept = ".obj,.gltf,.glb,.stl,.ply,.fbx,.3dm";
      input.onchange = async () => {
        const f = input.files?.[0]; if (!f) return;
        try { const { addModelFromFile } = await import("../engine/ThreeEngine"); await addModelFromFile(f, (msg) => setStatus(msg), { explode: true }); }
        catch (e) { setStatus(`导入失败: ${(e as Error).message}`); }
      };
      input.click();
    } },
    { label: "打开项目…", onClick: openProject },
    { label: "保存项目", shortcut: sk("S"), onClick: saveProject },
    { sep: true },
    { label: "导出渲染图 PNG", onClick: doExport },
  ];

  const editMenu: MenuItem[] = [
    {
      label: "撤销",
      shortcut: sk("Z"),
      onClick: () => useSceneStore.getState().undo(),
    },
    {
      label: "重做",
      shortcut: sk("Shift+Z"),
      onClick: () => useSceneStore.getState().redo(),
    },
    { label: "---" },
    {
      label: "重置场景",
      onClick: () => {
        if (confirm("重置场景？当前内容将丢失")) {
          resetScene();
          setStatus("场景已重置");
        }
      },
    },
    {
      label: "清除选中",
      shortcut: "Esc",
      onClick: () => useSceneStore.getState().selectObject(null),
    },
    {
      label: "删除选中对象",
      shortcut: "Del",
      onClick: () => {
        const id = useSceneStore.getState().selectedObjectId;
        if (id) {
          useSceneStore.getState().removeObject(id);
          getEngine()?.setGizmoMode("off");
          setStatus("已删除选中对象");
        }
      },
    },
  ];

  const showLightHelpers = useSceneStore((s) => s.showLightHelpers);
  const viewMenu: MenuItem[] = [
    { label: "透视视图", onClick: () => setView("透视") },
    { label: "前视图", onClick: () => setView("前视") },
    { label: "后视图", onClick: () => setView("后视") },
    { label: "左视图", onClick: () => setView("左视") },
    { label: "右视图", onClick: () => setView("右视") },
    { label: "顶视图", onClick: () => setView("顶视") },
    { label: "底视图", onClick: () => setView("底视") },
    { sep: true },
    { label: "查看全部", shortcut: "F", onClick: () => setView("查看全部") },
    { sep: true },
    { label: showLightHelpers ? "隐藏灯光辅助体" : "显示灯光辅助体", onClick: () => getEngine()?.setShowLightHelpers(!showLightHelpers) },
  ];

  const windowMenu: MenuItem[] = [
    { label: "场景面板", onClick: () => setActiveTab("scene") },
    { label: "材质面板", onClick: () => setActiveTab("material") },
    { label: "环境面板", onClick: () => setActiveTab("environment") },
    { label: "照明面板", onClick: () => setActiveTab("light") },
    { label: "相机面板", onClick: () => setActiveTab("camera") },
    { label: "渲染面板", onClick: () => setActiveTab("image") },
    { sep: true },
    { label: "材质库", onClick: () => setLibraryTab("materials") },
    { label: "纹理库", onClick: () => setLibraryTab("textures") },
    { label: "环境库", onClick: () => setLibraryTab("environments") },
    { label: "模型库", onClick: () => setLibraryTab("models") },
  ];

  const helpMenu: MenuItem[] = [
    {
      label: "关于 MRender-Web",
      onClick: () =>
        setStatus("MRender-Web Beta — WebGPU 渲染引擎 | KeyShot 工作流 | 开源架构"),
    },
    {
      label: "快捷键说明",
      onClick: () =>
        setStatus(
          `Space=移动 | R=旋转 | S=缩放 | Esc=取消选中 | Del=删除 | F=查看全部 | ${sk("N")}=新建 | ${sk("O")}=导入 | ${sk("S")}=保存 | ${sk("Z")}=撤销 | ${sk("Shift+Z")}=重做`
        ),
    },
    {
      label: "支持格式",
      onClick: () =>
        setStatus("模型: OBJ GLTF GLB STL PLY FBX 3DM | 环境: HDR EXR | 纹理: PNG JPEG WEBP"),
    },
  ];

  return (
    <>
      {/* 菜单栏 */}
      <div className="menu-bar">
        <span className="app-title">MRender</span>
        <MenuDropdown label="文件" items={fileMenu} />
        <MenuDropdown label="编辑" items={editMenu} />
        <MenuDropdown label="视图" items={viewMenu} />
        <MenuDropdown label="窗口" items={windowMenu} />
        <MenuDropdown label="帮助" items={helpMenu} />
        <div className="menu-spacer" />
        <span style={{ color: "var(--text-faint)", fontSize: 10.5 }}>
          KeyShot 工作流 | WebGPU 渲染引擎
        </span>
      </div>

      {/* 工具栏 */}
      <div className="toolbar">
        <button className="tool-btn primary" onClick={openFile} title="导入 OBJ/GLTF/GLB/STL/PLY/FBX/3DM">
          <span style={{ fontSize: 14 }}>+</span> 导入模型
        </button>
        <button className="tool-btn" onClick={openProject}>打开项目</button>
        <button className="tool-btn" onClick={saveProject}>保存项目</button>
        <div className="sep" />
        <button className="tool-btn" disabled={!canUndo} onClick={() => useSceneStore.getState().undo()} title={`撤销 ${sk("Z")}`}>
          ↶ 撤销
        </button>
        <button className="tool-btn" disabled={!canRedo} onClick={() => useSceneStore.getState().redo()} title={`重做 ${sk("Shift+Z")}`}>
          ↷ 重做
        </button>
        <div className="sep" />
        <button className="tool-btn" disabled={!selectedObjectId} onClick={doGroup} title="群组同类/已打散部件">
          ⛓ 群组
        </button>
        <button className="tool-btn" disabled={!selectedObjectId} onClick={doUngroup} title="打散为独立部件（也可右键对象）">
          ✂ 打散
        </button>
        <button className="tool-btn" disabled={!selectedObjectId} onClick={doDelete} title={`删除选中 (Del)`}>
          🗑 删除
        </button>
        <div className="sep" />
        <button className="tool-btn" onClick={() => setActiveTab("scene")}>
          {ICONS.cube} 场景
        </button>
        <button className="tool-btn" onClick={() => setActiveTab("material")}>
          {ICONS.palette} 材质
        </button>
        <button className="tool-btn" onClick={() => setActiveTab("environment")}>
          {ICONS.sun} 环境
        </button>
        <button className="tool-btn" onClick={() => setActiveTab("light")}>
          {ICONS.light} 灯光
        </button>
        <button className="tool-btn" onClick={() => setActiveTab("camera")}>
          {ICONS.camera} 相机
        </button>
        <div className="sep" />
        <button className="tool-btn" onClick={() => setActiveTab("image")}>
          {ICONS.image} 渲染
        </button>
        <div className="sep" />
        <span className="tool-label">渲染设备</span>
        <button
          className={`tool-btn ${device === "cpu" ? "primary" : ""}`}
          onClick={() => {
            updateRender({ device: "cpu" });
            setStatus("已切换到 CPU 兼容模式（降分辨率、关闭阴影）");
          }}
          title="CPU 兼容模式（默认）：降分辨率、关闭阴影，GPU 过载时自动回退"
        >CPU</button>
        <button
          className={`tool-btn ${device === "gpu" ? "primary" : ""}`}
          disabled={!gpuAvailable}
          onClick={onToggleGpu}
          title={gpuAvailable ? "GPU 高性能模式：满分辨率 + 阴影" : "未检测到 GPU 加速（软件渲染），GPU 模式不可用"}
        >GPU</button>
        <div className="sep" />
        <span className="tool-label">引擎</span>
        <button
          className="tool-btn"
          onClick={() =>
            updateRender({
              mode: scene.render.mode === "raster" ? "pathtrace" : "raster",
            })
          }
          title="预览用光栅化，出图用路径追踪（WebGPU）"
        >
          {scene.render.mode === "raster" ? "光栅化" : "路径追踪"}
        </button>
        <div className="sep" />
        <button
          className="tool-btn primary"
          onClick={doExport}
          style={{ marginLeft: "auto" }}
        >
          v 渲染出图
        </button>
      </div>
    </>
  );
}
