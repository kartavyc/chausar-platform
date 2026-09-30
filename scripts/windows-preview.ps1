param(
    [ValidateSet('Check', 'Smoke', 'Web', 'PackageCheck')]
    [string]$Mode = 'Check'
)

$ErrorActionPreference = 'Stop'
$previewRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $nodeCommand) { throw 'Install/use an approved Node 24.13.1 or later runtime. This source kit contains no Node or Electron binary.' }
$previewNode = $nodeCommand.Source
$nodeVersionText = (& $previewNode --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersionText -notmatch '^v(\d+\.\d+\.\d+)$' -or [version]$Matches[1] -lt [version]'24.13.1') {
    throw "Node 24.13.1 or later is required; detected $nodeVersionText"
}

Push-Location -LiteralPath $previewRoot
try {
    switch ($Mode) {
        'Check' { & $previewNode scripts/check.mjs }
        'Smoke' { & $previewNode scripts/desktop-smoke.mjs }
        'Web' {
            Write-Host 'Starting the synthetic web preview on loopback. No browser is opened. Ctrl+C stops it.'
            & $previewNode platform/runtime/server.ts --demo
        }
        'PackageCheck' {
            $previewArch = (& $previewNode -p 'process.arch').Trim()
            if ($LASTEXITCODE -ne 0) { throw 'Cannot determine the Node host architecture.' }
            & $previewNode scripts/desktop-package.mjs --mode preview --platform win32 --arch $previewArch --check
        }
    }
    $previewExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $previewExitCode
