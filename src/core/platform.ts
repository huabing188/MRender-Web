/**
 * 平台检测与快捷键适配
 * Mac → ⌘ / ⇧ 符号；Windows/Linux → Ctrl / Shift 文字
 */

const ua = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
const platform = typeof navigator !== "undefined" ? (navigator.platform || "").toLowerCase() : "";

/** 是否 Mac 平台 */
export const isMac = /mac|iPhone|iPad|iPod/.test(platform) || ua.includes("macintosh");
/** 是否 iOS / iPadOS */
export const isIOS = /iPhone|iPad|iPod/.test(platform) || (ua.includes("macintosh") && navigator.maxTouchPoints > 1);
/** 是否 Android */
export const isAndroid = ua.includes("android");
/** 是否 Windows */
export const isWindows = ua.includes("windows") || platform.includes("win32");
/** 是否移动设备 */
export const isMobile = isIOS || isAndroid;
/** 是否桌面平台 */
export const isDesktop = !isMobile;

/** 修饰键前缀：Mac = "⌘"，Win = "Ctrl" */
export const MOD = isMac ? "\u2318" : "Ctrl"; // ⌘

/** Shift 符号：Mac = "⇧"，Win = "Shift" */
export const SHIFT = isMac ? "\u21E7" : "Shift"; // ⇧

/** Alt/Option 符号 */
export const ALT = isMac ? "\u2325" : "Alt"; // ⌥

/**
 * 生成平台适配的快捷键标签字符串。
 * @param keys 格式如 "Z" / "Shift+Z" / "S" / "O"
 * @returns Mac: "⌘⇧Z"  Win: "Ctrl+Shift+Z"
 */
export function sk(keys: string): string {
  if (keys.startsWith("Shift+")) {
    const main = keys.slice(6);
    return isMac ? `${MOD}${SHIFT}${main}` : `${MOD}+Shift+${main}`;
  }
  return isMac ? `${MOD}${keys}` : `${MOD}+${keys}`;
}
