@echo off
REM @anchor: run_bat_launcher
REM One-click launcher: verify node + server.js, auto-open browser, run local server in foreground.
REM Keep this file ASCII-only with single-line commands (no labels, no multi-line blocks),
REM because cmd.exe mis-parses LF-only batch files and may exit immediately (window flashes closed).
title context-parser
setlocal
cd /d "%~dp0"

set NO_NODE=
where node >nul 2>nul
if errorlevel 1 set NO_NODE=1
if defined NO_NODE echo [ERROR] Node.js not found. Please install Node.js and add it to PATH.
if defined NO_NODE pause
if defined NO_NODE exit /b 1

set NO_FILE=
if not exist "server.js" set NO_FILE=1
if defined NO_FILE echo [ERROR] server.js not found next to run.bat.
if defined NO_FILE pause
if defined NO_FILE exit /b 1

echo ==================================================
echo  context-parser is starting on port 8317 ...
echo  Browser will open automatically in a few seconds.
echo  Keep this window open, press Ctrl+C to stop the server.
echo ==================================================

start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:8317"

node server.js
if errorlevel 1 echo [WARN] node server.js exited with a non-zero code.

echo.
echo Server stopped.
pause
exit /b 0
