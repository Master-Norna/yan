#!/bin/bash
# 言 · macOS 的启动入口：双击即开（头一回系统若拦，在访达里右键此文件选「打开」）。与 start.cmd 同义
cd "$(dirname "$0")" || exit 1
printf ']0;言 · 本机桥接 - 请保持开启'
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node：请先安装 Node.js 22 或更高版本（https://nodejs.org），装好后再双击此文件。"
  read -r -p "按回车键关闭…"
  exit 1
fi
node server.js --open
code=$?
echo
echo "桥接已退出（退出码 $code）。若不是你按 Ctrl+C 关的，上面的输出就是原因；页面此时已连不上桥接。"
read -r -p "按回车键关闭…"
