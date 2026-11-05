$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $workspace 'dist'
$index = Get-Content -LiteralPath (Join-Path $dist 'package-index.json') -Raw | ConvertFrom-Json
$directories = @()
foreach ($package in $index.packages) {
  $directory = Join-Path $dist $package.id
  $directories += $directory
  Compress-Archive -LiteralPath $directory -DestinationPath (Join-Path $dist ($package.id + '.zip')) -Force
}
$suite = Join-Path $dist 'pf2e-tactical-suite.zip'
Compress-Archive -LiteralPath $directories -DestinationPath $suite -Force
Copy-Item -LiteralPath $suite -Destination (Join-Path $workspace ('releases\pf2e-tactical-suite-' + $index.version + '.zip')) -Force
Write-Output "Packaged $($index.packages.Count) modules and the $($index.version) suite archive."
