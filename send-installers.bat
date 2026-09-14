@echo off
setlocal enabledelayedexpansion
title Send installers to Cloudflare
cd /d "%~dp0"

rem =====================================================================
rem  Sends app installers up to the amanorsac-downloads R2 bucket, under
rem  the exact names catalog.json tells the Worker to look for.
rem
rem  That last part is the whole point. A file uploaded under any other
rem  name is a file the site cannot find, and the download quietly falls
rem  back to an older build or fails - which is what happened when
rem  version 2 shipped and version 1 came down instead. Here the name is
rem  not typed by anyone: it is written into this file, and rclone
rem  renames on the way up.
rem
rem  Needs rclone configured once against the R2 API token. If it isn't,
rem  this says so and stops.
rem =====================================================================

echo.
echo   SEND INSTALLERS TO CLOUDFLARE
echo   ============================
echo.

where rclone >nul 2>nul
if errorlevel 1 (
  echo   rclone is not installed, or is not on the PATH.
  echo   Get it from https://rclone.org/downloads/ and try again.
  echo.
  pause
  exit /b 1
)

rem ---- which remote: the first one configured ----
set "R2="
for /f "delims=" %%R in ('rclone listremotes 2^>nul') do if not defined R2 set "R2=%%R"
if not defined R2 (
  echo   rclone has no remote set up yet.
  echo   Run  rclone config  and add the Cloudflare R2 token, then come back.
  echo.
  pause
  exit /b 1
)
set "BUCKET=!R2!amanorsac-downloads"
echo   Remote: !R2!   Bucket: amanorsac-downloads
echo.

rem ---- which app ----
echo   Which app are you sending?
echo.
echo     1   Nebula Tide 2        nebulatide2/
echo     2   Nebula Tide          nebulatide/
echo     3   SecondOut            secondout/
echo     4   AMB Analog           ambanalog/
echo     5   Align Pro            alignpro/
echo     6   AFD Gate             afdgate/
echo     7   AETHER               aether/
echo     8   PulseRoom            pulseroom/
echo     9   Stem Sorter          stemsorter/
echo    10   Chordlight 88        chordlight88/
echo.
set "PICK="
set /p "PICK=  Number: "

if "%PICK%"=="1" ( set "NAME=Nebula Tide 2" & set "PREFIX=nebulatide2" & set "WINAS=NebulaTide-Windows.zip"      & set "MACAS=NebulaTide-macOS.zip" )
if "%PICK%"=="2" ( set "NAME=Nebula Tide"   & set "PREFIX=nebulatide"  & set "WINAS=NebulaTide-Windows.zip"      & set "MACAS=NebulaTide-macOS.zip" )
if "%PICK%"=="3" ( set "NAME=SecondOut"     & set "PREFIX=secondout"   & set "WINAS=SecondOut-1.3.2-Setup.exe"   & set "MACAS=SecondOut-1.3.2-macOS.zip" )
if "%PICK%"=="4" ( set "NAME=AMB Analog"    & set "PREFIX=ambanalog"   & set "WINAS=analog-bundle-windows.zip"   & set "MACAS=analog-bundle-macos.zip" )
if "%PICK%"=="5" ( set "NAME=Align Pro"     & set "PREFIX=alignpro"    & set "WINAS=AlignPro-1.0.0-windows.zip"  & set "MACAS=AlignPro-1.0.0-macOS.zip" )
if "%PICK%"=="6" ( set "NAME=AFD Gate"      & set "PREFIX=afdgate"     & set "WINAS=windows-installer.zip"       & set "MACAS=macos-installer.zip" )
if "%PICK%"=="7" ( set "NAME=AETHER"        & set "PREFIX=aether"      & set "WINAS=AETHER-windows.zip"          & set "MACAS=AETHER-macos.zip" )
if "%PICK%"=="8" ( set "NAME=PulseRoom"     & set "PREFIX=pulseroom"   & set "WINAS=PulseRoom-Windows.zip"       & set "MACAS=PulseRoom-macOS.zip" )
if "%PICK%"=="9" ( set "NAME=Stem Sorter"   & set "PREFIX=stemsorter"  & set "WINAS=StemSorter-Windows.zip"      & set "MACAS=StemSorter-macOS.zip" )
if "%PICK%"=="10" ( set "NAME=Chordlight 88" & set "PREFIX=chordlight88" & set "WINAS=Chordlight88-Windows.zip"   & set "MACAS=Chordlight88-macOS.zip" )

if not defined PREFIX (
  echo.
  echo   "%PICK%" is not one of the numbers. Nothing was sent.
  echo.
  pause
  exit /b 1
)

echo.
echo   %NAME%  ^-^>  !PREFIX!/
echo.
echo   Drag the FOLDER holding the new files onto this window and press Enter.
set "SRC="
set /p "SRC=  Folder: "
set "SRC=%SRC:"=%"
if not exist "%SRC%\" (
  echo.
  echo   Cannot find that folder. Nothing was sent.
  echo.
  pause
  exit /b 1
)

rem ---- find the two files, whatever they happen to be called ----
set "WINFILE="
for /f "delims=" %%F in ('dir /b /a-d "%SRC%\*win*.zip" "%SRC%\*Setup*.exe" "%SRC%\*win*.exe" 2^>nul') do (
  if not defined WINFILE set "WINFILE=%SRC%\%%F"
)
set "MACFILE="
for /f "delims=" %%F in ('dir /b /a-d "%SRC%\*mac*.zip" "%SRC%\*osx*.zip" "%SRC%\*.dmg" 2^>nul') do (
  if not defined MACFILE set "MACFILE=%SRC%\%%F"
)

if not defined WINFILE if not defined MACFILE (
  echo.
  echo   No Windows or Mac installer in that folder.
  echo   Looked for a name containing "win" or "mac". Nothing was sent.
  echo.
  pause
  exit /b 1
)

echo.
echo   About to send:
if defined WINFILE echo     "!WINFILE!"
if defined WINFILE echo        as  !PREFIX!/!WINAS!
if defined MACFILE echo     "!MACFILE!"
if defined MACFILE echo        as  !PREFIX!/!MACAS!
echo.
echo   This REPLACES whatever is up there under those names.
set "GO="
set /p "GO=  Type Y to send: "
if /i not "%GO%"=="Y" (
  echo.
  echo   Stopped. Nothing was sent.
  echo.
  pause
  exit /b 0
)

echo.
if defined WINFILE (
  echo   Sending Windows...
  rclone copyto "!WINFILE!" "!BUCKET!/!PREFIX!/!WINAS!" --progress
  if errorlevel 1 goto failed
)
if defined MACFILE (
  echo   Sending Mac...
  rclone copyto "!MACFILE!" "!BUCKET!/!PREFIX!/!MACAS!" --progress
  if errorlevel 1 goto failed
)

echo.
echo   Done. What is up there now:
echo.
rclone lsl "!BUCKET!/!PREFIX!/"
echo.
echo   Send Claude the sizes above and the new version number, so
echo   catalog.json can be brought into step with what you just sent.
echo.
pause
exit /b 0

:failed
echo.
echo   The upload failed. Nothing else was sent.
echo   If it says the token is wrong, make a new R2 API token and run
echo   rclone config again.
echo.
pause
exit /b 1
