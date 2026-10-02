@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js topilmadi. https://nodejs.org dan LTS versiyasini o'rnating, keyin qayta ishga tushiring.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Kutubxonalar o'rnatilmoqda, bir oz kuting...
  call npm install
)
if not exist .env (
  copy .env.example .env >nul
  echo .env fayli yaratildi. Notepad ochiladi: qiymatlarni yozing, saqlang va bu faylni qayta ishga tushiring.
  notepad .env
  pause
  exit /b 1
)
call npm run local
echo.
echo Bot to'xtadi.
pause
