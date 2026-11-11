@echo off
rem Update the app from the newest naver-blog-main*.zip in your Downloads folder.
rem Keeps your data folder (logins, posts, learned style) and .env.local (keys) untouched.
rem (ASCII + CRLF on purpose: UTF-8 Korean text made cmd close instantly on Windows 10.)
cd /d "%~dp0"

echo.
echo ============================================================
echo   UPDATE - Please close the app window (black window) first.
echo   Your data folder and .env.local will NOT be touched.
echo ============================================================
echo.
pause

set "PORTABLE_NODE=%LOCALAPPDATA%\Programs\node-v24.20.0-win-x64"
if exist "%PORTABLE_NODE%\node.exe" set "PATH=%PORTABLE_NODE%;%PATH%"

set "ZIP="
for /f "delims=" %%F in ('dir /b /o-d "%USERPROFILE%\Downloads\naver-blog-main*.zip" 2^>nul') do (
  if not defined ZIP set "ZIP=%USERPROFILE%\Downloads\%%F"
)
if not defined ZIP (
  echo No naver-blog-main zip file found in your Downloads folder.
  echo Download it first:
  echo   https://github.com/hms36903690/naver-blog/archive/refs/heads/main.zip
  pause
  exit /b 1
)
echo Using: %ZIP%

set "TMPDIR=%TEMP%\naver-blog-update"
if exist "%TMPDIR%" rmdir /s /q "%TMPDIR%"
powershell -NoProfile -Command "Expand-Archive -LiteralPath $env:ZIP -DestinationPath $env:TMPDIR -Force"
if not exist "%TMPDIR%\naver-blog-main\package.json" (
  echo Could not unpack the zip file. Take a screenshot of this window and send it to Claude.
  pause
  exit /b 1
)

rem Copy new files over this folder, but never data, .env.local, node_modules, .next
robocopy "%TMPDIR%\naver-blog-main" "%~dp0." /E /NFL /NDL /NJH /NJS /NP /XD data node_modules .next /XF .env.local
if errorlevel 8 (
  echo Copy failed. Take a screenshot of this window and send it to Claude.
  pause
  exit /b 1
)
rmdir /s /q "%TMPDIR%"
if exist .next rmdir /s /q .next

echo.
echo Updating the parts the app needs (a minute or two)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo Install failed. Take a screenshot of this window and send it to Claude.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   Update finished. Double-click "start" to open the app.
echo ============================================================
pause
