/**
 * Live oracle price feed for devnet.
 *
 * Fetches SOL/USD from multiple sources (CoinGecko, Binance, CryptoCompare)
 * and pushes the median price to the on-chain market account.
 *
 * Usage:
 *   npx ts-node scripts/oracle-feed.ts [--interval 30] [--rpc <url>]
 *
 * Ctrl+C to stop.
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolveRpcEndpoint } from "./rpc";

const PROGRAM_ID = new PublicKey("ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4");
const MARKET = new PublicKey("crEV9TSAU6xkiWFUAZebejHmWVh6VFx5EEFLcfX9L2T");

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

// ---------------------------------------------------------------------------
// Price sources — all free, no API key needed
// ---------------------------------------------------------------------------

type PriceResult = { source: string; price: number };

async function fetchCoinGecko(): Promise<PriceResult> {
  const resp = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!resp.ok) throw new Error(`CoinGecko HTTP ${resp.status}`);
  const data: any = await resp.json();
  const price = data?.solana?.usd;
  if (typeof price !== "number" || price <= 0) throw new Error("CoinGecko: invalid price");
  return { source: "CoinGecko", price };
}

async function fetchBinance(): Promise<PriceResult> {
  const resp = await fetch(
    "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT",
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!resp.ok) throw new Error(`Binance HTTP ${resp.status}`);
  const data: any = await resp.json();
  const price = parseFloat(data?.price);
  if (isNaN(price) || price <= 0) throw new Error("Binance: invalid price");
  return { source: "Binance", price };
}

async function fetchCryptoCompare(): Promise<PriceResult> {
  const resp = await fetch(
    "https://min-api.cryptocompare.com/data/price?fsym=SOL&tsyms=USD",
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!resp.ok) throw new Error(`CryptoCompare HTTP ${resp.status}`);
  const data: any = await resp.json();
  const price = data?.USD;
  if (typeof price !== "number" || price <= 0) throw new Error("CryptoCompare: invalid price");
  return { source: "CryptoCompare", price };
}

/**
 * Fetch from all sources in parallel, take the median of successful results.
 * Requires at least 1 source to succeed. If 2+ succeed, uses median for
 * manipulation resistance.
 */
async function getSolPrice(): Promise<{ price: number; sources: PriceResult[] }> {
  const results = await Promise.allSettled([
    fetchCoinGecko(),
    fetchBinance(),
    fetchCryptoCompare(),
  ]);

  const successful: PriceResult[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      successful.push(r.value);
    }
  }

  if (successful.length === 0) {
    const errors = results
      .map((r) => r.status === "rejected" ? r.reason?.message : "")
      .filter(Boolean);
    throw new Error(`All price sources failed: ${errors.join("; ")}`);
  }

  // Sort by price and take the median
  successful.sort((a, b) => a.price - b.price);
  const medianIdx = Math.floor(successful.length / 2);
  const medianPrice = successful.length % 2 === 0
    ? (successful[medianIdx - 1].price + successful[medianIdx].price) / 2
    : successful[medianIdx].price;

  return { price: medianPrice, sources: successful };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const intervalSec = parseInt(readArg("interval") || "30", 10);
  const rpcOverride = readArg("rpc");
  const { rpcUrl } = await resolveRpcEndpoint({ preferred: rpcOverride });

  const walletPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );

  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const idlPath = path.resolve(__dirname, "..", "target", "idl", "shadowperp.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const program = new anchor.Program(
    { ...idl, address: PROGRAM_ID.toBase58() } as any,
    provider
  );

  console.log("=== ShadowPerp Oracle Feed ===");
  console.log(`  Market:   ${MARKET.toBase58()}`);
  console.log(`  Feeder:   ${wallet.publicKey.toBase58()}`);
  console.log(`  Interval: ${intervalSec}s`);
  console.log(`  RPC:      ${rpcUrl.replace(/\/[a-f0-9]{20,}/, "/***")}`);
  console.log(`  Sources:  CoinGecko, Binance, CryptoCompare (median)`);
  console.log("");

  let lastOnChainPrice = 0;
  let updateCount = 0;
  let skipCount = 0;

  async function tick() {
    const ts = new Date().toISOString().slice(11, 19);
    try {
      const { price, sources } = await getSolPrice();
      const priceMicro = Math.round(price * 1_000_000);
      const priceLamports = new anchor.BN(priceMicro);
      const sourceNames = sources.map((s) => `${s.source}=$${s.price.toFixed(2)}`).join(", ");

      // Skip if price hasn't changed meaningfully (< 0.1%)
      if (lastOnChainPrice > 0) {
        const diff = Math.abs(priceMicro - lastOnChainPrice) / lastOnChainPrice;
        if (diff < 0.001) {
          skipCount++;
          console.log(`  [${ts}] $${price.toFixed(2)} — skip (Δ${(diff * 100).toFixed(3)}%) [${sources.length} src]`);
          return;
        }
      }

      const tx = await program.methods
        .updatePrice(priceLamports)
        .accounts({
          priceFeeder: wallet.publicKey,
          market: MARKET,
        })
        .rpc();

      lastOnChainPrice = priceMicro;
      updateCount++;
      console.log(`  [${ts}] $${price.toFixed(2)} — updated (${sourceNames}) tx:${tx.slice(0, 12)}...`);
    } catch (e: any) {
      console.log(`  [${ts}] ERROR: ${e.message?.slice(0, 120)}`);
    }
  }

  // Initial tick
  await tick();

  // Loop
  const interval = setInterval(tick, intervalSec * 1000);

  // Stats on shutdown
  process.on("SIGINT", () => {
    console.log(`\nOracle feed stopped. ${updateCount} updates, ${skipCount} skipped.`);
    clearInterval(interval);
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    clearInterval(interval);
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

main().catch((e) => {
  console.error("Oracle feed crashed:", e.message);
  process.exit(1);
});
