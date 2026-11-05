param([string]$FoundryData = 'C:\Users\Roman\AppData\Local\FoundryVTT\Data')
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $workspaceRoot 'dist'
$indexPath = Join-Path $dist 'package-index.json'
if (-not (Test-Path -LiteralPath $indexPath)) { throw 'Build the suite with node tools/build-module.mjs first.' }
$index = Get-Content -LiteralPath $indexPath -Raw | ConvertFrom-Json
$allowed = @('pf2e-tactical-core','pf2e-tactical-environment','pf2e-tactical-conditions','pf2e-tactical-movement','foundry-creature-ai')
$resolvedData = (Resolve-Path -LiteralPath $FoundryData).Path
$moduleRoot = Join-Path $resolvedData 'modules'
if (-not (Test-Path -LiteralPath $moduleRoot -PathType Container)) { throw 'No Foundry modules directory.' }
$backupRoot = Join-Path $workspaceRoot ('.scratch\suite-install-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
foreach ($package in $index.packages) {
  if ($package.id -notin $allowed) { throw 'Unexpected package ID.' }
  $source = Join-Path $dist $package.id
  $manifest = Get-Content -LiteralPath (Join-Path $source 'module.json') -Raw | ConvertFrom-Json
  if ($manifest.id -ne $package.id -or $manifest.version -ne $index.version) { throw 'Build manifest mismatch.' }
  $destination = Join-Path $moduleRoot $package.id
  if (Test-Path -LiteralPath $destination) {
    $installed = Get-Content -LiteralPath (Join-Path $destination 'module.json') -Raw | ConvertFrom-Json
    if ($installed.id -ne $package.id) { throw 'Installed directory belongs to another module.' }
    Compress-Archive -LiteralPath $destination -DestinationPath (Join-Path $backupRoot ($package.id + '.zip')) -Force
  }
}
foreach ($package in $index.packages) {
  $source = (Resolve-Path -LiteralPath (Join-Path $dist $package.id)).Path
  $destination = Join-Path $moduleRoot $package.id
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  $destination = (Resolve-Path -LiteralPath $destination).Path
  if ($destination -ne (Join-Path $moduleRoot $package.id)) { throw 'Unexpected installed target.' }
  Get-ChildItem -LiteralPath $source -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force }
  $obsolete = Get-ChildItem -LiteralPath $destination -File -Recurse | Where-Object {
    $relative = $_.FullName.Substring($destination.Length + 1)
    -not (Test-Path -LiteralPath (Join-Path $source $relative))
  }
  foreach ($file in $obsolete) {
    if (-not $file.FullName.StartsWith($destination + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'File outside module target.' }
    Remove-Item -LiteralPath $file.FullName -Force
  }
  Write-Output "Installed $($package.id) $($index.version)"
}
Write-Output "Previous packages backed up in $backupRoot. Restart Foundry to discover the new modules, then enable their dependencies."
