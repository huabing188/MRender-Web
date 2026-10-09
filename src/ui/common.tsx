// 通用控件：折叠组 / 滑块行 / 开关行 / 颜色行 / 下拉行 / 数值行
import React, { useState } from "react";

export function Section({
  title, defaultOpen = true, children, badge,
}: { title: string; defaultOpen?: boolean; children: React.ReactNode; badge?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <div
        className={`section-header ${open ? "open" : ""}`}
        onClick={() => setOpen(!open)}
      >
        <span className="arrow" />
        <span className="title">{title}</span>
        {badge && <span style={{ fontSize: 9.5, color: "var(--text-faint)" }}>{badge}</span>}
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

export function SliderRow({
  label, value, min, max, step = 0.01, onChange, unit = "", format,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; unit?: string; format?: (v: number) => string;
}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div className="row">
      <span className="label">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        style={{ ["--fill" as string]: `${pct}%`, flex: 1 }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="value">{format ? format(value) : value.toFixed(2)}{unit}</span>
    </div>
  );
}

export function NumberRow({
  label, value, min, max, step = 0.01, onChange, unit = "",
}: {
  label: string; value: number; min?: number; max?: number; step?: number;
  onChange: (v: number) => void; unit?: string;
}) {
  return (
    <div className="row">
      <span className="label">{label}</span>
      <input
        type="number" value={Number(value.toFixed(4))} min={min} max={max} step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
      {unit && <span style={{ fontSize: 10, color: "var(--text-faint)", width: 14 }}>{unit}</span>}
    </div>
  );
}

export function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="row">
      <span className="label">{label}</span>
      <div className={`switch ${value ? "on" : ""}`} onClick={() => onChange(!value)} />
    </div>
  );
}

export function ColorRow({ label, value, onChange }: { label: string; value: [number, number, number]; onChange: (v: [number, number, number]) => void }) {
  const hex = `#${value.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
  return (
    <div className="row">
      <span className="label">{label}</span>
      <div className="color-swatch" style={{ background: hex }}>
        <input
          type="color" value={hex}
          onChange={(e) => {
            const h = e.target.value.replace("#", "");
            onChange([parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]);
          }}
        />
      </div>
    </div>
  );
}

export function SelectRow({
  label, value, options, onChange,
}: {
  label: string; value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="row">
      <span className="label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function ButtonRow({ label, onClick, kind = "default" }: { label: string; onClick: () => void; kind?: "primary" | "default" | "small" }) {
  return (
    <div className="row">
      <button className={`btn ${kind === "primary" ? "primary" : ""}`} onClick={onClick} style={kind === "small" ? { width: "100%" } : undefined}>
        {label}
      </button>
    </div>
  );
}

export function GroupLabel({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 10, color: "var(--text-faint)", margin: "6px 0 3px", letterSpacing: 0.5 }}>{text}</div>
  );
}

export const ICONS: Record<string, React.ReactNode> = {
  folder: <svg className="ico-svg" viewBox="0 0 16 16"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.2c.4 0 .78.16 1.06.44L8.6 3.8H13a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 13 13.8H3a1.5 1.5 0 0 1-1.5-1.5v-8.8z"/></svg>,
  cube: <svg className="ico-svg" viewBox="0 0 16 16"><path d="M8 1.5 13.5 4.4v7.2L8 14.5l-5.5-2.9V4.4L8 1.5zm0 1.3L4 4.9v5.9l4 2.1 4-2.1V4.9L8 2.8z"/></svg>,
  sphere: <svg className="ico-svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.3"/><ellipse cx="8" cy="8" rx="6.2" ry="2.6" fill="none" stroke="currentColor" strokeWidth="1.1"/></svg>,
  sun: <svg className="ico-svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M13 3l-1.4 1.4M4.4 11.6 3 13" stroke="currentColor" strokeWidth="1.2"/></svg>,
  camera: <svg className="ico-svg" viewBox="0 0 16 16"><path d="M2.5 4.5h2l1-1.5h5l1 1.5h2a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-6.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>,
  image: <svg className="ico-svg" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/><circle cx="5.5" cy="6.5" r="1" fill="currentColor"/><path d="m3.5 12 3.5-3.5 2 2 2.5-2.5 2 2" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>,
  eye: <svg className="ico-svg" viewBox="0 0 16 16"><path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8 12.1 12.2 8 12.2 1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="8" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>,
  trash: <svg className="ico-svg" viewBox="0 0 16 16"><path d="M3 3.5h10M6.5 2h3M4 3.5l.7 10a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-10" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>,
  light: <svg className="ico-svg" viewBox="0 0 16 16"><path d="M5.5 11.5a3.5 3.5 0 1 1 5 0 3.5 3.5 0 0 1-5 0z" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="M8 2v1.5M3.5 3.5l1 1M12.5 3.5l-1 1M2.5 8H4M12 8h1.5" stroke="currentColor" strokeWidth="1.2"/></svg>,
  layer: <svg className="ico-svg" viewBox="0 0 16 16"><path d="M8 2 14 5.5 8 9 2 5.5 8 2zm-6 7 6 3.3L14 9M2 11.5l6 3.3 6-3.3" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>,
  palette: <svg className="ico-svg" viewBox="0 0 16 16"><path d="M8 2a6 6 0 0 0 0 12c.8 0 1.2-.6 1.2-1.2 0-.4-.2-.7-.5-.9-.3-.3-.5-.6-.5-1 0-.8.6-1.4 1.4-1.4H11a3 3 0 0 0 3-3c0-2.7-2.8-4.5-6-4.5z" fill="none" stroke="currentColor" strokeWidth="1.2"/><circle cx="5.2" cy="6.2" r=".9" fill="currentColor"/><circle cx="7.6" cy="4.8" r=".9" fill="currentColor"/><circle cx="10.4" cy="6.2" r=".9" fill="currentColor"/></svg>,
  texture: <svg className="ico-svg" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="M2 6h12M2 10h12M6 2v12M10 2v12" stroke="currentColor" strokeWidth="1"/></svg>,
  star: <svg className="ico-svg" viewBox="0 0 16 16"><path d="m8 1.8 1.9 4 4.4.5-3.3 3 .9 4.4L8 11.6l-3.9 2.1.9-4.4-3.3-3 4.4-.5 1.9-4z" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>,
  box: <svg className="ico-svg" viewBox="0 0 16 16"><path d="M2.5 4.5 8 2l5.5 2.5v7L8 14l-5.5-2.5v-7zM8 2v12M2.5 4.5 8 7l5.5-2.5M8 7v4.5" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>,
  search: <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.4"/></svg>,
};
