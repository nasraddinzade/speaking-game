@echo off
rem Starts the server and the game window without leaving a console open.
rem Same as the desktop shortcut (npm run shortcut).
cd /d "%~dp0"
start "" wscript.exe "%~dp0launcher\start-hidden.vbs"
