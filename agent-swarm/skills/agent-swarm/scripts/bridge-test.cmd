@echo off
setlocal enabledelayedexpansion
chcp 437 >nul 2>&1

set "NODE=C:\Users\lxjhudan\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
set "CBC=D:\WorkBuddy\resources\app.asar.unpacked\cli\bin\codebuddy"
set "BASE=%~dp0"
set "OUT=%BASE%bridge-result.json"
set "ERR=%BASE%bridge-error.txt"

echo ==========================================================
echo  Bridge test: external shell  --^>  WorkBuddy CLI
echo ==========================================================
echo  NODE = %NODE%
echo  CBC  = %CBC%
echo  OUT  = %OUT%
echo.

if not exist "%NODE%" goto NO_NODE
if not exist "%CBC%"  goto NO_CBC

echo [1/3] version check
"%NODE%" "%CBC%" --version
echo   exit code = %ERRORLEVEL%
echo.

echo [2/3] headless single-shot (stdin closed)
if exist "%OUT%" del /f /q "%OUT%" >nul 2>&1
if exist "%ERR%" del /f /q "%ERR%" >nul 2>&1
"%NODE%" "%CBC%" -p "reply with exactly: BRIDGE_OK" --output-format json < NUL > "%OUT%" 2> "%ERR%"
echo   exit code = %ERRORLEVEL%
echo.

echo [3/3] results
echo ---- STDOUT ----
if exist "%OUT%" (type "%OUT%") else (echo   [no stdout file])
echo.
echo ---- STDERR ----
if exist "%ERR%" (type "%ERR%") else (echo   [no stderr file])
echo.
echo ==========================================================
echo  VERDICT KEY
echo    stdout contains BRIDGE_OK  -^>  path CONFIRMED
echo    both files empty           -^>  path STALLS (see notes)
echo ==========================================================
goto END

:NO_NODE
echo [FAIL] node.exe not found at %NODE%
goto END

:NO_CBC
echo [FAIL] codebuddy CLI not found at %CBC%
goto END

:END
echo.
pause
endlocal
