<#
.SYNOPSIS
  hunt-agent online installer (Windows).

.DESCRIPTION
  Downloads the standalone Windows binary from the latest GitHub release,
  verifies its SHA-256, installs it under %LOCALAPPDATA%\Programs\hunt-agent,
  and adds that directory to your user PATH.

  Run:
    irm https://raw.githubusercontent.com/hunt-agent/hunt-agent/main/install.ps1 | iex

.NOTES
  Environment overrides:
    $env:HUNT_AGENT_VERSION     = 'v0.1.0'   # pin a release (default: latest)
    $env:HUNT_AGENT_INSTALL_DIR = 'C:\path'  # install location
    $env:HUNT_AGENT_SKILLS_DIR  = 'C:\path'  # shipped skills location
    $env:HUNT_AGENT_SKIP_SKILLS = '1'        # install binary only
    $env:HUNT_AGENT_REPO        = 'owner/repo'
#>

#Requires -Version 5
$ErrorActionPreference = 'Stop'

$Repo = if ($env:HUNT_AGENT_REPO) { $env:HUNT_AGENT_REPO } else { 'hunt-agent/hunt-agent' }
$Bin  = 'hunt-agent'

# --- detect arch (only windows-x64 is published) -------------------------
if (-not [Environment]::Is64BitOperatingSystem) {
  throw 'unsupported architecture: only 64-bit Windows (x64) is published.'
}
$asset = "$Bin-windows-x64.exe"

$ver = if ($env:HUNT_AGENT_VERSION) { $env:HUNT_AGENT_VERSION.Trim() } else { 'latest' }
if ($ver -ne 'latest' -and -not $ver.StartsWith('v')) {
  $ver = "v$ver"
}

$base = if ($ver -eq 'latest') {
  "https://github.com/$Repo/releases/latest/download"
} else {
  "https://github.com/$Repo/releases/download/$ver"
}

$dir = if ($env:HUNT_AGENT_INSTALL_DIR) {
  $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($env:HUNT_AGENT_INSTALL_DIR)
} else {
  if (-not $env:LOCALAPPDATA) {
    throw 'LOCALAPPDATA is not set; set HUNT_AGENT_INSTALL_DIR explicitly.'
  }
  Join-Path $env:LOCALAPPDATA 'Programs\hunt-agent'
}
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  if ([Net.ServicePointManager]::SecurityProtocol -notmatch 'Tls12') {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  }
  $download = Join-Path $tmp $asset

  Write-Host "downloading $asset ($ver)..."
  Invoke-WebRequest -Uri "$base/$asset" -OutFile $download -UseBasicParsing -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $download) -or (Get-Item -LiteralPath $download).Length -eq 0) {
    throw "downloaded asset is empty: $base/$asset"
  }

  # --- verify checksum ----------------------------------------------------
  $checksumVerified = $false
  try {
    $sums = (Invoke-WebRequest -Uri "$base/SHA256SUMS" -UseBasicParsing -ErrorAction Stop).Content
  } catch {
    Write-Warning "SHA256SUMS unavailable; skipping checksum verification: $($_.Exception.Message)"
    $sums = $null
  }

  if ($sums) {
    $line = $sums -split "`n" |
      Where-Object { $_ -match "\s$([regex]::Escape($asset))\s*$" } |
      Select-Object -First 1
    if ($line) {
      $want = ($line -replace '\s.*$', '').Trim().ToLower()
      $got  = (Get-FileHash -Algorithm SHA256 -Path $download).Hash.ToLower()
      if ($got -ne $want) {
        throw "checksum mismatch for $asset (expected $want, got $got)"
      }
      $checksumVerified = $true
      Write-Host 'checksum ok'
    } else {
      Write-Warning "SHA256SUMS does not contain $asset; skipping checksum verification"
    }
  }

  $dest = Join-Path $dir "$Bin.exe"
  $staged = Join-Path $dir ".$Bin.tmp.$PID.exe"
  Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $staged
  Copy-Item -Force -Path $download -Destination $staged
  Move-Item -Force -LiteralPath $staged -Destination $dest
  Write-Host "installed $Bin -> $dest"

  # --- install shipped skills --------------------------------------------
  if ($env:HUNT_AGENT_SKIP_SKILLS -ne '1') {
    $skillsDir = if ($env:HUNT_AGENT_SKILLS_DIR) {
      $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($env:HUNT_AGENT_SKILLS_DIR)
    } else {
      Join-Path $env:USERPROFILE '.hunt-agent\builtin-skills'
    }

    $archiveRef = $ver
    $archiveUrl = "https://github.com/$Repo/archive/refs/tags/$archiveRef.zip"
    $archive = Join-Path $tmp 'source.zip'
    try {
      Write-Host "installing shipped skills -> $skillsDir..."
      try {
        Invoke-WebRequest -Uri $archiveUrl -OutFile $archive -UseBasicParsing -ErrorAction Stop
      } catch {
        $archiveUrl = "https://github.com/$Repo/archive/refs/heads/main.zip"
        Invoke-WebRequest -Uri $archiveUrl -OutFile $archive -UseBasicParsing -ErrorAction Stop
      }

      $sourceRoot = Join-Path $tmp 'source'
      Expand-Archive -Path $archive -DestinationPath $sourceRoot -Force
      $skillsSrc = Get-ChildItem -Path $sourceRoot -Directory -Recurse |
        Where-Object { $_.Name -eq 'skills' } |
        Select-Object -First 1

      if ($skillsSrc) {
        $skillsStage = "$skillsDir.tmp.$PID"
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath $skillsStage
        New-Item -ItemType Directory -Force -Path $skillsStage | Out-Null
        Copy-Item -Recurse -Force -Path (Join-Path $skillsSrc.FullName '*') -Destination $skillsStage
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath $skillsDir
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $skillsDir) | Out-Null
        Move-Item -Force -LiteralPath $skillsStage -Destination $skillsDir
        Write-Host "installed shipped skills -> $skillsDir"
      } else {
        Write-Warning 'skills directory not found in source archive; skipping skills install'
      }
    } catch {
      Write-Warning "skills install skipped: $($_.Exception.Message)"
    }
  }

  # --- add to user PATH --------------------------------------------------
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $pathEntries = @()
  if (-not [string]::IsNullOrWhiteSpace($userPath)) {
    $pathEntries = $userPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  }

  if (-not ($pathEntries | Where-Object { [string]::Equals($_, $dir, [StringComparison]::OrdinalIgnoreCase) })) {
    $newPath = if ([string]::IsNullOrEmpty($userPath)) { $dir } else { "$userPath;$dir" }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    $env:Path = "$env:Path;$dir"
    Write-Host "added $dir to your user PATH (open a new terminal for it to take effect)"
  }

  if (-not $checksumVerified) {
    Write-Warning 'installed without checksum verification'
  }
  & $dest --version
} finally {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp
}
