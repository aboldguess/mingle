#!/usr/bin/env bash
# ============================================================================
# fetch_three_assets.sh - Retrieve pinned Three.js assets for Mingle
#
# This script downloads specific versions of three.module.js and GLTFLoader.js
# from the official Three.js repository and places them in public/js/vendor/.
# Each download is validated against a known SHA-256 checksum to ensure file
# integrity and protect against tampering.
#
# Usage:
#   ./scripts/fetch_three_assets.sh        # Linux / Raspberry Pi / macOS
#   bash scripts/fetch_three_assets.sh     # Windows (Git Bash or WSL)
#
# Structure:
#   1. Verify required tools are available.
#   2. Define version and checksum constants.
#   3. Download each asset to a temporary file.
#   4. Validate the checksum before moving it into place.
#
# Requirements:
#   - curl: for downloading files
#   - sha256sum: for checksum verification
# ============================================================================
set -euo pipefail

# Ensure required commands are present
for cmd in curl sha256sum; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "Error: $cmd is required but not installed." >&2
        exit 1
    fi
done

# Configuration
THREE_VERSION="r179"
THREE_URL="https://raw.githubusercontent.com/mrdoob/three.js/${THREE_VERSION}/build/three.module.js"
GLTF_URL="https://raw.githubusercontent.com/mrdoob/three.js/${THREE_VERSION}/examples/jsm/loaders/GLTFLoader.js"

# Expected SHA-256 checksums for integrity verification
THREE_SHA256="ce6be0cb5ead0027e1f6094dd82ad43bba0886c03324a3b21fd9a33ac93fc2b4"
GLTF_SHA256="caba6c51cfd8c7d5313bd7705a54b76bc0a7199d9822ecc497c5311eaffe8e5e"

TARGET_DIR="public/js/vendor"
mkdir -p "$TARGET_DIR"

# Download and verify a single asset
# Arguments: URL DEST EXPECTED_HASH
download_and_verify() {
    local url="$1"
    local dest="$2"
    local expected="$3"
    local tmpfile
    tmpfile="$(mktemp)"

    echo "Downloading $url"
    curl -fsSL "$url" -o "$tmpfile"

    echo "Verifying checksum for $(basename "$dest")"
    local hash
    hash="$(sha256sum "$tmpfile" | awk '{print $1}')"
    if [[ "$hash" != "$expected" ]]; then
        echo "Checksum mismatch for $url" >&2
        rm -f "$tmpfile"
        exit 1
    fi

    mv "$tmpfile" "$dest"
    echo "Saved $dest"
}

# Fetch assets
download_and_verify "$THREE_URL" "$TARGET_DIR/three.module.js" "$THREE_SHA256"
download_and_verify "$GLTF_URL" "$TARGET_DIR/GLTFLoader.js" "$GLTF_SHA256"

echo "Three.js assets have been updated in $TARGET_DIR"
