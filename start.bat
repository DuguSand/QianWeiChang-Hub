@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 goto :no_npm

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 goto :port_busy

if exist "node_modules" goto :deps_ok
echo Installing dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 goto :failed
:deps_ok

if exist "data\feed.json" goto :cache_ok
echo First run: fetching official sources...
call npm run refresh
if errorlevel 1 goto :failed
:cache_ok

echo.
echo WeiChang Hub: http://127.0.0.1:4173
echo Press Ctrl+C to stop.
echo.
call npm start
if errorlevel 1 goto :failed
goto :eof

:port_busy
echo.
echo Port 4173 is already in use.
echo If WeiChang Hub is already running, open:
echo http://127.0.0.1:4173
echo.
echo If another program uses this port, stop it and run this file again.
start "" http://127.0.0.1:4173
ping 127.0.0.1 -n 6 >nul
exit /b 0

:no_npm
echo.
echo Node.js / npm was not found.
echo Install Node.js 18+ first: https://nodejs.org/
pause
exit /b 1

:failed
echo.
echo Startup failed. Check the messages above.
pause
exit /b 1