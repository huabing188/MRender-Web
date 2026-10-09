#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import base64, os, html

BASE = "/Users/huabinxu/Desktop/workbuddy文档/MRender-Web/verify/cc0-test"
OUT = os.path.join(BASE, "gallery.html")

def b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")

def fig(name, label):
    p = os.path.join(BASE, name)
    data = b64(p)
    return f'''<figure>
  <img src="data:image/png;base64,{data}" alt="{html.escape(label)}" loading="lazy"/>
  <figcaption>{html.escape(label)}</figcaption>
</figure>'''

pairs = [
    ("m1a-mat_ac_wood.png", "ambientCG 实木 (Wood075)", "m1b-mat_wood.png", "内置 程序化木"),
    ("m2a-mat_ac_metal.png", "ambientCG 金属板 (MetalPlates010)", "m2b-mat_metal_chrome.png", "内置 Chrome"),
    ("m3a-mat_ac_fabric.png", "ambientCG 织物 (Fabric066)", "m3b-mat_fabric_velvet.png", "内置 天鹅绒"),
]

envs = [
    ("e1-panels_tilted.png", "内置 panels_tilted（三面板光）"),
    ("e2-ph_blocky_photo_studio.png", "PH Blocky Photo Studio"),
    ("e3-ph_blue_photo_studio.png", "PH Blue Photo Studio"),
    ("e4-ph_brown_photostudio_01.png", "PH Brown Studio"),
    ("e5-ph_abandoned_bakery.png", "PH Abandoned Bakery"),
]

pair_html = ""
for l, ll, r, rl in pairs:
    pair_html += f'''<div class="pair">
  {fig(l, ll)}
  {fig(r, rl)}
</div>'''

env_html = "".join(fig(n, l) for n, l in envs)

doc = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>MRender CC0 资产对比画廊</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ margin:0; background:#15171c; color:#e6e6e6; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif; }}
  header {{ padding:24px 28px 8px; }}
  h1 {{ font-size:20px; margin:0 0 4px; }}
  .sub {{ color:#9aa0aa; font-size:13px; }}
  h2 {{ font-size:15px; margin:28px 28px 12px; color:#cdd3dc; border-left:3px solid #4f8cff; padding-left:10px; }}
  .pair {{ display:flex; gap:14px; padding:0 28px 18px; flex-wrap:wrap; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:14px; padding:0 28px 28px; }}
  figure {{ margin:0; background:#1e2128; border:1px solid #2a2e37; border-radius:10px; overflow:hidden; flex:1 1 320px; }}
  figure img {{ width:100%; display:block; background:#000; }}
  figcaption {{ padding:8px 10px; font-size:12px; color:#b9c0cc; }}
</style></head>
<body>
<header>
  <h1>MRender-Web · 高评价 CC0 资产对比</h1>
  <div class="sub">左/上为 ambientCG PBR 与 Poly Haven HDR（外部高评价素材）· 右/下为内置程序化材质与环境 · 全部无头渲染、零 JS 错误</div>
</header>
<h2>材质对比（AC 真实 PBR vs 内置程序化）</h2>
{pair_html}
<h2>环境 HDR 对比（内置 vs Poly Haven studio）</h2>
<div class="grid">{env_html}</div>
</body></html>'''

with open(OUT, "w", encoding="utf-8") as f:
    f.write(doc)
print("written:", OUT, "bytes:", os.path.getsize(OUT))
