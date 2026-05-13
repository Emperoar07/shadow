/**
 * ShadowPerp Mock USDC Faucet
 *
 * Mints mock USDC to a given wallet address. The deployer wallet must be the
 * mint authority (set during deploy-devnet.ts). The collateral mint address is
 * read directly from the on-chain Market account so no extra config is needed.
 *
 * Usage:
 *   npx ts-node scripts/faucet.ts --wallet <ADDRESS> [--amount <USDC>]
 *
 * Examples:
 *   npx ts-node scripts/faucet.ts --wallet 9xQy...abc
 *   npx ts-node scripts/faucet.ts --wallet 9xQy...abc --amount 500
 *
 * Arguments:
 *   --wallet   Recipient wallet address (required)
 *   --amount   Amount of USDC to mint (default: 1000)
 *
 * Environment variables (all optional, read from app/.env.local if not set):
 *   SOLANA_WALLET          Path to deployer keypair (default: ~/.config/solana/id.json)
 *   SOLANA_RPC_URL         RPC endpoint (default: https://cool-boldest-yard.solana-devnet.quiknode.pro/3513dd000b0bf11aae344e55c52d9281969d0808)
 *   SHADOWPERP_PROGRAM_ID  Program ID (default: from .env.local)
 *   SHADOWPERP_MARKET      Market PDA (default: from .env.local)
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { resolveRpcEndpoint } from "./rpc";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse a minimal .env file and inject keys that aren't already in process.env */
function normalizeValue(raw?: string): string | undefined {
  if (!raw) return undefined;
  let out = raw.trim();
  if (!out) return undefined;
  if (out.startsWith("<") && out.endsWith(">")) {
    out = out.slice(1, -1).trim();
  }
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'"))
  ) {
    out = out.slice(1, -1).trim();
  }
  return out || undefined;
}

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const val = normalizeValue(line.slice(eq + 1));
    if (val && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

/** Simple CLI arg parser. Returns flag values or undefined. */
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--") && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      out[argv[i].slice(2)] = argv[++i];
    }
  }
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Load .env.local for zero-config developer experience
  loadEnvFile(path.resolve(__dirname, "..", "app", ".env.local"));

  const args = parseArgs(process.argv);

  // Required: recipient wallet
  const recipientStr = args["wallet"];
  if (!recipientStr) {
    console.error("Usage: npx ts-node scripts/faucet.ts --wallet <ADDRESS> [--amount <USDC>]");
    console.error("Example: npx ts-node scripts/faucet.ts --wallet 9xQy...abc --amount 500");
    process.exit(1);
  }

  let recipientPubkey: PublicKey;
  try {
    recipientPubkey = new PublicKey(recipientStr);
  } catch {
    console.error(`ERROR: Invalid wallet address: ${recipientStr}`);
    process.exit(1);
  }

  // Optional: amount (default 1000 USDC)
  const usdcAmount = parseFloat(args["amount"] || "1000");
  if (isNaN(usdcAmount) || usdcAmount <= 0) {
    console.error("ERROR: --amount must be a positive number");
    process.exit(1);
  }
  const rawAmount = Math.round(usdcAmount * 1_000_000); // USDC has 6 decimals

  // Config
  const rpcSelection = await resolveRpcEndpoint({
    preferred:
      process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    commitment: "confirmed",
  });
  const rpcUrl = rpcSelection.rpcUrl;

  const programIdStr =
    normalizeValue(process.env.SHADOWPERP_PROGRAM_ID) ||
    normalizeValue(process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID);
  if (!programIdStr) {
    console.error("ERROR: No program ID found. Set SHADOWPERP_PROGRAM_ID or run deploy-devnet.ts first.");
    process.exit(1);
  }

  const marketStr =
    normalizeValue(process.env.SHADOWPERP_MARKET) ||
    normalizeValue(process.env.NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT);
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

  // Connect
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  const connection = new Connection(rpcUrl, "confirmed");
  const programId = new PublicKey(programIdStr);
  const marketPda = new PublicKey(marketStr);

  // Load IDL to decode Market account
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

  // Read the collateral mint from the on-chain Market account
  console.log(`Fetching market state from ${marketPda.toBase58()}...`);
  const market = await (program.account as any).market.fetch(marketPda);
  const collateralMint: PublicKey = market.collateralMint;
  console.log(`Collateral mint: ${collateralMint.toBase58()}`);

  // Get or create recipient's ATA
  console.log(`Getting/creating ATA for ${recipientPubkey.toBase58()}...`);
  const recipientAta = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,        // payer
    collateralMint,
    recipientPubkey
  );

  // Mint
  console.log(`Minting ${usdcAmount} USDC (${rawAmount} raw) → ${recipientAta.address.toBase58()}...`);
  const sig = await mintTo(
    connection,
    walletKeypair,         // payer
    collateralMint,
    recipientAta.address,
    walletKeypair,         // mint authority (must be the deployer wallet)
    BigInt(rawAmount)
  );

  console.log(`\nSuccess! Minted ${usdcAmount} mock USDC`);
  console.log(`  Recipient: ${recipientPubkey.toBase58()}`);
  console.log(`  ATA:       ${recipientAta.address.toBase58()}`);
  console.log(`  Sig:       ${sig}`);
  console.log(`  Explorer:  https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

main().catch((err) => {
  console.error("Faucet error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
