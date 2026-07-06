!macro customInstall
  ${IfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION "安装完成，是否要在桌面创建快捷方式？" IDNO noDesktopShortcut
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    noDesktopShortcut:
  ${EndIf}
!macroend
