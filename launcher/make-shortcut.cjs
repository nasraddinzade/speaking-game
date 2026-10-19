#!/usr/bin/env node
/**
 * Put a "Speaking Game" shortcut on the desktop. One double-click starts the
 * local server (hidden) and the game window; closing the window stops both.
 *
 *   npm run shortcut            -> desktop
 *   npm run shortcut -- --dir X -> any folder
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

if (process.platform !== 'win32') {
  console.error('The shortcut script is Windows only. On other systems run: npm start');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const VBS = path.join(ROOT, 'launcher', 'start-hidden.vbs');
const ICON = path.join(ROOT, 'launcher', 'speaking-game.ico');
const args = process.argv.slice(2);
const dirIdx = args.indexOf('--dir');
const targetDir = dirIdx >= 0 && args[dirIdx + 1] ? path.resolve(args[dirIdx + 1]) : null;

for (const f of [VBS, ICON]) {
  if (!fs.existsSync(f)) {
    console.error(`Missing ${f}`);
    process.exit(1);
  }
}

const ps = `
$ErrorActionPreference = 'Stop'
$dir = ${targetDir ? `'${targetDir.replace(/'/g, "''")}'` : "[Environment]::GetFolderPath('Desktop')"}
$lnk = Join-Path $dir 'Speaking Game.lnk'
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = Join-Path $env:SystemRoot 'System32\\wscript.exe'
$s.Arguments = '"${VBS}"'
$s.WorkingDirectory = '${ROOT}'
$s.IconLocation = '${ICON},0'
$s.Description = 'Speaking Game: server + game window'
$s.WindowStyle = 1
$s.Save()
Write-Output $lnk
`;

const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(1);
}
console.log(`Shortcut created: ${r.stdout.trim()}`);
console.log('Double-click it to start the server and the game. Closing the game window stops the server.');
