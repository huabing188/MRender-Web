import base64
import json
from pathlib import Path

OUT = Path("/Users/huabinxu/Desktop/workbuddy文档/MRender样张")
report = json.loads((OUT / "report.json").read_text(encoding="utf-8"))

html = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MRender 敦和风格样张</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:#111; color:#eee; margin:0; padding:24px; }
h1 { font-size:22px; margin-bottom:6px; }
p.sub { color:#aaa; margin-top:0; font-size:14px; }
.shot { margin-bottom:32px; background:#1a1a1a; border-radius:10px; padding:16px; }
.shot h2 { font-size:16px; margin:0 0 8px; color:#6ec3ff; }
.shot .meta { color:#999; font-size:12px; margin-bottom:10px; }
.shot img { max-width:100%; border-radius:6px; border:1px solid #333; }
</style>
</head>
<body>
<h1>MRender 敦和 PDF 风格自测样张</h1>
<p class="sub">模型：内置演示酒瓶（玻璃瓶身+金盖+蓝液） | 渲染：光栅化（CPU SwiftShader）</p>
"""

for shot in report["shots"]:
    img_path = OUT / (shot["name"] + ".png" if not shot["file"].endswith(".png") else Path(shot["file"]).name)
    if not img_path.exists():
        img_path = Path(shot["file"])
    data = base64.b64encode(img_path.read_bytes()).decode()
    html += f"""
<div class="shot">
  <h2>{shot["name"]}</h2>
  <div class="meta">环境：{shot["env"]} | {shot["desc"]}</div>
  <img src="data:image/png;base64,{data}" alt="{shot["name"]}">
</div>
"""

html += "</body></html>"
(OUT / "gallery.html").write_text(html, encoding="utf-8")
print("gallery.html built with", len(report["shots"]), "shots")
