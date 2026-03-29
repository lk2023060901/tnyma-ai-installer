@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

where pnpm >nul 2>&1
if errorlevel 1 (
    where corepack >nul 2>&1
    if errorlevel 1 (
        echo pnpm is not installed or not on PATH. >&2
        exit /b 1
    )
    echo ==^> Activating pnpm via corepack
    corepack enable >nul 2>&1
    corepack prepare pnpm@10.31.0 --activate
    where pnpm >nul 2>&1
    if errorlevel 1 (
        echo pnpm is not installed or not on PATH. >&2
        exit /b 1
    )
)

if not exist package.json (
    echo Run this script from the repository root. >&2
    exit /b 1
)
if not exist pnpm-lock.yaml (
    echo Run this script from the repository root. >&2
    exit /b 1
)

echo ==^> Installing dependencies
call pnpm install --frozen-lockfile
if errorlevel 1 (
    echo ==^> pnpm install failed, retrying without proxy
    set "HTTP_PROXY="
    set "HTTPS_PROXY="
    set "ALL_PROXY="
    set "http_proxy="
    set "https_proxy="
    set "all_proxy="
    call pnpm install --frozen-lockfile
    if errorlevel 1 exit /b 1
)

if not exist "resources\bin\win32-x64\uv.exe" (
    echo ==^> Downloading Windows uv binaries
    call pnpm run uv:download:win
    if errorlevel 1 (
        echo ==^> uv download failed, retrying without proxy
        set "HTTP_PROXY="
        set "HTTPS_PROXY="
        set "ALL_PROXY="
        set "http_proxy="
        set "https_proxy="
        set "all_proxy="
        call pnpm run uv:download:win
        if errorlevel 1 exit /b 1
    )
) else (
    echo ==^> Windows uv binaries already present
)

for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "VERSION=%%v"

echo ==^> Stopping stale packaging processes
taskkill /F /FI "IMAGENAME eq electron-builder*" >nul 2>&1
taskkill /F /FI "IMAGENAME eq app-builder*" >nul 2>&1
timeout /t 1 /nobreak >nul

echo ==^> Cleaning previous Windows packaging outputs
if exist "release\win-unpacked" rmdir /s /q "release\win-unpacked"
if exist "release\win-ia32-unpacked" rmdir /s /q "release\win-ia32-unpacked"
del /f /q "release\TnymaAI-!VERSION!-win-x64.exe" 2>nul
del /f /q "release\TnymaAI-!VERSION!-win-x64.exe.blockmap" 2>nul
del /f /q "release\TnymaAI-!VERSION!-win-x64.zip" 2>nul
del /f /q "release\TnymaAI-!VERSION!-win-ia32.exe" 2>nul
del /f /q "release\TnymaAI-!VERSION!-win-ia32.exe.blockmap" 2>nul
del /f /q "release\latest.yml" 2>nul
if exist "release\github" rmdir /s /q "release\github"

echo ==^> Rebuilding app bundles
call pnpm run package
if errorlevel 1 (
    echo ==^> pnpm run package failed, retrying without proxy
    set "HTTP_PROXY="
    set "HTTPS_PROXY="
    set "ALL_PROXY="
    set "http_proxy="
    set "https_proxy="
    set "all_proxy="
    call pnpm run package
    if errorlevel 1 exit /b 1
)

echo ==^> Building Windows NSIS installer (x64)
call pnpm exec electron-builder --win nsis --x64 --publish never
if errorlevel 1 (
    echo ==^> electron-builder failed, retrying without proxy
    set "HTTP_PROXY="
    set "HTTPS_PROXY="
    set "ALL_PROXY="
    set "http_proxy="
    set "https_proxy="
    set "all_proxy="
    call pnpm exec electron-builder --win nsis --x64 --publish never
    if errorlevel 1 exit /b 1
)

if not exist "release\TnymaAI-!VERSION!-win-x64.exe" (
    echo Missing artifact: release\TnymaAI-!VERSION!-win-x64.exe >&2
    exit /b 1
)

echo ==^> Done
dir /b "release\TnymaAI-!VERSION!*" 2>nul

endlocal
