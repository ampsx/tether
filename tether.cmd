@echo off
rem Launch Tether and open it in the default browser.
setlocal
cd /d "%~dp0"
title Tether

rem node comes from fnm, which does not put itself on the machine PATH — a
rem double-clicked shortcut gets no shell profile, so find it directly. The
rem "aliases\default" junction is the stable handle; the multishell directory
rem the profile normally uses is created per session.
where node >nul 2>&1
if errorlevel 1 (
  if exist "%APPDATA%\fnm\aliases\default\node.exe" (
    set "PATH=%APPDATA%\fnm\aliases\default;%PATH%"
  ) else (
    for /f "delims=" %%v in ('dir /b /ad /o-n "%APPDATA%\fnm\node-versions" 2^>nul') do (
      if not defined FOUND_NODE if exist "%APPDATA%\fnm\node-versions\%%v\installation\node.exe" (
        set "FOUND_NODE=1"
        set "PATH=%APPDATA%\fnm\node-versions\%%v\installation;%PATH%"
      )
    )
  )
)

where node >nul 2>&1
if errorlevel 1 (
  echo Tether needs Node.js, which does not appear to be installed.
  echo Install the LTS build from https://nodejs.org and run this again.
  pause
  exit /b 1
)

rem Give the server a moment to bind before the browser asks for the page.
start "" /min cmd /c "timeout /t 2 >nul & start "" http://localhost:7845"
node server.mjs
echo.
echo Tether has stopped. Close this window, or run tether.cmd again.
pause
