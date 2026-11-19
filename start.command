#!/bin/bash
# 言 · macOS 的启动入口。便携包用包内 Node；源码从继承的 PATH 找 Node。系统工具探测由桥接启动后做。
cd "$(dirname "$0")" || exit 1
printf ']0;言 · 本机桥接 - 请保持开启'
NODE="$PWD/node/bin/node"
if [ -x "$NODE" ]; then
  # 桥接用包内那份；子进程仍优先用系统已装的 node / npm。
  export PATH="${PATH:+$PATH:}$PWD/node/bin"
elif ! NODE=$(command -v node); then
  echo "未找到 node：请先安装 Node.js 22 或更高版本（https://nodejs.org），装好后再双击此文件。"
  read -r -p "按回车键关闭…"
  exit 1
fi
# 便携包冒烟走同一个入口，只不打开浏览器、不等回车。
if [ "${1:-}" = "--no-open" ]; then exec "$NODE" server.js; fi
"$NODE" server.js --open
code=$?
echo
echo "桥接已退出（退出码 $code）。若不是你按 Ctrl+C 关的，上面的输出就是原因；页面此时已连不上桥接。"
read -r -p "按回车键关闭…"
