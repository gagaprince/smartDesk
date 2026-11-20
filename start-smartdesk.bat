@echo off
title SmartDesk Dev Launcher
cd /d E:\aiwork\smartDesk
call npm run electron:serve
echo.
echo SmartDesk exited. Press any key to close this window.
pause >nul