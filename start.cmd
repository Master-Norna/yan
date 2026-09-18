@echo off
chcp 65001 >nul
title 言 · 本机桥接 - 请保持开启
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 node：请先安装 Node.js 18 或更高版本（https://nodejs.org），装好后再双击此文件。
  pause
  exit /b 1
)
node server.js --open
echo.
echo 桥接已退出（退出码 %errorlevel%）。若不是你按 Ctrl+C 关的，上面的输出就是原因；页面此时已连不上桥接。
pause
