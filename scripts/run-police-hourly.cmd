@echo off
setlocal
chcp 65001 > nul

cd /d "%~dp0.."
if not exist "logs" mkdir "logs"

>>"logs\police-hourly.log" echo [%date% %time%] start police hourly fetch
"C:\Program Files\nodejs\node.exe" --env-file=.env scripts\fetch-live.mjs --sources=police>> "logs\police-hourly.log" 2>&1
set "EXITCODE=%ERRORLEVEL%"
>>"logs\police-hourly.log" echo [%date% %time%] exit %EXITCODE%

exit /b %EXITCODE%
