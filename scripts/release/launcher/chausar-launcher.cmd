@echo off
rem Chausar launcher stub (Windows, experimental: checked statically and under Wine's cmd on Linux;
rem it has not yet run on Windows).
rem Installed as <installRoot>\chausar-launcher.cmd by `update-launch.ts adopt`, in front of
rem <installRoot>\versions\<version>\ and <installRoot>\current.json. Same design as chausar-launcher.sh.
rem
rem The stub never edits current.json. An installed Chausar executable, run in Node mode
rem (ELECTRON_RUN_AS_NODE=1), resolves the launch with the app's own InstallLayout (shared lock, full
rem validation): it counts one launch of a version on trial and, after two launches the new version
rem never confirmed, returns the pointer to the previous version. While a version is on trial its
rem predecessor resolves first, so a broken new build cannot block its own rollback. The stub then
rem starts the chosen executable with CHAUSAR_INSTALL_ROOT set and returns its exit code.
rem
rem Quoting: delayed expansion is off except in two short scopes that touch no path, so "!" in a path
rem is literal; every path is used inside double quotes, so "&", "^", "(" and ")" are literal; values
rem from files and folder names arrive through FOR variables or SET, which are never parsed again, and
rem no CALL re-expands "%".
setlocal EnableExtensions DisableDelayedExpansion
set "root=%~dp0"
if "%root:~-1%"=="\" set "root=%root:~0,-1%"
set "name=Chausar.exe"
rem A plain file name only: letters, digits, dot, underscore and hyphen, starting with a letter or digit.
rem An override is read through FOR from SET's raw output, never expanded on a command line, and
rem checked with delayed expansion inside its own scope (so "!", quotes and "&" in it stay data).
if not defined CHAUSAR_EXECUTABLE_NAME goto name_chosen
set "name="
for /f "tokens=1,* delims==" %%A in ('set CHAUSAR_EXECUTABLE_NAME 2^>nul') do if /i "%%A"=="CHAUSAR_EXECUTABLE_NAME" set "name=%%B"
:name_chosen
setlocal EnableDelayedExpansion
set "rest=#!name!"
set "lead=!name:~0,1!"
rem Unrolled on purpose: one substitution per allowed character (case-insensitive, so A-Z too).
set "rest=!rest:0=!" & set "rest=!rest:1=!" & set "rest=!rest:2=!" & set "rest=!rest:3=!" & set "rest=!rest:4=!" & set "rest=!rest:5=!" & set "rest=!rest:6=!" & set "rest=!rest:7=!" & set "rest=!rest:8=!" & set "rest=!rest:9=!"
set "rest=!rest:a=!" & set "rest=!rest:b=!" & set "rest=!rest:c=!" & set "rest=!rest:d=!" & set "rest=!rest:e=!" & set "rest=!rest:f=!" & set "rest=!rest:g=!" & set "rest=!rest:h=!" & set "rest=!rest:i=!" & set "rest=!rest:j=!" & set "rest=!rest:k=!" & set "rest=!rest:l=!" & set "rest=!rest:m=!"
set "rest=!rest:n=!" & set "rest=!rest:o=!" & set "rest=!rest:p=!" & set "rest=!rest:q=!" & set "rest=!rest:r=!" & set "rest=!rest:s=!" & set "rest=!rest:t=!" & set "rest=!rest:u=!" & set "rest=!rest:v=!" & set "rest=!rest:w=!" & set "rest=!rest:x=!" & set "rest=!rest:y=!" & set "rest=!rest:z=!"
set "rest=!rest:.=!" & set "rest=!rest:_=!" & set "rest=!rest:-=!"
set "plain=1"
if not "!rest!"=="#" set "plain="
if "!name!"=="" set "plain="
for %%C in (. _ -) do if "!lead!"=="%%C" set "plain="
if not defined plain (
  endlocal
  goto invalid_name
)
endlocal
set "pointer=%root%\current.json"
set "pointerAttributes="
for %%F in ("%pointer%") do set "pointerAttributes=%%~aF"
if not defined pointerAttributes goto not_installed
rem Attribute letters are drahscotl: a folder (d) or a reparse point such as a link (l) is refused.
if not "%pointerAttributes:~0,1%"=="-" goto not_installed
if "%pointerAttributes:~8,1%"=="l" goto not_installed

