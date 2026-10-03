@echo off
setlocal enabledelayedexpansion
title AGY Studio Launcher
cd /d "%~dp0"

echo ===================================================
echo               AGY Studio Launcher
echo ===================================================
echo.

rem NOTE: keep this file ASCII-only with CRLF line endings. cmd.exe parses
rem UTF-8 / LF-only batch files incorrectly on non-UTF-8 Windows code pages,
rem which makes the window close immediately.

rem 1. Add common Node.js install locations to PATH if node is not found
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
        set "PATH=%LOCALAPPDATA%\Programs\nodejs;%APPDATA%\npm;%PATH%"
    ) else if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"
    )
)

rem 2. Check Node.js is installed and version >= 20
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js not found.
    echo AGY Studio needs Node.js v20 or newer.
    echo.
    echo Download the LTS version from https://nodejs.org/
    echo then run this script again.
    echo ===================================================
    pause
    exit /b 1
)

for /f "tokens=1,2,3 delims=.v" %%a in ('node -v 2^>nul') do (
    set NODE_MAJOR=%%a
)

if not defined NODE_MAJOR (
    echo [WARN] Could not detect the Node.js version, trying to continue...
) else (
    if !NODE_MAJOR! LSS 20 (
        echo [ERROR] Node.js version too old: v!NODE_MAJOR!
        echo AGY Studio requires Node.js ^>= 20.0.0
        echo Download the latest LTS from https://nodejs.org/
        echo ===================================================
        pause
        exit /b 1
    )
    echo [OK] Node.js check passed: v!NODE_MAJOR!
)

rem 3. Check that the agy CLI exists
set AGY_FOUND=0
where agy >nul 2>&1
if %ERRORLEVEL% EQU 0 set AGY_FOUND=1
if exist "%LOCALAPPDATA%\agy\bin\agy.cmd" set AGY_FOUND=1
if exist "%LOCALAPPDATA%\agy\bin\agy.exe" set AGY_FOUND=1
if exist "%USERPROFILE%\.antigravity\bin\agy.cmd" set AGY_FOUND=1
if exist "%USERPROFILE%\.antigravity\bin\agy.exe" set AGY_FOUND=1
if defined AGY_BIN set AGY_FOUND=1

if %AGY_FOUND% EQU 0 (
    echo [WARN] The agy CLI was not found on PATH or in the usual locations.
    echo AGY Studio relies on the official Antigravity agy CLI for agent chat.
    echo Install and log in to agy first, see:
    echo   https://antigravity.google/docs
    echo.
    echo If agy is installed in a custom path, set AGY_BIN before starting:
    echo   set AGY_BIN=C:\path\to\agy.exe
    echo   start.cmd
    echo.
    echo Press any key to continue anyway - some features may be limited...
    pause
) else (
    echo [OK] agy CLI check passed
)

rem 4. Check dependencies and the frontend build
if not exist "node_modules" (
    echo.
    echo [*] node_modules not found, running npm install, please wait...
    call npm install
    if !ERRORLEVEL! NEQ 0 (
        echo [ERROR] npm install failed. Check your network or npm registry settings.
        pause
        exit /b 1
    )
)

if not exist "frontend\dist\index.html" (
    echo.
    echo [*] frontend\dist not found, running the first-time frontend build...
    call npm run build -w frontend
    if !ERRORLEVEL! NEQ 0 (
        echo [ERROR] Frontend build failed. See the log above.
        pause
        exit /b 1
    )
    echo [OK] Frontend build finished
)

rem 5. Host / port
if "%HOST%"=="" set HOST=127.0.0.1
if "%PORT%"=="" set PORT=8790
set TARGET_URL=http://%HOST%:%PORT%

echo.
echo ===================================================
echo  Starting server: %TARGET_URL%
echo  The default browser opens automatically once it is ready.
echo  Close this window to stop the server.
echo ===================================================
echo.

rem 6. In the background, wait for the port and then open the browser
start "" /b powershell -NoProfile -Command "for($i=0;$i -lt 30;$i++){ try{ (New-Object Net.Sockets.TcpClient).Connect('%HOST%',%PORT%); Start-Process '%TARGET_URL%'; break }catch{ Start-Sleep -Milliseconds 600 } }"

rem 7. Start the backend (tsx on the sources, fall back to npm run dev)
call npx tsx backend/src/main.ts
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [INFO] Retrying through npm run dev -w backend ...
    call npm run dev -w backend
)

echo.
echo Server stopped.
pause
