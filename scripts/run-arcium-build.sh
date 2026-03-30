#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana-2.3.13/active_release/bin:/usr/local/bin:/usr/bin:/bin"
export CARGO_HOME="$HOME/.cargo"

REPO="/mnt/c/Users/bolaj/projects/shadowperp"
cd "$REPO"

echo "=== Environment ==="
echo "arcium: $(which arcium)"
arcium --version
echo "cargo: $(which cargo)"
cargo --version
echo "rustc: $(which rustc)"
rustc --version

echo ""
echo "=== Building circuits ==="
arcium build --skip-keys-sync --skip-program

echo ""
echo "=== Build artifacts ==="
ls -la build/*.arcis build/*.idarc 2>/dev/null

echo ""
echo "=== Done ==="
