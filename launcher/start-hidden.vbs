' Speaking Game: start the local server and the game window without a console window.
' The desktop shortcut points here (see: npm run shortcut).
Option Explicit
Dim sh, fso, root, rc
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root

rc = sh.Run("cmd /c where node >nul 2>&1", 0, True)
If rc <> 0 Then
  MsgBox "Node.js was not found. Install it from https://nodejs.org and try again.", vbCritical, "Speaking Game"
  WScript.Quit 1
End If

If Not fso.FolderExists(root & "\node_modules") Or Not fso.FileExists(root & "\dist\index.html") Then
  ' First run: install and build with a visible window so progress is not hidden.
  rc = sh.Run("cmd /c ""npm install && npm run build""", 1, True)
  If rc <> 0 Then
    MsgBox "npm install or the build failed. Open a terminal in " & root & " and run: npm install", vbCritical, "Speaking Game"
    WScript.Quit 1
  End If
End If

' Hidden: the server lives in this process and exits when the game window closes.
sh.Run "node ""launcher\start.cjs""", 0, False
