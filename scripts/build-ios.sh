#!/usr/bin/env bash
# Build prisma-ffi as a static library for iOS (aarch64-apple-ios).
#
# Prerequisites:
#   - Xcode 15+ with iOS SDK
#   - rustup target add aarch64-apple-ios
#   - rustup target add aarch64-apple-ios-sim  (for simulator)
#
# Usage:
#   ./scripts/build-ios.sh [release|debug] [--simulator]
#
# Output:
#   target/aarch64-apple-ios/release/libprisma_ffi.a
#   target/aarch64-apple-ios-sim/release/libprisma_ffi.a  (if --simulator)
#   target/universal-ios/libprisma_ffi.a                   (if both)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

PROFILE="${1:-release}"
SIMULATOR=false

for arg in "$@"; do
    case "$arg" in
        --simulator) SIMULATOR=true ;;
    esac
done

CARGO_FLAGS="-p prisma-ffi"
if [ "$PROFILE" = "release" ]; then
    CARGO_FLAGS="$CARGO_FLAGS --release"
fi

echo "=== Building prisma-ffi for iOS ==="
echo "Profile: $PROFILE"
echo ""

# Ensure targets are installed
rustup target add aarch64-apple-ios 2>/dev/null || true

echo "[1/3] Building for aarch64-apple-ios (device)..."
cargo build $CARGO_FLAGS --target aarch64-apple-ios
DEVICE_LIB="target/aarch64-apple-ios/$PROFILE/libprisma_ffi.a"
echo "  -> $DEVICE_LIB"

if [ "$SIMULATOR" = true ]; then
    rustup target add aarch64-apple-ios-sim 2>/dev/null || true

    echo "[2/3] Building for aarch64-apple-ios-sim (simulator)..."
    cargo build $CARGO_FLAGS --target aarch64-apple-ios-sim
    SIM_LIB="target/aarch64-apple-ios-sim/$PROFILE/libprisma_ffi.a"
    echo "  -> $SIM_LIB"

    echo "[3/3] Creating universal binary with lipo..."
    UNIVERSAL_DIR="target/universal-ios"
    mkdir -p "$UNIVERSAL_DIR"
    # Note: for XCFramework, keep them separate. For fat binary:
    # We can't lipo arm64 + arm64-sim (same arch). Use xcframework instead.
    echo "  -> Creating XCFramework..."

    XCFRAMEWORK_DIR="target/PrismaFFI.xcframework"
    rm -rf "$XCFRAMEWORK_DIR"
    xcodebuild -create-xcframework \
        -library "$DEVICE_LIB" -headers crates/prisma-ffi/include \
        -library "$SIM_LIB" -headers crates/prisma-ffi/include \
        -output "$XCFRAMEWORK_DIR"
    echo "  -> $XCFRAMEWORK_DIR"
else
    echo "[2/3] Skipping simulator build (pass --simulator to include)"
    echo "[3/3] Skipping XCFramework creation"
fi

echo ""
echo "=== Copying header ==="
cp crates/prisma-ffi/include/prisma_ffi.h target/prisma_ffi.h
echo "  -> target/prisma_ffi.h"

echo ""
echo "=== iOS build complete ==="
echo ""
echo "To use in Xcode project:"
echo "  1. Add libprisma_ffi.a to 'Link Binary With Libraries'"
echo "  2. Add prisma_ffi.h to the bridging header"
echo "  3. Set LIBRARY_SEARCH_PATHS to the target directory"
