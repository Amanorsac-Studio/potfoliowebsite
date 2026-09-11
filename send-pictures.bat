@echo off
REM ---------------------------------------------------------------
REM  Double-click me after putting pictures in images\incoming
REM  Sends them to the website's repository. Nothing goes live -
REM  that is a separate decision, and still yours.
REM ---------------------------------------------------------------
cd /d "%~dp0"
echo.
echo   Sending pictures from images\incoming
echo.

git add -A
git diff --cached --quiet
if %errorlevel%==0 (
  echo   Nothing new to send. Did the files go in images\incoming ?
  echo.
  pause
  exit /b 0
)

git commit -m "Pictures added %DATE%"
if errorlevel 1 goto failed

git push
if errorlevel 1 goto failed

echo.
echo   Done. Tell Claude the pictures are in.
echo.
pause
exit /b 0

:failed
echo.
echo   That did not work. Copy everything above this line and send it to Claude.
echo.
pause
exit /b 1
