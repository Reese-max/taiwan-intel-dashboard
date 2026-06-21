@echo off
setlocal
chcp 65001 > nul

cd /d "%~dp0.."
if not exist "logs" mkdir "logs"

:loop
>>"logs\police-hourly-loop.log" echo [%date% %time%] loop tick
call "%~dp0run-police-hourly.cmd"
timeout /t 3600 /nobreak > nul
goto loop
