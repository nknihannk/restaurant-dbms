@echo off
rem Double-click this file to set up and start the restaurant app.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

if exist .env goto haveenv
echo.
set /p DBPW=Enter your MySQL root password:
> .env echo DB_HOST=127.0.0.1
>> .env echo DB_PORT=3306
>> .env echo DB_USER=root
>> .env echo DB_PASSWORD=%DBPW%
>> .env echo PORT=3000

:haveenv
if exist node_modules goto havemods
echo Installing the one required package (needs internet, first time only)...
call npm install
if errorlevel 1 goto fail

:havemods
call npm run setup
if errorlevel 1 goto fail
call npm start
pause
exit /b 0

:nonode
echo Node.js is not installed. Install the LTS version from nodejs.org, then run this again.
pause
exit /b 1

:fail
echo.
echo Something failed. Read the message above.
echo If the password was wrong, delete the file named .env in this folder and run this again.
pause
exit /b 1
