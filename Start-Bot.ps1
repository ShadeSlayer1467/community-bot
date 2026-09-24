$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$botCommand = Get-Command node -ErrorAction SilentlyContinue
$botCandidates = @()
if ($botCommand) { $botCandidates += $botCommand.Source }
$botCandidates += Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$botNode = $null
foreach ($botCandidate in $botCandidates) {
    if (-not (Test-Path -LiteralPath $botCandidate)) { continue }
    $botVersion = & $botCandidate -p "process.versions.node"
    if ($LASTEXITCODE -eq 0 -and [version]$botVersion -ge [version]'22.12.0') {
        $botNode = $botCandidate
        break
    }
}
if (-not $botNode) {
    throw 'Install Node.js 24 LTS from https://nodejs.org/, then double-click start.bat again.'
}
Write-Host "Using Node.js $botVersion"
$env:PATH = (Split-Path -Parent $botNode) + ';' + $env:PATH
$botConfig = Join-Path $PSScriptRoot 'config.local.json'
if (-not (Test-Path -LiteralPath $botConfig)) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'config.example.json') -Destination $botConfig
    throw 'Created config.local.json with blank values. Set adminPassword (at least 16 characters); see CONFIGURATION.md, then run start.bat again.'
}
if ((-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\discord.js'))) -or
    (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\otplib'))) -or
    (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\qrcode')))) {
    $botNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $botNpm) { throw 'Install Node.js 24 LTS with npm to restore dependencies.' }
    $botNpmCli = Join-Path (Split-Path -Parent $botNpm.Source) 'node_modules\npm\bin\npm-cli.js'
    if (-not (Test-Path -LiteralPath $botNpmCli)) { throw 'Cannot find npm-cli.js. Reinstall Node.js 24 LTS with npm.' }
    & $botNode $botNpmCli ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
& $botNode (Join-Path $PSScriptRoot 'src\main.js')
exit $LASTEXITCODE
