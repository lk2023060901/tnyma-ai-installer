@echo off
setlocal

echo ==^> Stopping TnymaAI / OpenClaw related processes
taskkill /F /IM "TnymaAI.exe" >nul 2>&1
taskkill /F /IM "openclaw.exe" >nul 2>&1
taskkill /F /FI "IMAGENAME eq tnyma-ai*" >nul 2>&1
timeout /t 1 /nobreak >nul

echo ==^> Removing persisted app state

set "APPDATA_DIR=%APPDATA%"
set "LOCALAPPDATA_DIR=%LOCALAPPDATA%"
set "HOMEDIR=%USERPROFILE%"

if exist "%APPDATA_DIR%\tnyma-ai" rmdir /s /q "%APPDATA_DIR%\tnyma-ai"
if exist "%APPDATA_DIR%\OpenClaw" rmdir /s /q "%APPDATA_DIR%\OpenClaw"
if exist "%LOCALAPPDATA_DIR%\tnyma-ai" rmdir /s /q "%LOCALAPPDATA_DIR%\tnyma-ai"
if exist "%LOCALAPPDATA_DIR%\OpenClaw" rmdir /s /q "%LOCALAPPDATA_DIR%\OpenClaw"
if exist "%HOMEDIR%\.openclaw" rmdir /s /q "%HOMEDIR%\.openclaw"
if exist "%HOMEDIR%\.tnyma-ai" rmdir /s /q "%HOMEDIR%\.tnyma-ai"

echo ==^> Cleanup complete
echo Removed:
echo   %APPDATA_DIR%\tnyma-ai
echo   %APPDATA_DIR%\OpenClaw
echo   %LOCALAPPDATA_DIR%\tnyma-ai
echo   %LOCALAPPDATA_DIR%\OpenClaw
echo   %HOMEDIR%\.openclaw
echo   %HOMEDIR%\.tnyma-ai
echo.
echo You can now reopen TnymaAI and it should start from the first setup step.

endlocal
