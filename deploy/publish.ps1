#Requires -Version 5.1
<#
.SYNOPSIS
  One-click publish PMS to Aliyun ECS.

.USAGE
  Double-click repo root: 发布新版本.bat
  Or: pnpm run publish:prod
  Or: powershell -ExecutionPolicy Bypass -File .\deploy\publish.ps1

.NOTES
  Config: deploy/publish.config.ps1
  Preserves remote .env and SQLite data/
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root 'pnpm-workspace.yaml'))) {
  $Root = (Get-Location).Path
}

$configFile = Join-Path $PSScriptRoot 'publish.config.ps1'
if (-not (Test-Path $configFile)) {
  Write-Host "Missing config: $configFile" -ForegroundColor Red
  exit 1
}
. $configFile

$Pem = $PublishConfig.PemPath
$HostName = $PublishConfig.Host
$User = $PublishConfig.User
$RemoteDir = $PublishConfig.RemoteDir
$PublicUrl = $PublishConfig.PublicUrl
$SshTarget = "${User}@${HostName}"
$SshOpts = @('-i', $Pem, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15')

function Assert-Tool([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Command not found: $Name"
  }
}

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  PMS Publish' -ForegroundColor Cyan
Write-Host ("  Target: {0}:{1}" -f $SshTarget, $RemoteDir) -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path $Pem)) {
  Write-Host "PEM not found: $Pem" -ForegroundColor Red
  Write-Host 'Edit deploy/publish.config.ps1' -ForegroundColor Yellow
  exit 1
}
Assert-Tool scp
Assert-Tool ssh
Assert-Tool tar
Assert-Tool robocopy

$confirm = Read-Host ("Publish to {0} now? [y/N]" -f $HostName)
if ($confirm -notin @('y', 'Y', 'yes', 'YES')) {
  Write-Host 'Cancelled'
  exit 0
}

$stage = Join-Path $env:TEMP 'pms-publish-stage'
$tgz = Join-Path $env:TEMP 'pms-deploy.tgz'
Write-Host '==> Packing source (skip node_modules/.git/.env/dist/local db)' -ForegroundColor Green
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

$robolog = Join-Path $env:TEMP 'pms-robocopy.log'
$robArgs = @(
  $Root, $stage, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/nc', '/ns', '/np',
  '/XD', 'node_modules', '.git', '.pnpm-store', 'dist',
  'apps\server\data', 'apps\admin-web\dist', 'apps\owner-h5\dist', 'packages\shared\dist',
  '.cursor', 'agent-transcripts',
  '/XF', '*.db', '*.db-shm', '*.db-wal', '.env', '.env.local', '.env.development', '*.pem', '*.log',
  "/LOG:$robolog"
)
& robocopy @robArgs | Out-Null
$rc = $LASTEXITCODE
if ($rc -ge 8) {
  Write-Host ("robocopy failed, exit={0}, log={1}" -f $rc, $robolog) -ForegroundColor Red
  exit 1
}

$fileCount = (Get-ChildItem $stage -Recurse -File | Measure-Object).Count
Write-Host ("  staged files: {0}" -f $fileCount)

if (Test-Path $tgz) { Remove-Item $tgz -Force }
Push-Location $stage
try {
  tar -czf $tgz *
} finally {
  Pop-Location
}
$sizeMb = [math]::Round((Get-Item $tgz).Length / 1MB, 2)
Write-Host ("  archive: {0} ({1} MB)" -f $tgz, $sizeMb)

Write-Host '==> Uploading' -ForegroundColor Green
& scp @SshOpts $tgz "${SshTarget}:/tmp/pms-deploy.tgz"
if ($LASTEXITCODE -ne 0) { throw 'scp upload failed' }

Write-Host '==> Remote build & restart' -ForegroundColor Green
$remoteSh = Join-Path $env:TEMP 'pms-run-release.sh'
$remoteShBody = @'
#!/bin/bash
set -euo pipefail
tmpdir=$(mktemp -d)
tar -xzf /tmp/pms-deploy.tgz -C "$tmpdir" deploy/remote-release.sh
sed -i 's/\r$//' "$tmpdir/deploy/remote-release.sh"
bash "$tmpdir/deploy/remote-release.sh"
rm -rf "$tmpdir"
'@
$remoteShBody = $remoteShBody -replace "`r`n", "`n" -replace "`r", "`n"
$utf8 = New-Object System.Text.UTF8Encoding $false
[IO.File]::WriteAllText($remoteSh, $remoteShBody, $utf8)
& scp @SshOpts $remoteSh "${SshTarget}:/tmp/pms-run-release.sh"
& ssh @SshOpts $SshTarget 'bash /tmp/pms-run-release.sh'
if ($LASTEXITCODE -ne 0) { throw ("remote release failed, exit={0}" -f $LASTEXITCODE) }

Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host '  Publish OK' -ForegroundColor Green
Write-Host ("  Admin:  {0}/" -f $PublicUrl) -ForegroundColor Green
Write-Host ("  Owner:  {0}/h5/" -f $PublicUrl) -ForegroundColor Green
Write-Host '  Tip: Ctrl+F5 hard refresh in browser' -ForegroundColor Yellow
Write-Host '========================================' -ForegroundColor Green
Write-Host ''

try {
  $health = & curl.exe -s --connect-timeout 8 ("{0}/api/v1/health" -f $PublicUrl)
  Write-Host ("Public health: {0}" -f $health)
} catch {
  Write-Host 'Public health check skipped' -ForegroundColor Yellow
}
