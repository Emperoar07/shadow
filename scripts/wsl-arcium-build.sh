#!/usr/bin/env bash
set -euo pipefail

REPO="/mnt/c/Users/bolaj/projects/shadowperp"
WIN_CARGO_BIN="/mnt/c/Users/bolaj/.cargo/bin"
LINUX_CARGO_BIN="$HOME/.cargo/bin"

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

# Bridge to Windows Rust toolchain.
cat > "$LINUX_CARGO_BIN/cargo" <<'EOF'
#!/usr/bin/env bash
exec /mnt/c/Users/bolaj/.cargo/bin/cargo.exe "$@"
EOF
chmod +x "$LINUX_CARGO_BIN/cargo"

cat > "$LINUX_CARGO_BIN/rustc" <<'EOF'
#!/usr/bin/env bash
exec /mnt/c/Users/bolaj/.cargo/bin/rustc.exe "$@"
EOF
chmod +x "$LINUX_CARGO_BIN/rustc"

cat > "$LINUX_CARGO_BIN/anchor" <<'EOF'
#!/usr/bin/env bash
exec /mnt/c/Users/bolaj/.cargo/bin/anchor.exe "$@"
EOF
chmod +x "$LINUX_CARGO_BIN/anchor"

export PATH="$LINUX_CARGO_BIN:$WIN_CARGO_BIN:$PATH"
cd "$REPO"

echo "Using arcium: $(command -v arcium)"
echo "Using cargo:  $(command -v cargo)"
echo "Using rustc:  $(command -v rustc)"
echo "Using anchor: $(command -v anchor)"
arcium --version
cargo --version
rustc --version
anchor --version

arcium build

echo "Build artifacts:"
ls -la build