rem Only picks which installed copy runs the resolver; the resolver re-reads and validates the pointer.
rem current.json is one line of compact JSON with five keys. It is read with delayed expansion off
rem (a "!" in the install path stays literal), then rewritten in a delayed-expansion scope into
rem "key value" words: quotes, braces and separators go; the timestamp keeps its colons. The
rem words leave that scope through one "endlocal & set" and are read as five key/value slots.
set "current=" & set "previous=" & set "state=" & set "line="
set /p line=<"%pointer%"
setlocal EnableDelayedExpansion
set "line=!line:":"= !"
set "line=!line:":= !"
set "line=!line:,"= !"
set "line=!line:"=!"
set "line=!line:{=!" & set "line=!line:}=!" & set "line=!line:,= !"
endlocal & set "line=%line%"
for /f "tokens=1-10" %%a in ("%line%") do (
  if "%%a"=="version" set "current=%%b"
  if "%%c"=="version" set "current=%%d"
  if "%%e"=="version" set "current=%%f"
  if "%%g"=="version" set "current=%%h"
  if "%%i"=="version" set "current=%%j"
  if "%%a"=="previous" set "previous=%%b"
  if "%%c"=="previous" set "previous=%%d"
  if "%%e"=="previous" set "previous=%%f"
  if "%%g"=="previous" set "previous=%%h"
  if "%%i"=="previous" set "previous=%%j"
  if "%%a"=="state" set "state=%%b"
  if "%%c"=="state" set "state=%%d"
  if "%%e"=="state" set "state=%%f"
  if "%%g"=="state" set "state=%%h"
  if "%%i"=="state" set "state=%%j"
)
if "%previous%"=="null" set "previous="
rem Blocks stay free of quoted paths: one command per IF, so a ")" in a path never ends a block.
set "first=%current%"
set "second=%previous%"
if "%state%"=="trial" if defined previous set "first=%previous%"
if "%state%"=="trial" if defined previous set "second=%current%"

set "decisionFile=%TEMP%"
if not defined decisionFile set "decisionFile=%root%"
set "decisionFile=%decisionFile%\chausar-launch-%RANDOM%-%RANDOM%-%RANDOM%.txt"
set "pass=0"
:next_version
set /a pass+=1
set "version="
if %pass%==1 set "version=%first%"
if %pass%==2 set "version=%second%"
if %pass% GTR 2 goto unresolved
if not defined version goto next_version
rem The version must name an existing folder under versions\ exactly (no wildcard, separator or "..").
rem FOR /D runs in the folder itself (PUSHD) so its pattern is a bare "*", never a quoted path.
set "known="
if not exist "%root%\versions\*" goto next_version
pushd "%root%\versions"
for /d %%V in (*) do if "%%V"=="%version%" set "known=1"
popd
if not defined known goto next_version
rem The app folder is the version folder itself or its one top folder (electron-builder's zip).
set "app=%root%\versions\%version%"
set "hostDir="
if exist "%app%\%name%" if not exist "%app%\%name%\*" if exist "%app%\resources\app.asar.unpacked\platform\runtime\native\update-launch.ts" set "hostDir=%app%"
if defined hostDir goto host_found
if not exist "%app%\*" goto next_version
pushd "%app%"
for /d %%D in (*) do if not defined hostDir if exist "%app%\%%D\%name%" if not exist "%app%\%%D\%name%\*" if exist "%app%\%%D\resources\app.asar.unpacked\platform\runtime\native\update-launch.ts" set "hostDir=%app%\%%D"
popd
if not defined hostDir goto next_version
:host_found
set "host=%hostDir%\%name%"
set "resolver=%hostDir%\resources\app.asar.unpacked\platform\runtime\native\update-launch.ts"
set "ELECTRON_RUN_AS_NODE=1"
"%host%" "%resolver%" resolve --install-root "%root%" --executable-name "%name%" >"%decisionFile%"
set "resolved=%errorlevel%"
set "ELECTRON_RUN_AS_NODE="
if not "%resolved%"=="0" (
  del /f /q "%decisionFile%" >nul 2>&1
  goto next_version
)

rem The resolver prints key=value lines, one path per line; values are read through FOR and never parsed.
set "target=" & set "chosen=" & set "rolledBack=" & set "rolledBackFrom=" & set "rollbackUnavailable="
for /f "usebackq tokens=1,* delims==" %%K in ("%decisionFile%") do (
  if "%%K"=="executable" set "target=%%L"
  if "%%K"=="version" set "chosen=%%L"
  if "%%K"=="rolledBack" set "rolledBack=%%L"
  if "%%K"=="rolledBackFrom" set "rolledBackFrom=%%L"
  if "%%K"=="rollbackUnavailable" set "rollbackUnavailable=%%L"
)
del /f /q "%decisionFile%" >nul 2>&1
if "%rolledBack%"=="true" echo Chausar launcher: version %rolledBackFrom% did not confirm a clean start twice; returned to %chosen%.>&2
if "%rollbackUnavailable%"=="true" echo Chausar launcher: version %chosen% has not confirmed a clean start and no earlier version is installed.>&2
if not defined target goto missing_executable
if not exist "%target%" goto missing_executable
if exist "%target%\*" goto missing_executable
set "ELECTRON_RUN_AS_NODE="
set "CHAUSAR_INSTALL_ROOT=%root%"
"%target%" %*
exit /b %errorlevel%

:invalid_name
echo Chausar launcher: LAUNCH_EXECUTABLE_INVALID: the executable name is not plain.>&2
exit /b 64

:not_installed
echo Chausar launcher: LAUNCH_NOT_INSTALLED: no installed version was found next to this launcher.>&2
exit /b 66

:unresolved
echo Chausar launcher: LAUNCH_UNRESOLVED: no installed version could resolve the launch. Reinstall Chausar.>&2
exit /b 70

:missing_executable
echo Chausar launcher: LAUNCH_EXECUTABLE_MISSING: the chosen version holds no app executable.>&2
exit /b 70
