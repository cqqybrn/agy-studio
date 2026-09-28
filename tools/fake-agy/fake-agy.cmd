@echo off
setlocal
node --import tsx "%~dp0main.ts" %*
