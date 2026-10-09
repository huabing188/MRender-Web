#!/bin/bash
# MRender-Web 启动脚本（开发模式）
# 用法：在终端里执行  ./start-mrender.sh  然后保持该终端打开
# 浏览器打开：http://localhost:5173/
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "首次运行，正在安装依赖..."
  npm install
fi
echo "============================================"
echo "  MRender-Web 开发服务器启动中..."
echo "  请在浏览器打开: http://localhost:5173/"
echo "  关闭服务：按 Ctrl+C 或关闭此终端"
echo "============================================"
npm run dev -- --host --port 5173 --strictPort
