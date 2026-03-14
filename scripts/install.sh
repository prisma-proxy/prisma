#!/bin/bash
# Prisma installer for Linux, macOS, and FreeBSD
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash -s -- --setup
#   curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash -s -- --version v0.2.1
set -euo pipefail

REPO="Yamimega/prisma"
INSTALL_DIR="${PRISMA_INSTALL_DIR:-/usr/local/bin}"
BINARY="prisma"
SETUP=false
UNINSTALL=false
VERSION="latest"
VERIFY=true
FORCE=false
QUIET=false

# Colors (disabled if not a terminal)
if [ -t 1 ]; then
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    RED='\033[0;31m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    GREEN='' YELLOW='' RED='' BOLD='' NC=''
fi

info()  { [ "$QUIET" = true ] || echo -e "${GREEN}==>${NC} $*"; }
warn()  { echo -e "${YELLOW}warning:${NC} $*" >&2; }
error() { echo -e "${RED}error:${NC} $*" >&2; }

usage() {
    cat <<EOF
Usage: install.sh [OPTIONS]

Options:
  --setup            Generate credentials, TLS certificate, and example configs
  --version VER      Install a specific version (e.g., v0.2.1). Default: latest
  --dir DIR          Install directory (or set PRISMA_INSTALL_DIR)
  --config-dir DIR   Config output directory for --setup (or set PRISMA_CONFIG_DIR)
  --no-verify        Skip SHA256 checksum verification
  --force            Overwrite existing installation without prompting
  --uninstall        Remove prisma binary
  --quiet            Suppress informational output
  -h, --help         Show this help message

Environment variables:
  PRISMA_INSTALL_DIR   Install directory (default: /usr/local/bin)
  PRISMA_CONFIG_DIR    Config output directory for --setup (default: current dir)

Examples:
  # Install latest release
  curl -fsSL https://raw.githubusercontent.com/$REPO/master/scripts/install.sh | bash

  # Install + auto-generate all config
  curl -fsSL https://raw.githubusercontent.com/$REPO/master/scripts/install.sh | bash -s -- --setup

  # Install specific version to custom directory
  curl -fsSL https://raw.githubusercontent.com/$REPO/master/scripts/install.sh | bash -s -- --version v0.2.1 --dir ~/.local/bin

  # Uninstall
  curl -fsSL https://raw.githubusercontent.com/$REPO/master/scripts/install.sh | bash -s -- --uninstall
EOF
    exit 0
}

# Parse arguments
while [ $# -gt 0 ]; do
    case "$1" in
        --setup)     SETUP=true ;;
        --uninstall) UNINSTALL=true ;;
        --force)     FORCE=true ;;
        --quiet)     QUIET=true ;;
        --no-verify) VERIFY=false ;;
        --version)
            shift
            [ $# -gt 0 ] || { error "--version requires a value"; exit 1; }
            VERSION="$1"
            ;;
        --dir)
            shift
            [ $# -gt 0 ] || { error "--dir requires a value"; exit 1; }
            INSTALL_DIR="$1"
            ;;
        --config-dir)
            shift
            [ $# -gt 0 ] || { error "--config-dir requires a value"; exit 1; }
            export PRISMA_CONFIG_DIR="$1"
            ;;
        -h|--help) usage ;;
        *)
            error "unknown option: $1"
            echo "Run with --help for usage information."
            exit 1
            ;;
    esac
    shift
done

# Detect OS
detect_os() {
    local os
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    case "$os" in
        linux)   echo "linux" ;;
        darwin)  echo "darwin" ;;
        freebsd) echo "freebsd" ;;
        *)
            error "unsupported OS '$os'. Supported: linux, darwin, freebsd"
            exit 1
            ;;
    esac
}

# Detect architecture
detect_arch() {
    local arch
    arch=$(uname -m)
    case "$arch" in
        x86_64|amd64)  echo "amd64" ;;
        aarch64|arm64) echo "arm64" ;;
        armv7l|armhf)  echo "armv7" ;;
        *)
            error "unsupported architecture '$arch'. Supported: x86_64, aarch64, armv7l"
            exit 1
            ;;
    esac
}

# Download a URL to a file (uses curl or wget)
download() {
    local url="$1" dest="$2"
    if command -v curl &>/dev/null; then
        curl -fsSL "$url" -o "$dest"
    elif command -v wget &>/dev/null; then
        wget -qO "$dest" "$url"
    else
        error "neither curl nor wget found. Install one and retry."
        exit 1
    fi
}

# Ensure version tag starts with 'v'
resolve_version() {
    if [ "$VERSION" = "latest" ]; then
        return
    fi
    case "$VERSION" in
        v*) ;;
        *)  VERSION="v${VERSION}" ;;
    esac
}

# Build download URL for a given OS/arch
build_url() {
    local os="$1" arch="$2"
    if [ "$VERSION" = "latest" ]; then
        echo "https://github.com/${REPO}/releases/latest/download/prisma-${os}-${arch}"
    else
        echo "https://github.com/${REPO}/releases/download/${VERSION}/prisma-${os}-${arch}"
    fi
}

