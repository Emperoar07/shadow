#!/usr/bin/env bash
set -euo pipefail

REPO="/mnt/c/Users/bolaj/projects/shadowperp"
DEFAULT_SOLANA_BIN="$HOME/.local/share/solana/install/releases/2.3.0/solana-release/bin"
SOLANA_BIN="$(dirname "$(command -v cargo-build-sbf 2>/dev/null || true)")"
if [ -z "$SOLANA_BIN" ] || [ "$SOLANA_BIN" = "." ]; then
  SOLANA_BIN="$DEFAULT_SOLANA_BIN"
fi

export HOME="$HOME"
export CARGO_HOME="$HOME/.cargo"
export CARGO_TARGET_DIR="$HOME/.cargo-native/target"
mkdir -p "$CARGO_TARGET_DIR"
export PATH="$SOLANA_BIN:$HOME/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

cd "$REPO"

echo "=== Building program with --features shielded-collateral ==="
cargo-build-sbf --tools-version v1.53 \
  --manifest-path programs/shadowperp/Cargo.toml \
  -- --features shielded-collateral

echo ""
echo "=== Copying artifact ==="
mkdir -p target/deploy
cp "$CARGO_TARGET_DIR/deploy/shadowperp.so" target/deploy/shadowperp.so
ls -la target/deploy/shadowperp.so

echo ""
echo "=== Done ==="
