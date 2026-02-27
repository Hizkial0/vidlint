
@echo off
echo Stopping existing processes...
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM python.exe >nul 2>&1

echo Starting Python Analyzer...
start "CV Analyzer" /min python ../analyzer/app.py

timeout /t 3 /nobreak >nul

echo Starting Backend Server...
node server.js
