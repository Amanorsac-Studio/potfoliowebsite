@echo off
REM ---------------------------------------------------------------
REM  Double-click me after putting pictures in images\incoming
REM
REM  It commits what you added, brings down whatever changed on the
REM  website since you last looked, replays your pictures on top of
REM  that, and sends them. Nothing goes live - that is a separate
REM  decision, and still yours.
REM ---------------------------------------------------------------
setlocal
cd /d "%~dp0"
echo.
echo   Sending pictures from images\incoming
echo.

git add -A
git diff --cached --quiet
if %errorlevel%==0 (
  echo   Nothing new to send. Are the files in images\incoming ?
  goto done
)

git commit -m "Pictures added %DATE%"
if errorlevel 1 goto failed

echo.
echo   Catching up with the website...
git fetch origin
if errorlevel 1 goto failed

REM Replay your commit on top of whatever the website is now, which is
REM what stops the "CONFLICT" wall when the branch has been rebuilt.
git pull --rebase origin claude/portfolio-website-clone-3kbduv
if errorlevel 1 goto conflicted

git push origin HEAD:claude/portfolio-website-clone-3kbduv
if errorlevel 1 goto failed

echo.
echo   Done. Tell Claude the pictures are in.
goto done

:conflicted
git rebase --abort
echo.
echo   Your copy and the website had changed the same things, so nothing
echo   was sent. Your pictures are safe where they are.
echo.
echo   Send Claude this message and he will sort it out.
goto done

:failed
echo.
echo   That did not work. Copy everything above this line and send it to Claude.

:done
echo.
pause
endlocal
