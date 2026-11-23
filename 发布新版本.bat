@echo off
chcp 65001 >nul
cd /d "%~dp0"
title PMS 发布新版本
echo.
echo  即将发布物业管理系统到生产服务器...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\publish.ps1"
echo.
pause
