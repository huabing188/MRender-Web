// 引擎实例桥：UI 组件通过它调用引擎（避免 prop drilling）
import type { ThreeEngine } from "../engine/ThreeEngine";

let _engine: ThreeEngine | null = null;

export function setEngine(e: ThreeEngine | null) {
  _engine = e;
}

export function getEngine(): ThreeEngine | null {
  return _engine;
}
