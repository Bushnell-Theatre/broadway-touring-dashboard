@echo off
title Broadway Touring Dashboard — Full Update
echo ============================================================
echo  Broadway Touring Dashboard — Full Update
echo  Bushnell Center for the Performing Arts
echo ============================================================
echo.

cd /d "%~dp0"

:: Check Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Make sure Python is installed and on your PATH.
    pause
    exit /b 1
)

:: If an XLSX file was dragged onto this bat, append it.
:: Otherwise run enrichment-only refresh.
if "%~1"=="" (
    echo No file provided. Running enrichment and context refresh only.
    echo To update touring data, drag an XLSX file onto this script.
    echo.
    python update_all.py
) else (
    echo Appending new report: %~1
    echo.
    python update_all.py --append "%~1"
)

echo.
if errorlevel 1 (
    echo ============================================================
    echo  Update FAILED. Check update_all.log for details.
    echo ============================================================
) else (
    echo ============================================================
    echo  Update complete. Dashboard will be live in ~30 seconds.
    echo ============================================================
)
echo.
pause
