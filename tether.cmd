@echo off
rem Launch Tether and open it in the default browser.
setlocal
cd /d "%~dp0"
start "" http://localhost:7845
node server.mjs
