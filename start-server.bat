@echo off
title Virtual Tabletop Local Server
echo ===================================================
echo   Iniciando Servidor Local VTT (localhost:8000)...
echo ===================================================
powershell -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
