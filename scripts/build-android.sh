#!/usr/bin/env bash
# Build prisma-ffi as a shared library for Android targets.
#
# Prerequisites:
#   - Android NDK r26+ (set ANDROID_NDK_HOME or auto-detect)
#   - rustup target add aarch64-linux-android
#   - rustup target add armv7-linux-androideabi
#   - rustup target add x86_64-linux-android
#
# Usage:
#   ./scripts/build-android.sh [release|debug] [--target arm64|armv7|x86_64|all]
#
# Output:
#   target/aarch64-linux-android/release/libprisma_ffi.so
#   target/armv7-linux-androideabi/release/libprisma_ffi.so
#   target/x86_64-linux-android/release/libprisma_ffi.so

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

PROFILE="${1:-release}"
TARGET_ARCH="${2:---target}"
TARGET_VALUE="${3:-all}"

# Parse --target flag
for i in "$@"; do
    case "$i" in
        --target)
            shift
            TARGET_VALUE="${1:-all}"
            ;;
    esac
done

# Auto-detect NDK
if [ -z "${ANDROID_NDK_HOME:-}" ]; then
    # Try common locations
    if [ -d "$HOME/Library/Android/sdk/ndk" ]; then
        ANDROID_NDK_HOME="$(ls -d "$HOME/Library/Android/sdk/ndk/"* 2>/dev/null | sort -V | tail -1)"
    elif [ -d "/usr/local/lib/android/sdk/ndk" ]; then
        ANDROID_NDK_HOME="$(ls -d "/usr/local/lib/android/sdk/ndk/"* 2>/dev/null | sort -V | tail -1)"
    fi
fi

if [ -z "${ANDROID_NDK_HOME:-}" ]; then
    echo "ERROR: ANDROID_NDK_HOME not set and NDK not found in common locations."
    echo "Set ANDROID_NDK_HOME to your NDK installation directory."
    exit 1
fi

echo "=== Building prisma-ffi for Android ==="
echo "NDK: $ANDROID_NDK_HOME"
echo "Profile: $PROFILE"
echo ""

# Detect host OS for toolchain binaries
case "$(uname -s)" in
    Darwin) HOST_TAG="darwin-x86_64" ;;
    Linux)  HOST_TAG="linux-x86_64" ;;
    *)      HOST_TAG="windows-x86_64" ;;
esac

TOOLCHAIN="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$HOST_TAG"
API_LEVEL=24

CARGO_FLAGS="-p prisma-ffi --features android"
if [ "$PROFILE" = "release" ]; then
    CARGO_FLAGS="$CARGO_FLAGS --release"
fi

build_target() {
    local RUST_TARGET="$1"
    local NDK_TRIPLE="$2"
    local LABEL="$3"

    echo "Building for $LABEL ($RUST_TARGET)..."
    rustup target add "$RUST_TARGET" 2>/dev/null || true

    export CC="${TOOLCHAIN}/bin/${NDK_TRIPLE}${API_LEVEL}-clang"
    export CXX="${TOOLCHAIN}/bin/${NDK_TRIPLE}${API_LEVEL}-clang++"
    export AR="${TOOLCHAIN}/bin/llvm-ar"
    export RANLIB="${TOOLCHAIN}/bin/llvm-ranlib"
    export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="${CC}"
    export CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER="${CC}"
    export CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER="${CC}"

    cargo build $CARGO_FLAGS --target "$RUST_TARGET"

    local OUTPUT="target/$RUST_TARGET/$PROFILE/libprisma_ffi.so"
    if [ -f "$OUTPUT" ]; then
        echo "  -> $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
    else
        echo "  -> WARNING: $OUTPUT not found"
    fi
}

case "$TARGET_VALUE" in
    arm64|aarch64)
        build_target "aarch64-linux-android" "aarch64-linux-android" "Android ARM64"
        ;;
    armv7|arm)
        build_target "armv7-linux-androideabi" "armv7a-linux-androideabi" "Android ARMv7"
        ;;
    x86_64|x64)
        build_target "x86_64-linux-android" "x86_64-linux-android" "Android x86_64"
        ;;
    all)
        build_target "aarch64-linux-android" "aarch64-linux-android" "Android ARM64"
        build_target "armv7-linux-androideabi" "armv7a-linux-androideabi" "Android ARMv7"
        build_target "x86_64-linux-android" "x86_64-linux-android" "Android x86_64"
        ;;
    *)
        echo "ERROR: Unknown target '$TARGET_VALUE'. Use: arm64, armv7, x86_64, or all"
        exit 1
        ;;
esac

# Copy libraries to Android project jniLibs if it exists
ANDROID_APP_DIR="prisma-android/app/src/main/jniLibs"
if [ -d "prisma-android" ]; then
    echo ""
    echo "=== Copying to Android project jniLibs ==="
    mkdir -p "$ANDROID_APP_DIR/arm64-v8a"
    mkdir -p "$ANDROID_APP_DIR/armeabi-v7a"
    mkdir -p "$ANDROID_APP_DIR/x86_64"

    [ -f "target/aarch64-linux-android/$PROFILE/libprisma_ffi.so" ] && \
        cp "target/aarch64-linux-android/$PROFILE/libprisma_ffi.so" "$ANDROID_APP_DIR/arm64-v8a/" && \
        echo "  -> $ANDROID_APP_DIR/arm64-v8a/libprisma_ffi.so"

    [ -f "target/armv7-linux-androideabi/$PROFILE/libprisma_ffi.so" ] && \
        cp "target/armv7-linux-androideabi/$PROFILE/libprisma_ffi.so" "$ANDROID_APP_DIR/armeabi-v7a/" && \
        echo "  -> $ANDROID_APP_DIR/armeabi-v7a/libprisma_ffi.so"

    [ -f "target/x86_64-linux-android/$PROFILE/libprisma_ffi.so" ] && \
        cp "target/x86_64-linux-android/$PROFILE/libprisma_ffi.so" "$ANDROID_APP_DIR/x86_64/" && \
        echo "  -> $ANDROID_APP_DIR/x86_64/libprisma_ffi.so"
fi

echo ""
echo "=== Android build complete ==="
