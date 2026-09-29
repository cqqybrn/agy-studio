@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title AGY Studio Launcher

echo ===================================================
echo               AGY Studio 启动程序
echo ===================================================
echo.

:: 1. 自动适配 Node.js 常见安装路径（若不在 PATH 中）
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
        set "PATH=%LOCALAPPDATA%\Programs\nodejs;%APPDATA%\npm;%PATH%"
    ) else if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"
    )
)

:: 2. 检查 Node.js 是否安装并检查版本 >= 20
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 未检测到 Node.js 环境！
    echo AGY Studio 需要 Node.js (v20 或更高版本)。
    echo.
    echo 请访问 Node.js 官网下载并安装 LTS 版本：
    echo   https://nodejs.org/
    echo 安装完成后请重新运行本脚本。
    echo ===================================================
    pause
    exit /b 1
)

for /f "tokens=1,2,3 delims=.v" %%a in ('node -v 2^>nul') do (
    set NODE_MAJOR=%%a
)

if not defined NODE_MAJOR (
    echo [警告] 无法准确识别 Node.js 版本，继续尝试启动...
) else (
    if %NODE_MAJOR% LSS 20 (
        echo [错误] 当前 Node.js 版本过低: v%NODE_MAJOR%
        echo AGY Studio 要求 Node.js 版本 ^>= 20.0.0
        echo 请前往 https://nodejs.org/ 下载升级最新 LTS 版本。
        echo ===================================================
        pause
        exit /b 1
    )
    echo [✔] Node.js 环境检查通过: v!NODE_MAJOR!
)

:: 3. 检查 agy CLI 是否存在
set AGY_FOUND=0
where agy >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set AGY_FOUND=1
) else if exist "%LOCALAPPDATA%\agy\bin\agy.cmd" (
    set AGY_FOUND=1
) else if exist "%LOCALAPPDATA%\agy\bin\agy.exe" (
    set AGY_FOUND=1
) else if exist "%USERPROFILE%\.antigravity\bin\agy.cmd" (
    set AGY_FOUND=1
) else if exist "%USERPROFILE%\.antigravity\bin\agy.exe" (
    set AGY_FOUND=1
)

if %AGY_FOUND% EQU 0 (
    echo [警告] 未在系统 PATH 或常见位置检测到 agy CLI 工具。
    echo AGY Studio 底层依赖官方 Antigravity agy CLI 提供 Agent 对话能力。
    echo 若尚未安装 agy，请参考官方指引进行安装并登录：
    echo   https://antigravity.google/docs
    echo.
    echo 如果您已安装在自定义路径，可通过设置环境变量启动：
    echo   set AGY_BIN=C:\path\to\agy.exe
    echo   start.cmd
    echo.
    echo 按任意键将继续尝试启动（部分功能或核心对话可能会受限）...
    pause
) else (
    echo [✔] agy CLI 环境检查通过
)

:: 4. 检查依赖与前端构建物
if not exist "node_modules" (
    echo.
    echo [*] 未检测到根依赖 (node_modules)，正在执行 npm install，请稍候...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [错误] 依赖安装失败，请检查网络或 npm 源配置。
        pause
        exit /b 1
    )
)

if not exist "frontend\dist\index.html" (
    echo.
    echo [*] 未检测到前端构建产物 (frontend\dist)，正在进行首次构建...
    call npm run build -w frontend
    if %ERRORLEVEL% NEQ 0 (
        echo [错误] 前端构建失败，请检查构建日志。
        pause
        exit /b 1
    )
    echo [✔] 前端构建成功！
)

:: 5. 准备启动端口与环境变量
if "%HOST%"=="" set HOST=127.0.0.1
if "%PORT%"=="" set PORT=8790
set TARGET_URL=http://%HOST%:%PORT%

echo.
echo ===================================================
echo  启动服务中: %TARGET_URL%
echo  服务启动完成后将自动唤起默认浏览器打开页面...
echo  提示: 关闭此终端窗口即可终止服务。
echo ===================================================
echo.

:: 6. 在后台异步等待端口就绪后调用默认浏览器打开
start /b cmd /c "for /l %%i in (1,1,30) do ( powershell -NoProfile -Command "(New-Object System.Net.Sockets.TcpClient).Connect('127.0.0.1', %PORT%)" >nul 2>&1 && ( start %TARGET_URL% & exit ) || ( powershell -NoProfile -Command "Start-Sleep -Milliseconds 600" >nul 2>&1 ) )"

:: 7. 启动后端主服务
:: 优先使用 tsx 直接运行源码（无需额外编译 backend/dist，与 npm run dev 契合），若异常则降级为 npm run dev -w backend
call npx tsx backend/src/main.ts
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [提示] 尝试通过 npm run dev -w backend 重新拉起...
    call npm run dev -w backend
)

pause
