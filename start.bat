@echo off
rem Double-click this file to start the blog app.
rem (ASCII + CRLF on purpose: UTF-8 Korean text made cmd close instantly on Windows 10.)
cd /d "%~dp0"

set "PORTABLE_NODE=%LOCALAPPDATA%\Programs\node-v24.20.0-win-x64"
if exist "%PORTABLE_NODE%\node.exe" set "PATH=%PORTABLE_NODE%;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js from https://nodejs.org
  pause
  exit /b 1
)

where claude >nul 2>nul
if errorlevel 1 (
  echo claude was not found. Run this once, then try again:
  echo   npm install -g --allow-scripts=@anthropic-ai/claude-code @anthropic-ai/claude-code
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo First run: downloading what the app needs. This takes 3-5 minutes.
  echo Yellow "warn" lines are OK.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo Download failed. Please check your internet connection and try again.
    pause
    exit /b 1
  )
)

if exist .next\BUILD_ID rmdir /s /q .next

echo.
echo ============================================================
echo   Starting the app. DO NOT close this window.
echo   Closing it turns the app off.
echo   Browser address: http://localhost:4123
echo ============================================================
echo.
start "" cmd /c "timeout /t 12 /nobreak >nul & start http://localhost:4123"
call npm run dev

echo.
echo The app has stopped.
pause
