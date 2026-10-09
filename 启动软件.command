#!/bin/bash
cd /Users/huabinxu/WorkBuddy/2026-08-11-21-17-02/MRender-Web
echo "========================================"
echo "  MRender 正在启动… 请勿关闭此窗口"
echo "  启动后请打开浏览器访问："
echo "  http://localhost:5180/"
echo "========================================"
./node_modules/.bin/vite --host --port 5180 --strictPort
