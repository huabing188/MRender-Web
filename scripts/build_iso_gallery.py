#!/usr/bin/env python3
import base64, os, html

SRC = "/Users/huabinxu/Desktop/workbuddy文档/MRender-Web/verify/iso-smoke"
OUT = "/Users/huabinxu/Desktop/workbuddy文档/MRender-Web/verify/iso-smoke/gallery.html"

captions = {
    "dosch-DH-301HC.png": "Dosch Chrome Studio · DH-301HC（产品级反射/高光）",
    "dosch-DH-325HC.png": "Dosch Chrome Studio · DH-325HC",
    "dosch-DH-350HC.png": "Dosch Chrome Studio · DH-350HC",
    "hdrimaps-Auditorium-Polar.png": "HDRIMAPS · Auditorium-Polar（场景级环境）",
}

imgs = []
for fn in sorted(captions):
    p = os.path.join(SRC, fn)
    if not os.path.exists(p): 
        continue
    b64 = base64.b64encode(open(p, "rb").read()).decode()
    imgs.append((captions[fn], b64, fn))

cards = "\n".join(
    f'''<figure>
  <img src="data:image/png;base64,{b64}" alt="{html.escape(fn)}"/>
  <figcaption>{html.escape(cap)}</figcaption>
</figure>''' for cap, b64, fn in imgs)

doc = f'''<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>ISO HDR 入库验收</title>
<style>
 body{{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0e0f12;color:#e6e6e6;margin:0;padding:24px}}
 h1{{font-size:20px;font-weight:600;margin:0 0 4px}}
 p.sub{{color:#9aa;margin:0 0 20px;font-size:13px}}
 .grid{{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}}
 figure{{margin:0;background:#17191e;border:1px solid #262a32;border-radius:10px;overflow:hidden}}
 img{{width:100%;display:block}}
 figcaption{{padding:8px 12px;font-size:12px;color:#cdd}}
 .note{{margin-top:18px;font-size:12px;color:#8a93a0;line-height:1.6}}
</style></head><body>
<h1>ISO HDR 批量入库 · 无头验收</h1>
<p class="sub">1028 张 HDR 已接入 MRender-Web 环境库。下图 4 张抽样（Dosch 产品级 + HDRIMAPS 场景级）经 Playwright+Chrome 切换环境后渲染，画面哈希各不相同、零 JS 错误。</p>
<div class="grid">{cards}</div>
<p class="note">说明：3–5MB HDR 在软件渲染(WebGL)下需 1–2 秒解析生效，软件里点选后稍等即出。完整 1028 张可在开发服务器（http://localhost:5180/）环境页签直接浏览试用。</p>
</body></html>'''

open(OUT, "w").write(doc)
print("wrote", OUT, os.path.getsize(OUT), "bytes")
