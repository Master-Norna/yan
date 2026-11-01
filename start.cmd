@echo off
chcp 65001 >nul
title 言 · 本机桥接 - 请保持开启
cd /d "%~dp0"
rem 便携包里带着 node 文件夹：用它，并接在 PATH 末尾（模型跑的 node、npx 找得到；系统已装的仍然优先），与 言.exe 同一个做法。
rem 不写进括号块：PATH 里的 Program Files (x86) 会把块截断
if not exist "%~dp0node\node.exe" goto system
set "PATH=%PATH%;%~dp0node"
"%~dp0node\node.exe" server.js --open
goto done
:system
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 node：请先安装 Node.js 22 或更高版本（https://nodejs.org），装好后再双击此文件。
  pause
  exit /b 1
)
node server.js --open
:done
echo.
echo 桥接已退出（退出码 %errorlevel%）。若不是你按 Ctrl+C 关的，上面的输出就是原因；页面此时已连不上桥接。
pause
