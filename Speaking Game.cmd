@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies once...
  call npm install
)
node launcher\start.cjs
