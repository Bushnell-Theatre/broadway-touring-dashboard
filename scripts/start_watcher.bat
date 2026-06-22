@echo off
title Broadway Touring Dashboard — File Watcher
echo ============================================================
echo  Broadway Touring Dashboard — File Watcher
echo  Bushnell Center for the Performing Arts
echo ============================================================
echo.
echo  Watching for new Broadway League weekly report files.
echo  Do not close this window while the watcher is running.
echo  Press Ctrl+C to stop.
echo.

cd /d "%~dp0"

:: Check Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Make sure Python is installed and on your PATH.
    pause
    exit /b 1
)

:: Install watchdog if not present
pip show watchdog >nul 2>&1
if errorlevel 1 (
    echo Installing watchdog...
    pip install watchdog --quiet
)

:: Start the watcher
python watcher.py

pause
