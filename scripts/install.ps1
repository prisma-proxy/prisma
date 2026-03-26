# Prisma installer for Windows (PowerShell)
# Usage:
#   irm https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.ps1 | iex
#   .\install.ps1 -Setup
#   .\install.ps1 -Version v0.2.1
#   .\install.ps1 -Uninstall
param(
    [switch]$Setup,
    [switch]$Uninstall,
    [switch]$Force,
    [switch]$NoVerify,
    [switch]$Quiet,
    [string]$Version = "latest",
    [string]$Dir = "",
    [string]$ConfigDir = "",
    [switch]$Help
)

$ErrorActionPreference = "Stop"

$Repo = "prisma-proxy/prisma"
$Binary = "prisma.exe"

function Show-Usage {
    Write-Host @"
Usage: install.ps1 [OPTIONS]

Options:
  -Setup            Generate credentials, TLS certificate, and example configs
  -Version VER      Install a specific version (e.g., v0.2.1). Default: latest
  -Dir DIR          Install directory (or set PRISMA_INSTALL_DIR)
  -ConfigDir DIR    Config output directory for -Setup (or set PRISMA_CONFIG_DIR)
  -NoVerify         Skip SHA256 checksum verification
  -Force            Overwrite existing installation without prompting
  -Uninstall        Remove prisma binary and clean PATH
  -Quiet            Suppress informational output
  -Help             Show this help message

Environment variables:
  PRISMA_INSTALL_DIR   Install directory (default: %LOCALAPPDATA%\prisma)
  PRISMA_CONFIG_DIR    Config output directory for -Setup (default: current dir)

Examples:
  # Install latest release
  irm https://raw.githubusercontent.com/$Repo/master/scripts/install.ps1 | iex

  # Install + auto-generate all config
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/$Repo/master/scripts/install.ps1))) -Setup

  # Install specific version
  .\install.ps1 -Version v0.2.1

  # Uninstall
  .\install.ps1 -Uninstall
"@
    exit 0
}

function Write-Info($msg) {
    if (-not $Quiet) { Write-Host "==> $msg" -ForegroundColor Green }
}
function Write-Warn($msg) { Write-Host "warning: $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "error: $msg" -ForegroundColor Red }

if ($Help) { Show-Usage }

# Resolve install directory
$InstallDir = if ($Dir -ne "") { $Dir }
              elseif ($env:PRISMA_INSTALL_DIR) { $env:PRISMA_INSTALL_DIR }
              else { "$env:LOCALAPPDATA\prisma" }

# Detect architecture
$Arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [System.Runtime.InteropServices.Architecture]::Arm64) {
    "arm64"
} elseif ([Environment]::Is64BitOperatingSystem) {
    "amd64"
} else {
    Write-Err "32-bit Windows is not supported."
    exit 1
}

# Resolve version tag
if ($Version -ne "latest" -and $Version -notmatch "^v") {
    $Version = "v$Version"
}

# Build download URL
function Get-DownloadUrl {
    if ($Version -eq "latest") {
        return "https://github.com/$Repo/releases/latest/download/prisma-windows-${Arch}.exe"
    } else {
        return "https://github.com/$Repo/releases/download/$Version/prisma-windows-${Arch}.exe"
    }
}

