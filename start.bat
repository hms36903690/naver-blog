@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo 처음 실행이라 필요한 프로그램을 내려받습니다. 3~5분 걸립니다...
  call npm install || (echo 내려받기에 실패했습니다. 인터넷 연결을 확인해 주세요. & pause & exit /b 1)
)
if exist .next\BUILD_ID rmdir /s /q .next
echo 앱을 켭니다. 이 창은 닫지 마세요. 닫으면 앱이 꺼집니다.
start "" http://localhost:4123
call npm run dev
pause
