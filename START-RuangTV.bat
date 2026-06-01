@echo off
chcp 65001 >nul
title RuangTV Server — Ruangprint HO

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║      RuangTV — Starting Server...        ║
echo  ╚══════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js tidak ditemukan!
    echo  Download: https://nodejs.org
    pause
    exit /b 1
)

:: Check server.js
if not exist "server.js" (
    echo  [ERROR] server.js tidak ditemukan di folder ini!
    echo  Pastikan kamu menjalankan file ini dari folder RuangTV-1
    pause
    exit /b 1
)

:: Check node_modules
if not exist "node_modules" (
    echo  [INFO] node_modules belum ada. Menjalankan npm install...
    call npm install
    echo.
)

:: Get local IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set LOCAL_IP=%%a
    goto :found_ip
)
:found_ip
set LOCAL_IP=%LOCAL_IP: =%

echo  ╔══════════════════════════════════════════════════════════╗
echo  ║                 RuangTV Server AKTIF                     ║
echo  ╠══════════════════════════════════════════════════════════╣
echo  ║  Dashboard HO  : http://localhost:3001                   ║
echo  ║  API Base      : http://localhost:3001/api               ║
echo  ║  Network       : http://%LOCAL_IP%:3001        ║
echo  ╠══════════════════════════════════════════════════════════╣
echo  ║  Smart TV cabang connect ke:                             ║
echo  ║  ws://%LOCAL_IP%:3001/ws?branch=DMB^&key=...   ║
echo  ╠══════════════════════════════════════════════════════════╣
echo  ║  Login: admin / ruangprint2025                           ║
echo  ║  Tekan Ctrl+C untuk stop server                          ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

node server.js

echo.
echo  Server berhenti.
pause
