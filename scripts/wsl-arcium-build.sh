#!/usr/bin/env bash
set -euo pipefail

REPO="/mnt/c/Users/bolaj/projects/shadowperp"
WIN_AVM_BIN="/mnt/c/Users/bolaj/.avm/bin"
LINUX_CARGO_BIN="$HOME/.cargo/bin"
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

# Anchor binary: use Windows exe via bridge (only used for anchor build/deploy, not circuits)
cat > "$LINUX_CARGO_BIN/anchor" <<'EOF'
#!/usr/bin/env bash
if [ -x /mnt/c/Users/bolaj/.avm/bin/anchor-0.32.1.exe ]; then
  exec /mnt/c/Users/bolaj/.avm/bin/anchor-0.32.1.exe "$@"
fi
if [ -x /mnt/c/Users/bolaj/.avm/bin/anchor-0.32.1 ]; then
  exec /mnt/c/Users/bolaj/.avm/bin/anchor-0.32.1 "$@"
fi
exec /mnt/c/Users/bolaj/.cargo/bin/anchor.exe "$@"
EOF
chmod +x "$LINUX_CARGO_BIN/anchor"

# Reuse the Windows cargo registry (all crates already cached there).
# Keep a SEPARATE target dir so Linux and Windows build artifacts don't mix.
# The proc-macro2 GitHub URL is redirected to the local Windows git cache via
# git url.insteadOf (set up once by _setup_git_rewrite.sh).
WIN_CARGO_HOME="/mnt/c/Users/bolaj/.cargo"
export CARGO_HOME="$WIN_CARGO_HOME"
export CARGO_TARGET_DIR="$HOME/.cargo-native/target"
mkdir -p "$CARGO_TARGET_DIR"

export PATH="$NATIVE_RUST_BIN:$LINUX_CARGO_BIN:$WIN_AVM_BIN:$PATH"

cd "$REPO"

echo "Using arcium: $(command -v arcium)"
echo "Using cargo:  $(command -v cargo)"
echo "Using rustc:  $(command -v rustc)"
echo "Using anchor: $(command -v anchor)"
arcium --version
cargo --version
rustc --version
anchor --version

arcium build --skip-keys-sync

echo "Build artifacts:"
ls -la build
