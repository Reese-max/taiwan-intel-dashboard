@echo off
setlocal
chcp 65001 > nul

REM Daily news refresh loop: re-fetch Taiwan news (twnews) + missing persons once per day,
REM which rebuilds data/network.json so the intelligence network changes daily.
REM Police/judicial churn stays on the separate hourly loop; other sources carry over.

cd /d "%~dp0.."
if not exist "logs" mkdir "logs"

:loop
>>"logs\daily-refresh-loop.log" echo [%date% %time%] daily refresh tick
>>"logs\daily-refresh.log" echo [%date% %time%] start daily news refresh
"C:\Program Files\nodejs\node.exe" --env-file=.env scripts\fetch-live.mjs --sources=twnews,missing >> "logs\daily-refresh.log" 2>&1
>>"logs\daily-refresh.log" echo [%date% %time%] exit %ERRORLEVEL%
timeout /t 86400 /nobreak > nul
goto loop
