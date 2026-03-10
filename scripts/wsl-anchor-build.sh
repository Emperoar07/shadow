#!/usr/bin/env bash
set -euo pipefail

REPO="/mnt/c/Users/bolaj/projects/shadowperp"
SOLANA_BIN="$HOME/.local/share/solana-2.3.13/active_release/bin"
NODE_PATH="$(command -v node || true)"
if [ -z "$NODE_PATH" ] && [ -x "$HOME/.local/node-v20.20.0-linux-x64/bin/node" ]; then
  NODE_PATH="$HOME/.local/node-v20.20.0-linux-x64/bin/node"
fi
NODE_BIN="$(dirname "$NODE_PATH")"

if [ ! -x "$SOLANA_BIN/cargo-build-sbf" ]; then
  echo "ERROR: Solana 2.3.13 lane not found at $SOLANA_BIN"
  exit 1
fi

if [ -z "$NODE_PATH" ] || [ ! -x "$NODE_BIN/node" ]; then
  echo "ERROR: node not found in WSL"
  exit 1
fi

export HOME="$HOME"
export CARGO_HOME="$HOME/.cargo"
export CARGO_TARGET_DIR="$HOME/.cargo-native/target"
mkdir -p "$CARGO_TARGET_DIR"
export PATH="$SOLANA_BIN:$NODE_BIN:$HOME/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

cd "$REPO"

bash scripts/wsl-arcium-build.sh
cargo-build-sbf --tools-version v1.53 --manifest-path programs/shadowperp/Cargo.toml
mkdir -p target/deploy
cp "$CARGO_TARGET_DIR/deploy/shadowperp.so" target/deploy/shadowperp.so
mkdir -p target/idl
node scripts/build-idl.js --program-path programs/shadowperp --out target/idl/shadowperp.json
