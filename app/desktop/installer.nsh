; Wave 6, package 6J1 (D3, D36): the uninstaller removes the start-at-login entry the beta made (Electron's login item,
; registry value "Chausar" under the current user's Run key, and its Task Manager startup switch) and the installer copy
; electron-builder keeps for updates. The owner's own folder (businesses, settings, keys) stays: Forget and workspace
; deletion are the owner's choices inside the app.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Chausar"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Chausar"
  RMDir /r "$LOCALAPPDATA\chausar-updater"
!macroend

; 15 Nov 2026 (the first walk of the built Windows app): closing a running Chausar before its files are replaced or
; removed. electron-builder's own step (_CHECK_APP_RUNNING in its allowOnlyOneInstallerInstance.nsh) sends "taskkill"
; without /F, which only closes the window, so the beta stays in the tray, and about a second later it ends every
; Chausar.exe by force: the engine never gets its graceful stop. This step is that one with a single change: where it
; sent the polite taskkill, it runs the installed program with --quit (app/desktop/quit-ask.cjs), which asks the running
; Chausar to quit the way the tray's "Quit Chausar and stop jobs" does and returns once it has gone (it waits at most
; 90 seconds; the limit here is a little over that). The forced end stays after it, as the fallback.
; The ask runs only when a Chausar.exe is running: a Chausar from before 15 Nov 2026 does not know --quit and would
; start instead. The builder's check that the installer is not itself named like the program is left out: its files
; are never named Chausar.exe.
; Not compiled or run where it was written (no NSIS there): the first Windows build after it compiles it.
!macro customCheckAppRunning
  ${if} ${isUpdated}
    # allow app to exit without explicit kill
    Sleep 300
  ${endIf}

  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    ${if} ${isUpdated}
      # allow app to exit without explicit kill
      Sleep 1000
      Goto doStopProcess
    ${endIf}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK doStopProcess
    Quit

    doStopProcess:

    DetailPrint `Closing running "${PRODUCT_NAME}"...`

    ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      nsExec::Exec /TIMEOUT=100000 `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --quit`
      Pop $R0
    ${endIf}
    # to ensure that files are not "in-use"
    Sleep 300

    # Retry counter
    StrCpy $R1 0

    loop:
      IntOp $R1 $R1 + 1

      !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
        # wait to give a chance to exit gracefully
        Sleep 1000
        !ifdef INSTALL_MODE_PER_ALL_USERS
          nsExec::Exec `taskkill /f /im "${APP_EXECUTABLE_FILENAME}"`
        !else
          nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
        !endif
        !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
        ${If} $R0 == 0
          DetailPrint `Waiting for "${PRODUCT_NAME}" to close.`
          Sleep 2000
        ${else}
          Goto not_running
        ${endIf}
      ${else}
        Goto not_running
      ${endIf}

      # App likely running with elevated permissions.
      # Ask user to close it manually
      ${if} $R1 > 1
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY loop
        Quit
      ${else}
        Goto loop
      ${endIf}
    not_running:
  ${endIf}
!macroend
