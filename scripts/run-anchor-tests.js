const { spawnSync } = require("child_process");
const { existsSync } = require("fs");
const { join } = require("path");
const os = require("os");

const repoRoot = process.cwd();
const defaultWallet = join(os.homedir(), ".config", "solana", "id.json");
const walletPath = process.env.ANCHOR_WALLET || defaultWallet;

if (!existsSync(walletPath)) {
  console.error(`ANCHOR_WALLET not found: ${walletPath}`);
  process.exit(1);
}

const env = {
  ...process.env,
  ANCHOR_PROVIDER_URL:
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com",
  ANCHOR_WALLET: walletPath,
};

const tsMocha = join(repoRoot, "node_modules", "ts-mocha", "bin", "ts-mocha");
const result = spawnSync(
  process.execPath,
  [tsMocha, "-p", "./tsconfig.json", "-t", "1000000", "tests/**/*.ts"],
  {
    stdio: "inherit",
    cwd: repoRoot,
    env,
  }
);

process.exit(result.status ?? 1);
