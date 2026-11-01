; Wave 6, package 6J1 (D3, D36): the uninstaller removes the start-at-login entry the beta made (Electron's login item,
; registry value "Chausar" under the current user's Run key, and its Task Manager startup switch) and the installer copy
; electron-builder keeps for updates. The owner's own folder (businesses, settings, keys) stays: Forget and workspace
; deletion are the owner's choices inside the app.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Chausar"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Chausar"
  RMDir /r "$LOCALAPPDATA\chausar-updater"
!macroend
