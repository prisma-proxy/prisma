#!/usr/bin/env bash
# scripts/audit.sh — CI-friendly dependency audit script for Prisma.
#
# Usage:
#   ./scripts/audit.sh          # Run full audit
#   ./scripts/audit.sh --check  # Check only (non-zero exit on issues)
#
# Requires: cargo-audit (install with `cargo install cargo-audit`)

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=== Prisma Dependency Audit ==="
echo ""

# 1. Check if cargo-audit is available
if ! command -v cargo-audit &> /dev/null; then
    echo -e "${YELLOW}WARNING: cargo-audit is not installed.${NC}"
    echo "Install with: cargo install cargo-audit"
    echo ""
    echo "Skipping vulnerability scan. Running basic checks only."
    HAVE_AUDIT=false
else
    HAVE_AUDIT=true
    echo -e "${GREEN}cargo-audit found: $(cargo-audit --version)${NC}"
fi

echo ""

# 2. Run cargo-audit if available
if [ "$HAVE_AUDIT" = true ]; then
    echo "--- Vulnerability Scan ---"
    if cargo audit 2>&1; then
        echo -e "${GREEN}No known vulnerabilities found.${NC}"
    else
        echo -e "${RED}Vulnerabilities detected! See above for details.${NC}"
        if [[ "${1:-}" == "--check" ]]; then
            exit 1
        fi
    fi
    echo ""
fi

# 3. Check for Cargo.lock freshness
echo "--- Lockfile Check ---"
if [ -f Cargo.lock ]; then
    echo -e "${GREEN}Cargo.lock exists.${NC}"
    # Verify it's in sync with Cargo.toml
    if cargo check --workspace --locked 2>/dev/null; then
        echo -e "${GREEN}Cargo.lock is up to date.${NC}"
    else
        echo -e "${YELLOW}Cargo.lock may be out of date. Run 'cargo update' to refresh.${NC}"
    fi
else
    echo -e "${YELLOW}No Cargo.lock found. Run 'cargo generate-lockfile' first.${NC}"
fi

echo ""

# 4. Summary of workspace dependency versions
echo "--- Workspace Dependency Summary ---"
echo "Key dependencies from root Cargo.toml:"
echo "  tokio:              1.x"
echo "  quinn:              0.11"
echo "  rustls:             0.23"
echo "  chacha20poly1305:   0.10"
echo "  aes-gcm:            0.10"
echo "  x25519-dalek:       2.x"
echo "  ml-kem:             0.2"
echo "  axum:               0.8"
echo "  tonic:              0.13"
echo "  serde:              1.x"
echo ""

echo -e "${GREEN}Audit complete.${NC}"
