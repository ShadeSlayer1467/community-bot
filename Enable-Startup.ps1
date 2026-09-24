$ErrorActionPreference = 'Stop'
$botStartup = [Environment]::GetFolderPath('Startup')
$botShell = New-Object -ComObject WScript.Shell
$botShortcut = $botShell.CreateShortcut((Join-Path $botStartup 'Community Bot.lnk'))
$botShortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$botShortcut.Arguments = '-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'Start-Bot.ps1') + '"'
$botShortcut.WorkingDirectory = $PSScriptRoot
$botShortcut.WindowStyle = 7
$botShortcut.Description = 'Start Community Bot and connect to Discord at Windows sign-in'
$botShortcut.Save()
Write-Host 'Enabled Community Bot at Windows sign-in. Disable it in Windows Startup apps or remove Community Bot.lnk from shell:startup.'
