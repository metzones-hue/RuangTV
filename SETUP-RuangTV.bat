@echo off
chcp 65001 >nul
title RuangTV — Setup Otomatis

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║     RuangTV Backend — Setup Otomatis     ║
echo  ╚══════════════════════════════════════════╝
echo.

:: ── Check Node.js ──────────────────────────────────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js belum terinstall!
    echo.
    echo  Download di: https://nodejs.org  (pilih LTS)
    echo  Setelah install, jalankan ulang file ini.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% ditemukan
echo.

:: ── Detect script location ─────────────────────────────────────────────────
set SCRIPT_DIR=%~dp0
echo  [INFO] Folder ini: %SCRIPT_DIR%
echo.

:: ── Create folder structure ────────────────────────────────────────────────
echo  [1/5] Membuat struktur folder...

if not exist "%SCRIPT_DIR%src" mkdir "%SCRIPT_DIR%src"
if not exist "%SCRIPT_DIR%uploads" mkdir "%SCRIPT_DIR%uploads"
if not exist "%SCRIPT_DIR%public" mkdir "%SCRIPT_DIR%public"

:: Move src files into src/ if they're in root
if exist "%SCRIPT_DIR%auth.js" (
    echo        Memindahkan auth.js ke src\...
    move /y "%SCRIPT_DIR%auth.js" "%SCRIPT_DIR%src\auth.js" >nul
)
if exist "%SCRIPT_DIR%database.js" (
    echo        Memindahkan database.js ke src\...
    move /y "%SCRIPT_DIR%database.js" "%SCRIPT_DIR%src\database.js" >nul
)
if exist "%SCRIPT_DIR%routes.js" (
    echo        Memindahkan routes.js ke src\...
    move /y "%SCRIPT_DIR%routes.js" "%SCRIPT_DIR%src\routes.js" >nul
)
if exist "%SCRIPT_DIR%websocket.js" (
    echo        Memindahkan websocket.js ke src\...
    move /y "%SCRIPT_DIR%websocket.js" "%SCRIPT_DIR%src\websocket.js" >nul
)

:: Copy HTML files to public/
if exist "%SCRIPT_DIR%ruangtv-dashboard.html" (
    echo        Menyalin HTML ke public\...
    copy /y "%SCRIPT_DIR%ruangtv-dashboard.html" "%SCRIPT_DIR%public\index.html" >nul
    copy /y "%SCRIPT_DIR%ruangtv-dashboard.html" "%SCRIPT_DIR%public\ruangtv-dashboard.html" >nul
)
if exist "%SCRIPT_DIR%ruangtv-schedule.html" (
    copy /y "%SCRIPT_DIR%ruangtv-schedule.html" "%SCRIPT_DIR%public\ruangtv-schedule.html" >nul
)
if exist "%SCRIPT_DIR%ruangtv-upload.html" (
    copy /y "%SCRIPT_DIR%ruangtv-upload.html" "%SCRIPT_DIR%public\ruangtv-upload.html" >nul
)
if exist "%SCRIPT_DIR%ruangtv-player.html" (
    copy /y "%SCRIPT_DIR%ruangtv-player.html" "%SCRIPT_DIR%public\ruangtv-player.html" >nul
)

echo  [OK] Struktur folder siap
echo.

:: ── Create .env if not exists ──────────────────────────────────────────────
echo  [2/5] Membuat file konfigurasi .env...
if not exist "%SCRIPT_DIR%.env" (
    (
        echo PORT=3001
        echo JWT_SECRET=ruangtv-secret-key-ruangprint-2025-ganti-ini
        echo ADMIN_USERNAME=admin
        echo ADMIN_PASSWORD=ruangprint2025
    ) > "%SCRIPT_DIR%.env"
    echo  [OK] .env dibuat dengan konfigurasi default
) else (
    echo  [OK] .env sudah ada, dilewati
)
echo.

:: ── Create package.json if not exists ─────────────────────────────────────
echo  [3/5] Membuat package.json...
if not exist "%SCRIPT_DIR%package.json" (
    (
        echo {
        echo   "name": "ruangtv-backend",
        echo   "version": "1.0.0",
        echo   "description": "RuangTV Digital Signage Backend",
        echo   "main": "server.js",
        echo   "scripts": {
        echo     "start": "node server.js",
        echo     "dev": "node --watch server.js"
        echo   },
        echo   "dependencies": {
        echo     "cors": "^2.8.5",
        echo     "dotenv": "^16.3.1",
        echo     "express": "^4.18.2",
        echo     "multer": "^1.4.5-lts.1",
        echo     "sql.js": "^1.10.2",
        echo     "ws": "^8.14.2"
        echo   }
        echo }
    ) > "%SCRIPT_DIR%package.json"
    echo  [OK] package.json dibuat
) else (
    echo  [OK] package.json sudah ada
)
echo.

:: ── Install npm packages ───────────────────────────────────────────────────
echo  [4/5] Menginstall dependencies (butuh internet)...
echo        Ini mungkin makan 1-2 menit...
echo.
cd /d "%SCRIPT_DIR%"
call npm install --save express cors multer sql.js ws dotenv 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [WARNING] npm install ada error. Coba jalankan manual:
    echo  cd "%SCRIPT_DIR%"
    echo  npm install
) else (
    echo.
    echo  [OK] Dependencies berhasil diinstall
)
echo.

:: ── Test server ────────────────────────────────────────────────────────────
echo  [5/5] Verifikasi instalasi...
node -e "require('express'); require('ws'); require('sql.js'); require('dotenv'); require('cors'); require('multer'); console.log('OK');" 2>nul
if %errorlevel% equ 0 (
    echo  [OK] Semua package siap
) else (
    echo  [WARNING] Ada package yang belum terinstall. Coba npm install manual.
)
echo.

:: ── Done! ──────────────────────────────────────────────────────────────────
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║                   SETUP SELESAI!                         ║
echo  ╠══════════════════════════════════════════════════════════╣
echo  ║  Untuk menjalankan server:                               ║
echo  ║                                                          ║
echo  ║    1. Double-click: START-RuangTV.bat                    ║
echo  ║    atau                                                  ║
echo  ║    1. Buka CMD/Terminal di folder ini                    ║
echo  ║    2. Ketik: node server.js                              ║
echo  ║    3. Buka browser: http://localhost:3001                ║
echo  ║                                                          ║
echo  ║  Login default:                                          ║
echo  ║    Username : admin                                      ║
echo  ║    Password : ruangprint2025                             ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.
pause
