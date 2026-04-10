/**
 * Live oracle price feed for all ShadowPerp markets.
 *
 * Fetches prices for all 6 trading pairs from CoinGecko (batch) with
 * per-symbol Binance fallback, then pushes the median to each on-chain
 * market account via updatePrice.
 *
 * Usage:
 *   npx ts-node scripts/oracle-feed.ts [--interval 30] [--rpc <url>] [--once]
 *
 * Ctrl+C to stop.
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolveRpcEndpoint, sendAndConfirmWithPolling } from "./rpc";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ||
    "ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4"
);
const COLLATERAL_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_SHADOWPERP_COLLATERAL_MINT ||
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

// Market config: label, base mint, CoinGecko id, Binance symbol
const MARKETS = [
  {
    label: "SOL-USD",
    mint: new PublicKey("So11111111111111111111111111111111111111112"),
    coingeckoId: "solana",
    binanceSymbol: "SOLUSDT",
  },
  {
    label: "BTC-USD",
    mint: new PublicKey("Fr78KdvjEzwoHUkZaxAyaEMet3j3rj1RrkRstAFrW7Mp"),
    coingeckoId: "bitcoin",
    binanceSymbol: "BTCUSDT",
  },
  {
    label: "ETH-USD",
    mint: new PublicKey("9RY2ZMuaFEGRobJouxoa4zB1rUodYHQDbdbvitm14i2J"),
    coingeckoId: "ethereum",
    binanceSymbol: "ETHUSDT",
  },
  {
    label: "JUP-USD",
    mint: new PublicKey("5eaWPHYLfSh4sVz9aMWWNyVL2HQ63jRey9LKqyps6jDE"),
    coingeckoId: "jupiter-exchange-solana",
    binanceSymbol: "JUPUSDT",
  },
  {
    label: "PYTH-USD",
    mint: new PublicKey("CLCViKbtR5odvYuNDJR9atLcLcGKFP1Gei5Vrzice9sU"),
    coingeckoId: "pyth-network",
    binanceSymbol: "PYTHUSDT",
  },
  {
    label: "ORCA-USD",
    mint: new PublicKey("8SaPwVyKXSUwQ23xG56K7oVNVmN9YhJdhE6GB4pKKNKd"),
    coingeckoId: "orca",
    binanceSymbol: "ORCAUSDT",
  },
] as const;

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function readFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function deriveMarketPda(baseMint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), COLLATERAL_MINT.toBuffer(), baseMint.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

// ── Price fetching ──────────────────────────────────────────────────────────

async function fetchCoinGeckoBatch(
  ids: string[]
): Promise<Record<string, number>> {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!resp.ok) throw new Error(`CoinGecko HTTP ${resp.status}`);
  const data: any = await resp.json();
  const result: Record<string, number> = {};
  for (const id of ids) {
    const price = data?.[id]?.usd;
    if (typeof price === "number" && price > 0) result[id] = price;
  }
  return result;
}

async function fetchBinancePrice(symbol: string): Promise<number> {
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!resp.ok) throw new Error(`Binance HTTP ${resp.status}`);
  const data: any = await resp.json();
  const price = parseFloat(data?.price);
  if (isNaN(price) || price <= 0) throw new Error(`Binance: invalid price for ${symbol}`);
  return price;
}

async function fetchAllPrices(): Promise<Record<string, number>> {
  const ids = MARKETS.map((m) => m.coingeckoId);

  // Try CoinGecko batch first
  let cgPrices: Record<string, number> = {};
  try {
    cgPrices = await fetchCoinGeckoBatch([...ids]);
  } catch (e: any) {
    console.warn(`  CoinGecko batch failed: ${e.message?.slice(0, 80)}`);
  }

  const prices: Record<string, number> = {};

  for (const market of MARKETS) {
    const cgPrice = cgPrices[market.coingeckoId];
    if (cgPrice) {
      // Try Binance for cross-check
      try {
        const binancePrice = await fetchBinancePrice(market.binanceSymbol);
        // Use median of two sources
        const sorted = [cgPrice, binancePrice].sort((a, b) => a - b);
        prices[market.label] = sorted[0] * 0.5 + sorted[1] * 0.5;
      } catch {
        prices[market.label] = cgPrice;
      }
    } else {
      // CoinGecko failed for this token — try Binance directly
      try {
        prices[market.label] = await fetchBinancePrice(market.binanceSymbol);
      } catch (e: any) {
        console.warn(`  No price for ${market.label}: ${e.message?.slice(0, 60)}`);
      }
    }
  }

  return prices;
}

// ── Oracle update ───────────────────────────────────────────────────────────

async function updateMarketPrice(
  program: anchor.Program,
  wallet: Keypair,
  connection: Connection,
  marketPda: PublicKey,
  label: string,
  priceUsd: number,
  lastPrice: number
): Promise<number> {
  const priceMicro = Math.round(priceUsd * 1_000_000);

  // Skip if < 0.1% change
  if (lastPrice > 0) {
    const diff = Math.abs(priceMicro - lastPrice) / lastPrice;
    if (diff < 0.001) return lastPrice;
  }

  const tx = await (program.methods as any)
    .updatePrice(new anchor.BN(priceMicro))
    .accounts({
      priceFeeder: wallet.publicKey,
      market: marketPda,
    })
    .transaction();

  const sig = await sendAndConfirmWithPolling(connection, wallet, tx, {
    commitment: "confirmed",
    timeoutMs: 90_000,
    pollMs: 2_000,
  });

  console.log(`  ${label.padEnd(10)} $${priceUsd.toFixed(4).padStart(12)}  tx=${sig.slice(0, 12)}...`);
  return priceMicro;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const intervalSec = parseInt(readArg("interval") || "30", 10);
  const rpcOverride = readArg("rpc");
  const once = readFlag("once");

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

  const idlCandidates = [
    path.resolve(__dirname, "..", "target", "idl", "shadowperp.json"),
    path.resolve(__dirname, "..", "app", "src", "idl", "shadowperp.json"),
  ];
  const idlPath = idlCandidates.find((p) => fs.existsSync(p));
  if (!idlPath) throw new Error("IDL not found");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const program = new anchor.Program(
    { ...idl, address: PROGRAM_ID.toBase58() } as any,
    provider
  );

  // Derive all market PDAs
  const marketPdas = MARKETS.map((m) => ({
    ...m,
    pda: deriveMarketPda(m.mint),
  }));

  console.log("=== ShadowPerp Oracle Feed ===");
  console.log(`  Feeder:   ${wallet.publicKey.toBase58()}`);
  console.log(`  Interval: ${once ? "once" : `${intervalSec}s`}`);
  console.log(`  RPC:      ${rpcUrl.replace(/\/[a-f0-9]{20,}/g, "/***")}`);
  console.log(`  Markets:  ${MARKETS.map((m) => m.label).join(", ")}`);
  console.log("");

  const lastPrices: Record<string, number> = {};

  async function tick() {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[${ts}] Fetching prices...`);
    try {
      const prices = await fetchAllPrices();

      for (const market of marketPdas) {
        const price = prices[market.label];
        if (!price) {
          console.log(`  ${market.label.padEnd(10)} no price available`);
          continue;
        }
        try {
          lastPrices[market.label] = await updateMarketPrice(
            program,
            wallet,
            connection,
            market.pda,
            market.label,
            price,
            lastPrices[market.label] ?? 0
          );
        } catch (e: any) {
          console.log(`  ${market.label.padEnd(10)} update failed: ${e.message?.slice(0, 80)}`);
        }
      }
    } catch (e: any) {
      console.log(`  [${ts}] ERROR: ${e.message?.slice(0, 120)}`);
    }
  }

  await tick();

  if (once) return;

  const interval = setInterval(tick, intervalSec * 1_000);

  process.on("SIGINT", () => {
    console.log("\nOracle feed stopped.");
    clearInterval(interval);
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    clearInterval(interval);
    process.exit(0);
  });

  await new Promise(() => {});
}

main().catch((e) => {
  console.error("Oracle feed crashed:", e.message);
  process.exit(1);
});
