param(
    [string]$FoundryData = 'C:\Users\Roman\AppData\Local\FoundryVTT\Data'
)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $workspaceRoot 'dist\foundry-creature-ai'
$manifest = Join-Path $source 'module.json'
if (-not (Test-Path -LiteralPath $manifest)) { throw 'Build the module with node tools/build-module.mjs first.' }
$resolvedData = (Resolve-Path -LiteralPath $FoundryData).Path
$moduleRoot = Join-Path $resolvedData 'modules'
if (-not (Test-Path -LiteralPath $moduleRoot -PathType Container)) { throw 'The selected folder has no Foundry modules directory.' }
$destination = Join-Path $moduleRoot 'foundry-creature-ai'
if (Test-Path -LiteralPath $destination) {
    $installedManifest = Join-Path $destination 'module.json'
    if (-not (Test-Path -LiteralPath $installedManifest)) { throw 'Destination exists without a module manifest; refusing to overwrite it.' }
    $installed = Get-Content -LiteralPath $installedManifest -Raw | ConvertFrom-Json
    if ($installed.id -ne 'foundry-creature-ai') { throw 'Destination belongs to a different module.' }
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Get-ChildItem -LiteralPath $source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
}
Write-Output "Installed module files to $destination. Enable Foundry Creature AI in Manage Modules."
