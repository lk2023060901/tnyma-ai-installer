@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "APPDATA_DIR=%APPDATA%"
set "LOCALAPPDATA_DIR=%LOCALAPPDATA%"
set "HOMEDIR=%USERPROFILE%"
set "CLI_DIR=%SCRIPT_DIR%\resources\cli"
set "START_MENU_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs"
set "STARTUP_DIR=%START_MENU_DIR%\Startup"
set "DESKTOP_DIR=%USERPROFILE%\Desktop"
set "UNINSTALLER=%SCRIPT_DIR%\Uninstall TnymaAI.exe"

echo ==^> Stopping TnymaAI / OpenClaw related processes
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$root = [System.IO.Path]::GetFullPath('%SCRIPT_DIR%');" ^
  "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }" >nul 2>&1
taskkill /F /IM "TnymaAI.exe" >nul 2>&1
taskkill /F /IM "openclaw.exe" >nul 2>&1
taskkill /F /FI "IMAGENAME eq tnyma-ai*" >nul 2>&1
timeout /t 1 /nobreak >nul

echo ==^> Removing launch-at-startup entries
for %%K in ("TnymaAI" "tnyma-ai" "app.tnyma-ai.desktop") do (
  reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "%%~K" /f >nul 2>&1
  reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" /v "%%~K" /f >nul 2>&1
)

echo ==^> Removing CLI PATH entry
if exist "%CLI_DIR%\update-user-path.ps1" (
  powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%CLI_DIR%\update-user-path.ps1" -Action remove -CliDir "%CLI_DIR%" >nul 2>&1
)

echo ==^> Removing shortcuts
if exist "%DESKTOP_DIR%\TnymaAI.lnk" del /f /q "%DESKTOP_DIR%\TnymaAI.lnk" >nul 2>&1
if exist "%START_MENU_DIR%\TnymaAI.lnk" del /f /q "%START_MENU_DIR%\TnymaAI.lnk" >nul 2>&1
if exist "%START_MENU_DIR%\Uninstall TnymaAI.lnk" del /f /q "%START_MENU_DIR%\Uninstall TnymaAI.lnk" >nul 2>&1
if exist "%STARTUP_DIR%\TnymaAI.lnk" del /f /q "%STARTUP_DIR%\TnymaAI.lnk" >nul 2>&1
if exist "%START_MENU_DIR%\TnymaAI" rmdir /s /q "%START_MENU_DIR%\TnymaAI" >nul 2>&1

echo ==^> Removing persisted app state
call :remove_dir "%APPDATA_DIR%\tnyma-ai"
call :remove_dir "%APPDATA_DIR%\OpenClaw"
call :remove_dir "%LOCALAPPDATA_DIR%\tnyma-ai"
call :remove_dir "%LOCALAPPDATA_DIR%\OpenClaw"
call :remove_dir "%HOMEDIR%\.openclaw"
call :remove_dir "%HOMEDIR%\.tnyma-ai"

echo ==^> Cleanup complete
echo Removed data/state from:
echo   %APPDATA_DIR%\tnyma-ai
echo   %APPDATA_DIR%\OpenClaw
echo   %LOCALAPPDATA_DIR%\tnyma-ai
echo   %LOCALAPPDATA_DIR%\OpenClaw
echo   %HOMEDIR%\.openclaw
echo   %HOMEDIR%\.tnyma-ai
echo.

if exist "%UNINSTALLER%" (
  echo Program files are still installed under:
  echo   %SCRIPT_DIR%
  echo.
  echo Launching the bundled uninstaller to remove TnymaAI itself...
  cd /d "%TEMP%"
  start "" "%UNINSTALLER%"
  goto done
)

echo Installed program files were not removed because no uninstaller was found next to this script.
echo You can now reopen TnymaAI and it should start from the first setup step.
goto done

:remove_dir
if exist "%~1" rmdir /s /q "%~1" >nul 2>&1
if exist "%~1" (
  timeout /t 1 /nobreak >nul
  rmdir /s /q "%~1" >nul 2>&1
)
goto :eof

:done
endlocal
