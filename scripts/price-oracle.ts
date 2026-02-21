/**
 * ShadowPerp Oracle Price Feeder
 *
 * Continuously fetches live SOL/USD price from CoinGecko and pushes it
 * on-chain via the `update_price` instruction. The oracle must be refreshed
 * at least every 300 seconds or trades/liquidations will be blocked.
 *
 * Prerequisites:
 *   - Program already deployed (run deploy-devnet.ts first)
 *   - Wallet keypair is the authorized price_feeder (deployer wallet by default)
 *
 * Usage:
 *   npx ts-node scripts/price-oracle.ts          # daemon mode (continuous)
 *   npx ts-node scripts/price-oracle.ts --once   # one-shot mode (GitHub Actions cron)
 *
 * Environment variables (all optional, read from app/.env.local if not set):
 *   SOLANA_WALLET          Path to keypair JSON (default: ~/.config/solana/id.json)
 *   SOLANA_RPC_URL         RPC endpoint (default: https://api.devnet.solana.com)
 *   SHADOWPERP_PROGRAM_ID  Program ID (default: from .env.local)
 *   SHADOWPERP_MARKET      Market PDA (default: from .env.local)
 *   UPDATE_INTERVAL_MS     Price update interval in ms, daemon mode only (default: 30000)
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse a minimal .env file and inject keys that aren't already in process.env */
function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

/** Fetch JSON over HTTPS. Returns parsed body or throws on non-200. */
function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "shadowperp-oracle/1.0",
          Accept: "application/json",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${(e as Error).message}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(10_000, () => {
      req.destroy(new Error("Request timed out after 10s"));
    });
  });
}

/** Fetch SOL price in USD from CoinGecko free API. Returns price in dollars. */
async function fetchSolPrice(): Promise<number> {
  const data = (await fetchJson(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
  )) as { solana?: { usd?: number } };

  const price = data?.solana?.usd;
  if (typeof price !== "number" || price <= 0) {
    throw new Error(`Unexpected CoinGecko response: ${JSON.stringify(data)}`);
  }
  return price;
}

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Format timestamp as ISO-like local string for logs. */
function ts(): string {
  return new Date().toISOString();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const onceMode = process.argv.includes("--once");
  // Load .env.local so scripts can be run without manual env setup
  loadEnvFile(path.resolve(__dirname, "..", "app", ".env.local"));

  // Config with fallbacks
  const rpcUrl =
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    "https://api.devnet.solana.com";

  const programIdStr =
    process.env.SHADOWPERP_PROGRAM_ID ||
    process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID;
  if (!programIdStr) {
    console.error("ERROR: No program ID found. Set SHADOWPERP_PROGRAM_ID or run deploy-devnet.ts first.");
    process.exit(1);
  }

  const marketStr =
    process.env.SHADOWPERP_MARKET ||
    process.env.NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT;
  if (!marketStr) {
    console.error("ERROR: No market account found. Set SHADOWPERP_MARKET or run deploy-devnet.ts first.");
    process.exit(1);
  }

  const walletPath =
    process.env.SOLANA_WALLET ||
    path.resolve(process.env.HOME || process.env.USERPROFILE || "~", ".config", "solana", "id.json");

  if (!fs.existsSync(walletPath)) {
    console.error(`ERROR: Wallet keypair not found at ${walletPath}`);
    console.error("Set SOLANA_WALLET=/path/to/keypair.json");
    process.exit(1);
  }

  const intervalMs = parseInt(process.env.UPDATE_INTERVAL_MS || "30000", 10);

  // Load keypair and connect
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  const connection = new Connection(rpcUrl, "confirmed");
  const programId = new PublicKey(programIdStr);
  const marketPda = new PublicKey(marketStr);

  // Load IDL — try build artifact first, then app copy
  const idlPaths = [
    path.resolve(__dirname, "..", "target", "idl", "shadowperp.json"),
    path.resolve(__dirname, "..", "app", "src", "idl", "shadowperp.json"),
  ];
  const idlPath = idlPaths.find((p) => fs.existsSync(p));
  if (!idlPath) {
    console.error("ERROR: shadowperp.json IDL not found. Run anchor build first.");
    process.exit(1);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  (idl as { address?: string }).address = programId.toBase58();

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  const program = new anchor.Program(idl as anchor.Idl, provider);

  console.log(`[${ts()}] ShadowPerp Oracle Price Feeder started (${onceMode ? "one-shot" : "daemon"})`);
  console.log(`  Program:  ${programId.toBase58()}`);
  console.log(`  Market:   ${marketPda.toBase58()}`);
  console.log(`  Feeder:   ${walletKeypair.publicKey.toBase58()}`);
  console.log(`  RPC:      ${rpcUrl}`);
  if (!onceMode) console.log(`  Interval: ${intervalMs / 1000}s\n`);

  let consecutiveErrors = 0;
  const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

  const pushPrice = async () => {
    const usdPrice = await fetchSolPrice();
    const priceOnChain = Math.round(usdPrice * 1_000_000);
    const sig = await (program.methods as any)
      .updatePrice(new anchor.BN(priceOnChain))
      .accounts({ priceFeeder: walletKeypair.publicKey, market: marketPda })
      .signers([walletKeypair])
      .rpc();
    console.log(
      `[${ts()}] Price updated: $${usdPrice.toFixed(4)} (${priceOnChain} raw) | sig: ${sig.slice(0, 8)}...`
    );
  };

  if (onceMode) {
    // One-shot: push once and exit. Used by GitHub Actions cron.
    await pushPrice();
    return;
  }

  // Daemon: loop forever with backoff on errors.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await pushPrice();
      consecutiveErrors = 0;
    } catch (err: unknown) {
      consecutiveErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${ts()}] ERROR (attempt ${consecutiveErrors}): ${msg}`);
      const backoff = Math.min(5_000 * 2 ** (consecutiveErrors - 1), MAX_BACKOFF_MS);
      console.error(`[${ts()}] Retrying in ${backoff / 1000}s...`);
      await sleep(backoff);
      continue;
    }
    await sleep(intervalMs);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
