@echo off
setlocal
set "PATH=%LOCALAPPDATA%\agy\bin;%PATH%"
cd /d "%~dp0"
if exist "%LOCALAPPDATA%\agy\bin\agy.exe" set "AGY_BIN=%LOCALAPPDATA%\agy\bin\agy.exe"
if not defined ANODE if exist "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe" set "ANODE=%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
if defined ANODE (
  set "ELECTRON_RUN_AS_NODE=1"
  "%ANODE%" src\server.js %*
) else if exist "%APPDATA%\Antigravity\bin\agy-node.cmd" (
  call "%APPDATA%\Antigravity\bin\agy-node.cmd" src\server.js %*
) else (
  node src\server.js %*
)
