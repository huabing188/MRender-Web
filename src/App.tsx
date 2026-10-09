// 应用根组件：组装三栏 UI + 挂载引擎 + 数据双向同步
import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { ThreeEngine, addModelFromFile } from "./engine/ThreeEngine";
import { useSceneStore, onSceneChange } from "./store/sceneStore";
import { setEngine } from "./ui/engineBridge";
import { TopBar } from "./ui/TopBar";
import { LibraryPanel } from "./ui/LibraryPanel";
import { Viewport } from "./ui/Viewport";
import { ProjectPanel } from "./ui/ProjectPanel";
import { StatusBar } from "./ui/StatusBar";
import { parseKeyshotMaterialLibrary, readFileAsArrayBuffer } from "./engine/keyshotImport";
import { probeIsoEnvironments } from "./core/defaultScene";

export default function App() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ThreeEngine | null>(null);

  // 挂载引擎 + 订阅数据变更
  useEffect(() => {
    if (!viewportRef.current || engineRef.current) return;
    const engine = new ThreeEngine({
      onSelect: (id) => useSceneStore.getState().selectObject(id),
      onStatus: (msg) => useSceneStore.getState().setStatus(msg),
    });
    engine.attach(viewportRef.current);
    engineRef.current = engine;
    setEngine(engine);

    // 程序化 API：自动化验证与高级脚本使用
    (window as unknown as { THREE?: unknown }).THREE = THREE;
    (window as unknown as { MRender?: unknown }).MRender = {
      getStore: () => useSceneStore.getState(),
      getEngine: () => engineRef.current,
      importKeyShotKmp: async (file: File) => {
        const buf = await readFileAsArrayBuffer(file);
        const res = await parseKeyshotMaterialLibrary(buf);
        useSceneStore.getState().importKeyShot(res.materials, res.textures);
        return res;
      },
      importModel: (file: File, opts?: { explode?: boolean }) =>
        addModelFromFile(file, (msg) => useSceneStore.getState().setStatus(msg), opts),
      setGridVisible: (v: boolean) => engineRef.current?.setGridVisible(v),
      setAxesVisible: (v: boolean) => engineRef.current?.setAxesVisible(v),
    };

    // store → 引擎 同步
    const unsub = onSceneChange((scene) => {
      engine.syncScene(scene);
    });

    // 初始同步（attach 里已做一次，这里保证后续）
    engine.syncScene(useSceneStore.getState().scene);

    // 探测本地是否存有商业 HDRI 素材（Dosch / HDRI Maps）：
    // 有则自动追加进环境库，没有则静默跳过，避免出现点不开的死预设。
    void probeIsoEnvironments();

    const onResize = () => engine.onResize();
    window.addEventListener("resize", onResize);
    return () => {
      unsub();
      window.removeEventListener("resize", onResize);
      engine.dispose();
      engineRef.current = null;
      setEngine(null);
    };
  }, []);

  // 选中变化 / Gizmo 模式变化 → 引擎 Gizmo 联动
  const selectedObjectId = useSceneStore((s) => s.selectedObjectId);
  const gizmoMode = useSceneStore((s) => s.gizmoMode);
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setGizmoMode(gizmoMode, selectedObjectId);
  }, [selectedObjectId, gizmoMode]);

  // 全局键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 输入框中不拦截
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      if (t.isContentEditable) return;

      const st = useSceneStore.getState();
      const eng = engineRef.current;
      const selId = st.selectedObjectId;
      // 统一修饰键判断：Mac=⌘(metaKey)，Win=Ctrl(ctrlKey)
      const mod = e.ctrlKey || e.metaKey;

      // —— 带修饰键的快捷键 ——
      if (mod) {
        switch (e.key.toLowerCase()) {
          case "z":
            e.preventDefault();
            if (e.shiftKey) st.redo();
            else st.undo();
            return;
          case "y":
            // Windows 风格重做 (Ctrl+Y)
            e.preventDefault();
            st.redo();
            return;
          case "n":
            e.preventDefault();
            if (confirm("新建空场景？当前内容将丢失（可撤销）")) {
              st.newScene();
              st.setStatus("已新建空场景");
            }
            return;
          case "o":
            e.preventDefault();
            {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".obj,.gltf,.glb,.stl,.ply,.fbx,.3dm";
              input.onchange = async () => {
                const f = input.files?.[0];
                if (!f) return;
                try {
                  await addModelFromFile(f, (msg) => st.setStatus(msg));
                } catch (err) {
                  st.setStatus(`导入失败: ${(err as Error).message}`);
                }
              };
              input.click();
            }
            return;
          case "s":
            e.preventDefault();
            {
              const data = JSON.stringify(st.scene, null, 2);
              const blob = new Blob([data], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${st.scene.name || "MRender项目"}.mrender.json`;
              a.click();
              URL.revokeObjectURL(url);
              st.setStatus(`项目已保存（${(blob.size / 1024).toFixed(0)} KB）`);
            }
            return;
        }
      }

      // —— 单键快捷键（无修饰键）——
      if (mod) return; // 有修饰键但未匹配上面的分支，不再处理单键
      switch (e.key) {
        case " ":
          e.preventDefault();
          if (selId) {
            st.setGizmoMode("translate");
            eng?.setGizmoMode("translate", selId);
          }
          break;
        case "r":
        case "R":
          if (selId) {
            st.setGizmoMode("rotate");
            eng?.setGizmoMode("rotate", selId);
          }
          break;
        case "s":
        case "S":
          if (selId) {
            st.setGizmoMode("scale");
            eng?.setGizmoMode("scale", selId);
          }
          break;
        case "Escape":
          st.selectObject(null);
          eng?.setGizmoMode("off");
          break;
        case "Delete":
        case "Backspace":
          if (selId) {
            st.removeObject(selId);
            eng?.setGizmoMode("off");
            st.setStatus("已删除选中对象");
          }
          break;
        case "f":
        case "F":
          st.setViewMode("查看全部");
          eng?.setViewMode("查看全部");
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 全局拖拽导入（兜底：拖到窗口任意位置）
  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      for (const f of Array.from(files)) {
        const n = f.name.toLowerCase();
        if (n.endsWith(".hdr") || n.endsWith(".exr")) {
          engineRef.current?.importHdrFile(f);
          useSceneStore.getState().setStatus(`正在加载 HDR：${f.name}`);
          continue;
        }
        if (n.endsWith(".obj") || n.endsWith(".gltf") || n.endsWith(".glb") || n.endsWith(".stl") || n.endsWith(".ply") || n.endsWith(".fbx") || n.endsWith(".3dm")) {
          addModelFromFile(f, (msg) => useSceneStore.getState().setStatus(msg)).catch((err) =>
            useSceneStore.getState().setStatus(`导入失败: ${(err as Error).message}`)
          );
          continue;
        }
        if (n.endsWith(".kmp")) {
          const st = useSceneStore.getState();
          st.setStatus(`正在解析 KeyShot 材质库：${f.name} …`);
          readFileAsArrayBuffer(f)
            .then((buf) => parseKeyshotMaterialLibrary(buf))
            .then((res) => {
              st.importKeyShot(res.materials, res.textures);
              st.setStatus(`已导入 ${res.materials.length} 个 KeyShot 材质${res.textures.length ? ` + ${res.textures.length} 张关联纹理` : ""}`);
            })
            .catch((err) => st.setStatus(`KeyShot 材质库导入失败：${(err as Error).message}`));
        }
      }
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
    };
  }, []);

  return (
    <div className="app-root">
      <TopBar />
      <div className="app-main">
        <LibraryPanel />
        <Viewport ref={viewportRef} />
        <ProjectPanel />
      </div>
      <StatusBar />
    </div>
  );
}
