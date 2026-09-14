@echo off
chcp 65001 >nul
title 言下本机桥接 - 请保持开启
cd /d "%~dp0"
node server.js --open
if errorlevel 1 pause
