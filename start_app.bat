@echo off
echo ============================================
echo   Starting RateMyThumb (All Services)
echo ============================================

echo.
echo [1/2] Starting Python Analyzer (port 8001)...
start "Analyzer (Python)" cmd /k "cd /d %~dp0analyzer && python app.py"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Node.js Backend (port 8787)...
start "Backend (Node.js)" cmd /k "cd /d %~dp0backend && node server.js"

timeout /t 2 /nobreak >nul

echo.
echo ============================================
echo   All services started!
echo   Landing page: http://localhost:8787
echo ============================================
echo.
start "" http://localhost:8787
pause
