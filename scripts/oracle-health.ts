/**
 * Oracle freshness check for ShadowPerp.
 *
 * Usage:
 *   npx ts-node scripts/oracle-health.ts
 *   npx ts-node scripts/oracle-health.ts --max-age-seconds 300
 */

import * as anchor from "@coral-xyz/anchor";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_MAX_AGE_SECONDS = 300;

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const key = `--${name}`;
  const index = args.indexOf(key);
  if (index < 0 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parsePublicKey(name: string, value?: string): PublicKey {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required value: ${name}`);
  }
  return new PublicKey(value.trim());
}

function resolveIdlPath(): string {
  const candidates = [
    path.resolve(__dirname, "..", "target", "idl", "shadowperp.json"),
    path.resolve(__dirname, "..", "app", "src", "idl", "shadowperp.json"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      "IDL not found at target/idl/shadowperp.json or app/src/idl/shadowperp.json."
    );
  }
  return found;
}

function pickField<T>(value: any, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (value != null && value[key] !== undefined && value[key] !== null) {
      return value[key] as T;
    }
  }
  return undefined;
}

function toNumber(value: any): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value.toString === "function") {
    return Number(value.toString());
  }
  return Number.NaN;
}

async function main(): Promise<void> {
  loadEnvFile(path.resolve(__dirname, "..", "app", ".env.local"));

  const rpcUrl =
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    clusterApiUrl("devnet");
  const programId = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID",
    process.env.SHADOWPERP_PROGRAM_ID ||
      process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID
  );
  const marketPk = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT",
    process.env.SHADOWPERP_MARKET || process.env.NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT
  );
  const maxAgeSeconds = Number.parseInt(
    readArg("max-age-seconds") || `${DEFAULT_MAX_AGE_SECONDS}`,
    10
  );
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds < 1) {
    throw new Error("Invalid --max-age-seconds");
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(Keypair.generate());
  const provider = new anchor.AnchorProvider(
    connection,
    wallet,
    { commitment: "confirmed" }
  );

  const idl = JSON.parse(fs.readFileSync(resolveIdlPath(), "utf8"));
  idl.address = programId.toBase58();
  const program = new anchor.Program(idl as anchor.Idl, provider);

  const market = await (program.account as any).market.fetch(marketPk);
  const oracleRaw = toNumber(pickField<any>(market, "oraclePrice", "oracle_price"));
  const lastUpdate = toNumber(
    pickField<any>(market, "lastPriceUpdate", "last_price_update")
  );
  const now = Math.floor(Date.now() / 1000);
  const age = now - lastUpdate;

  const oracleUi = Number.isFinite(oracleRaw) ? oracleRaw / 1_000_000 : Number.NaN;
  console.log("ShadowPerp Oracle Health");
  console.log(`Program: ${programId.toBase58()}`);
  console.log(`Market:  ${marketPk.toBase58()}`);
  console.log(`RPC:     ${rpcUrl}`);
  console.log(`Price:   ${Number.isFinite(oracleUi) ? `$${oracleUi.toFixed(4)}` : "invalid"}`);
  console.log(`Age:     ${age}s (max ${maxAgeSeconds}s)`);

  if (!Number.isFinite(oracleRaw) || oracleRaw <= 0) {
    throw new Error("Oracle price is missing or invalid.");
  }
  if (!Number.isFinite(age) || age < 0 || age > maxAgeSeconds) {
    throw new Error("Oracle is stale.");
  }
}

main().catch((error) => {
  console.error("oracle-health failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