# Verify SHA256 checksum
function Test-Checksum($FilePath, $BaseUrl) {
    if ($NoVerify) { return }

    $checksumUrl = "${BaseUrl}.sha256"
    $checksumFile = [System.IO.Path]::GetTempFileName()

    try {
        Invoke-WebRequest -Uri $checksumUrl -OutFile $checksumFile -UseBasicParsing -ErrorAction Stop
        $expected = (Get-Content $checksumFile -Raw).Trim().Split()[0]
        $actual = (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash.ToLower()

        Remove-Item $checksumFile -Force -ErrorAction SilentlyContinue
        if ($expected -eq $actual) {
            Write-Info "Checksum verified"
        } else {
            Write-Err "checksum mismatch!"
            Write-Err "  expected: $expected"
            Write-Err "  actual:   $actual"
            exit 1
        }
    } catch {
        Remove-Item $checksumFile -Force -ErrorAction SilentlyContinue
        if (-not $Quiet) { Write-Info "No checksum file available, skipping verification" }
    }
}

# Uninstall
if ($Uninstall) {
    $OutPath = Join-Path $InstallDir $Binary
    if (Test-Path $OutPath) {
        Write-Info "Removing $OutPath"
        Remove-Item $OutPath -Force

        # Clean PATH
        $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($UserPath -like "*$InstallDir*") {
            $NewPath = ($UserPath -split ";" | Where-Object { $_ -ne $InstallDir }) -join ";"
            [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
            Write-Info "Removed $InstallDir from user PATH"
        }
        Write-Info "Prisma uninstalled successfully"
    } else {
        Write-Warn "prisma not found at $OutPath"
    }
    exit 0
}

# Report existing installation
$OutPath = Join-Path $InstallDir $Binary
if ((Test-Path $OutPath) -and -not $Force) {
    try {
        $currentVersion = & $OutPath --version 2>&1
        Write-Info "Existing installation: $currentVersion"
    } catch {}
}

Write-Info "Platform: windows/${Arch}"
if ($Version -eq "latest") { Write-Info "Version: latest" } else { Write-Info "Version: $Version" }

$DownloadUrl = Get-DownloadUrl
Write-Info "Downloading..."

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$TempFile = [System.IO.Path]::GetTempFileName()
try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempFile -UseBasicParsing
} catch {
    Remove-Item $TempFile -Force -ErrorAction SilentlyContinue
    Write-Err "Download failed. Check that the release exists for your platform."
    if ($Version -ne "latest") { Write-Err "Version $Version may not exist. See: https://github.com/$Repo/releases" }
    exit 1
}

Test-Checksum $TempFile $DownloadUrl

Move-Item -Force $TempFile $OutPath
Write-Info "Installed to $OutPath"

# Add to user PATH if not present
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
    $env:Path = "$env:Path;$InstallDir"
    Write-Info "Added $InstallDir to user PATH (restart your terminal to take effect)"
}

Write-Info "Prisma installed successfully"
try { & $OutPath --version } catch {}

# Optional setup
if ($Setup) {
    $SetupDir = if ($ConfigDir -ne "") { $ConfigDir }
                elseif ($env:PRISMA_CONFIG_DIR) { $env:PRISMA_CONFIG_DIR }
                else { (Get-Location).Path }

    Write-Host ""
    Write-Info "Running initial setup in $SetupDir"

    Write-Info "Generating client credentials..."
    & $OutPath gen-key | Out-File (Join-Path $SetupDir ".prisma-credentials") -Encoding utf8

    Write-Info "Generating TLS certificate..."
    & $OutPath gen-cert --output "$SetupDir" --cn prisma-server

    $ServerToml = Join-Path $SetupDir "server.toml"
    if (-not (Test-Path $ServerToml)) {
        try {
            Invoke-WebRequest -Uri "https://raw.githubusercontent.com/$Repo/master/server.example.toml" -OutFile $ServerToml -UseBasicParsing
            Write-Info "Created server.toml from example"
        } catch {
            Write-Warn "Could not download server.example.toml"
        }
    } else {
        Write-Info "server.toml already exists, skipping"
    }

    $ClientToml = Join-Path $SetupDir "client.toml"
    if (-not (Test-Path $ClientToml)) {
        try {
            Invoke-WebRequest -Uri "https://raw.githubusercontent.com/$Repo/master/client.example.toml" -OutFile $ClientToml -UseBasicParsing
            Write-Info "Created client.toml from example"
        } catch {
            Write-Warn "Could not download client.example.toml"
        }
    } else {
        Write-Info "client.toml already exists, skipping"
    }

    Write-Host ""
    Write-Host "Setup complete!" -ForegroundColor Green
    Write-Host "  Credentials: $(Join-Path $SetupDir '.prisma-credentials')"
    Write-Host "  TLS cert:    $(Join-Path $SetupDir 'prisma-cert.pem')"
    Write-Host "  TLS key:     $(Join-Path $SetupDir 'prisma-key.pem')"
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  1. Edit server.toml - paste the client ID and auth secret from .prisma-credentials"
    Write-Host "  2. Edit client.toml - set server_addr and paste the same credentials"
    Write-Host "  3. Run: prisma server -c server.toml"
    Write-Host "  4. Run: prisma client -c client.toml"
}

Write-Host ""
