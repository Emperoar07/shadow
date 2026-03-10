#!/usr/bin/env bash
set -euo pipefail

REPO="/mnt/c/Users/bolaj/projects/shadowperp"
LINUX_CARGO_BIN="$HOME/.cargo/bin"
LINUX_SOLANA_BIN="$HOME/.local/share/solana-2.3.13/active_release/bin"
# Native Linux Rust toolchain installed offline from Windows-downloaded archive.
NATIVE_RUST_BIN="$HOME/.rust-native/install/bin"

mkdir -p "$LINUX_CARGO_BIN"

# Inject Linux binaries downloaded on Windows host.
if [ ! -x "$LINUX_CARGO_BIN/arcium" ] && [ -f "$REPO/arcium_x86_64_linux" ]; then
  cp "$REPO/arcium_x86_64_linux" "$LINUX_CARGO_BIN/arcium"
  chmod +x "$LINUX_CARGO_BIN/arcium"
fi

if [ ! -x "$LINUX_CARGO_BIN/arcup" ] && [ -f "$REPO/arcup_x86_64_linux" ]; then
  cp "$REPO/arcup_x86_64_linux" "$LINUX_CARGO_BIN/arcup"
  chmod +x "$LINUX_CARGO_BIN/arcup"
fi

# Use native Linux Rust for arcis circuit compilation.
# The Windows cargo.exe bridge fails because arcis proc-macros check CARGO_MANIFEST_DIR
# and panic when it resolves to a Windows (C:\...) path.
if [ ! -x "$NATIVE_RUST_BIN/cargo" ]; then
  echo "ERROR: Native Linux Rust not found at $NATIVE_RUST_BIN"
  echo "Run: scripts/wsl-arcium-build.sh (first time installs toolchain)"
  exit 1
fi

# Use native Linux Anchor + Solana build lane. Windows bridge remains too fragile.
if [ ! -x "$LINUX_CARGO_BIN/anchor" ]; then
  echo "ERROR: Native Linux anchor not found at $LINUX_CARGO_BIN/anchor"
  exit 1
fi
if [ ! -x "$LINUX_SOLANA_BIN/cargo-build-sbf" ]; then
  echo "ERROR: Solana 2.3.13 lane not found at $LINUX_SOLANA_BIN"
  exit 1
fi

# Keep a separate target dir so Linux and Windows build artifacts don't mix.
export CARGO_HOME="$HOME/.cargo"
export CARGO_TARGET_DIR="$HOME/.cargo-native/target"
mkdir -p "$CARGO_TARGET_DIR"

export HOME="$HOME"
export PATH="$LINUX_SOLANA_BIN:$NATIVE_RUST_BIN:$LINUX_CARGO_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

cd "$REPO"

echo "Using arcium: $(command -v arcium)"
echo "Using cargo:  $(command -v cargo)"
echo "Using rustc:  $(command -v rustc)"
echo "Using anchor: $(command -v anchor)"
arcium --version
cargo --version
rustc --version
anchor --version

arcium build --skip-keys-sync --skip-program

# The repo consumes the batched open-position circuit as "open_position_v4",
# but Arcium may still emit the confidential artifact as "open_position".
# Publish versioned aliases so Anchor macros and comp-def init resolve the same build output.
for ext in arcis arcis.ir hash idarc profile.json ts weight; do
  if [ -f "build/open_position.$ext" ]; then
    cp -f "build/open_position.$ext" "build/open_position_v4.$ext"
  fi
  if [ -f "build/close_position.$ext" ]; then
    cp -f "build/close_position.$ext" "build/close_position_v2.$ext"
  fi
done

echo "Build artifacts:"
ls -la build