# Verify SHA256 checksum if a .sha256 file exists alongside the release
verify_checksum() {
    local file="$1" url="$2"
    [ "$VERIFY" = true ] || return 0

    local checksum_file
    checksum_file=$(mktemp)

    if download "${url}.sha256" "$checksum_file" 2>/dev/null; then
        local expected actual
        expected=$(awk '{print $1}' "$checksum_file")
        if command -v sha256sum &>/dev/null; then
            actual=$(sha256sum "$file" | awk '{print $1}')
        elif command -v shasum &>/dev/null; then
            actual=$(shasum -a 256 "$file" | awk '{print $1}')
        else
            warn "no sha256sum or shasum found, skipping verification"
            rm -f "$checksum_file"
            return 0
        fi
        rm -f "$checksum_file"

        if [ "$expected" = "$actual" ]; then
            info "Checksum verified"
        else
            error "checksum mismatch!"
            error "  expected: $expected"
            error "  actual:   $actual"
            exit 1
        fi
    else
        rm -f "$checksum_file"
        [ "$QUIET" = true ] || info "No checksum file available, skipping verification"
    fi
}

# Uninstall prisma binary
do_uninstall() {
    local target="${INSTALL_DIR}/${BINARY}"
    if [ -f "$target" ]; then
        info "Removing ${target}"
        if [ -w "$INSTALL_DIR" ]; then
            rm -f "$target"
        else
            sudo rm -f "$target"
        fi
        info "Prisma uninstalled successfully"
    else
        warn "prisma not found at ${target}"
    fi
    exit 0
}

# Download and install the binary
do_install() {
    local os arch
    os=$(detect_os)
    arch=$(detect_arch)
    resolve_version

    local url target
    url=$(build_url "$os" "$arch")
    target="${INSTALL_DIR}/${BINARY}"

    # Report existing installation
    if [ -f "$target" ] && [ "$FORCE" = false ]; then
        local current_version
        current_version=$("$target" --version 2>/dev/null || echo "unknown")
        info "Existing installation: ${current_version}"
    fi

    info "Platform: ${BOLD}${os}/${arch}${NC}"
    if [ "$VERSION" = "latest" ]; then
        info "Version: ${BOLD}latest${NC}"
    else
        info "Version: ${BOLD}${VERSION}${NC}"
    fi
    info "Downloading..."

    local tmp
    tmp=$(mktemp)
    trap 'rm -f "$tmp"' EXIT

    if ! download "$url" "$tmp"; then
        error "download failed. Check that the release exists for your platform."
        [ "$VERSION" != "latest" ] && error "Version ${VERSION} may not exist. See: https://github.com/${REPO}/releases"
        exit 1
    fi

    verify_checksum "$tmp" "$url"
    chmod +x "$tmp"

    # Create install directory if needed
    if [ ! -d "$INSTALL_DIR" ]; then
        info "Creating directory ${INSTALL_DIR}"
        mkdir -p "$INSTALL_DIR" 2>/dev/null || sudo mkdir -p "$INSTALL_DIR"
    fi

    info "Installing to ${BOLD}${target}${NC}"
    if [ -w "$INSTALL_DIR" ]; then
        mv "$tmp" "$target"
    else
        sudo mv "$tmp" "$target"
    fi
    trap - EXIT

    info "Prisma installed successfully"
    "$target" --version 2>/dev/null || true
}

# Generate credentials, TLS certs, and example configs
do_setup() {
    local config_dir="${PRISMA_CONFIG_DIR:-$(pwd)}"
    local prisma="${INSTALL_DIR}/${BINARY}"

    echo ""
    info "Running initial setup in ${BOLD}${config_dir}${NC}"

    info "Generating client credentials..."
    "$prisma" gen-key > "${config_dir}/.prisma-credentials"

    info "Generating TLS certificate..."
    "$prisma" gen-cert --output "${config_dir}" --cn prisma-server

    if [ ! -f "${config_dir}/server.toml" ]; then
        if download "https://raw.githubusercontent.com/${REPO}/master/server.example.toml" "${config_dir}/server.toml" 2>/dev/null; then
            info "Created server.toml from example"
        fi
    else
        info "server.toml already exists, skipping"
    fi

    if [ ! -f "${config_dir}/client.toml" ]; then
        if download "https://raw.githubusercontent.com/${REPO}/master/client.example.toml" "${config_dir}/client.toml" 2>/dev/null; then
            info "Created client.toml from example"
        fi
    else
        info "client.toml already exists, skipping"
    fi

    echo ""
    echo -e "${BOLD}Setup complete!${NC}"
    echo "  Credentials: ${config_dir}/.prisma-credentials"
    echo "  TLS cert:    ${config_dir}/prisma-cert.pem"
    echo "  TLS key:     ${config_dir}/prisma-key.pem"
    echo ""
    echo "Next steps:"
    echo "  1. Edit server.toml — paste the client ID and auth secret from .prisma-credentials"
    echo "  2. Edit client.toml — set server_addr and paste the same credentials"
    echo "  3. Run: prisma server -c server.toml"
    echo "  4. Run: prisma client -c client.toml"
}

# Main
main() {
    [ "$UNINSTALL" = true ] && do_uninstall
    do_install
    [ "$SETUP" = true ] && do_setup
    echo ""
}

main
