@echo off
REM ---------------------------------------------------------------
REM  Double-click me after a price changes on the website.
REM
REM  Prices live in two places: the website says what a thing costs,
REM  and this Supabase function is what actually charges for it. This
REM  sends the second one. Until it runs, a new price is only a label.
REM ---------------------------------------------------------------
setlocal
cd /d "%~dp0"
set PROJECT=kdxckigyhpnwhwgjdgqq
echo.
echo   Sending prices to Supabase (project %PROJECT%)
echo.

git fetch origin
if errorlevel 1 goto failed
git pull --rebase origin claude/portfolio-website-clone-3kbduv
if errorlevel 1 goto conflicted

REM --project-ref is spelled out so the CLI never asks which project and
REM never gets the wrong answer.
call npx.cmd supabase functions deploy create-app-checkout --project-ref %PROJECT%
if errorlevel 1 goto failed

echo.
echo   Done. The new prices are live.
goto done

:conflicted
git rebase --abort
echo.
echo   Your copy and the website disagree about something, so nothing was
echo   sent. Send Claude this message and he will sort it out.
goto done

:failed
echo.
echo   That did not work. Copy everything above this line and send it to Claude.

:done
echo.
pause
endlocal
