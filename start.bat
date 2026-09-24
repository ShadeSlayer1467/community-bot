@echo off
setlocal
title Community Bot
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Bot.ps1"
set "botExitCode=%errorlevel%"
echo.
if not "%botExitCode%"=="0" echo Bot could not start or stopped with an error. See the message above.
pause
exit /b %botExitCode%
