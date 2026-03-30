#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$HOME/.cargo/bin"
mkdir -p "$INSTALL_DIR"

# Try to download arcium CLI binary directly
VERSION="0.9.2"
TARGET="x86_64-unknown-linux-gnu"
BASE_URL="https://bin.arcium.com/download"

# Try multiple URL patterns
for name in "arcium_${TARGET}_${VERSION}" "arcium-cli_${TARGET}_${VERSION}" "arcium_${TARGET}"; do
  url="${BASE_URL}/${name}"
  echo "Trying: $url"
  if curl -sSfL "$url" -o "${INSTALL_DIR}/arcium.tmp" 2>/dev/null; then
    mv "${INSTALL_DIR}/arcium.tmp" "${INSTALL_DIR}/arcium"
    chmod +x "${INSTALL_DIR}/arcium"
    echo "Downloaded arcium from $url"
    "${INSTALL_DIR}/arcium" --version
    exit 0
  fi
done

# If direct download fails, check if arcup can do --cli-only or similar
echo "Direct download failed. Checking arcup list..."
"${INSTALL_DIR}/arcup" list 2>/dev/null || true

# Check if arcium is already somewhere
echo "Searching for existing arcium binary..."
which arcium 2>/dev/null || find "$HOME" -name "arcium" -type f 2>/dev/null | head -5 || echo "Not found"
