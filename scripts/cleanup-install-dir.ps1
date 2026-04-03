param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir,

  [Parameter(Mandatory = $true)]
  [string]$OpenClawDir
)

$ErrorActionPreference = 'SilentlyContinue'

function Resolve-FullPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  try {
    return [System.IO.Path]::GetFullPath($Path)
  } catch {
    return $Path
  }
}

function Stop-ProcessesInTree {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Roots
  )

  $normalizedRoots = @($Roots | Where-Object { $_ } | ForEach-Object { Resolve-FullPath $_ })
  if ($normalizedRoots.Count -eq 0) {
    return
  }

  Get-CimInstance Win32_Process | Where-Object {
    $exePath = $_.ExecutablePath
    if (-not $exePath) {
      return $false
    }

    $fullExePath = Resolve-FullPath $exePath
    foreach ($root in $normalizedRoots) {
      if ($fullExePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
      }
    }

    return $false
  } | ForEach-Object {
    try {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
    } catch {
    }
  }
}

$installRoot = Resolve-FullPath $InstallDir
$openClawRoot = Resolve-FullPath $OpenClawDir

# Give the NSIS uninstaller time to exit and release its own handle first.
Start-Sleep -Seconds 2

for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Stop-ProcessesInTree -Roots @($installRoot, $openClawRoot)

  if (Test-Path -LiteralPath $openClawRoot) {
    Remove-Item -LiteralPath $openClawRoot -Recurse -Force -ErrorAction SilentlyContinue
  }

  if (Test-Path -LiteralPath $installRoot) {
    Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path -LiteralPath $openClawRoot) -and -not (Test-Path -LiteralPath $installRoot)) {
    exit 0
  }

  Start-Sleep -Seconds 2
}

exit 0
