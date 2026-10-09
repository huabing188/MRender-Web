#!/bin/bash
# MRender-Web 启动脚本（生产模式，最稳定）
# 1) 先构建静态包  2) 用 Python 静态服务器托管
# 用法：在终端里执行  ./serve-dist.sh  然后保持该终端打开
# 浏览器打开：http://localhost:8080/
cd "$(dirname "$0")"
echo "构建生产包..."
npm run build
if [ ! -d dist ]; then
  echo "构建失败，请检查 node_modules 是否安装（执行 npm install）"
  exit 1
fi
echo "============================================"
echo "  MRender-Web 生产服务器启动中..."
echo "  请在浏览器打开: http://localhost:8080/"
echo "  关闭服务：按 Ctrl+C 或关闭此终端"
echo "============================================"
cd dist
python3 -m http.server 8080
