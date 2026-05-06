/**
 * Initialize on-chain market PDAs for all trading pairs defined in tokens.ts.
 *
 * Each pair gets its own market PDA seeded by:
 *   [b"market", collateral_mint, base_asset_mint]
 *
 * Safe to re-run — skips pairs whose market account already exists.
 *
 * Usage:
 *   npx ts-node scripts/init-markets.ts
 *   npx ts-node scripts/init-markets.ts --rpc <URL>
 */
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getClusterAccAddress } from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveRpcEndpoint } from "./rpc";
import { TRADING_PAIRS } from "../app/src/lib/tokens";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ||
    "34wszdEvGvyAVADY7ozpbdAvAB9zHRBTaT1YsNcpRJdo"
);
const COLLATERAL_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_MOCKUSDC_MINT ||
  process.env.NEXT_PUBLIC_SHADOWPERP_COLLATERAL_MINT ||
    "DbF1Z21WCTbcx5feBB9LNkhtqRE99DZt9ENJT79prHc6"
);
const ARCIUM_CLUSTER_OFFSET = Number(
  process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET || "456"
);
const MXE_CLUSTER = getClusterAccAddress(ARCIUM_CLUSTER_OFFSET);

// Market params — match the existing SOL-USD market
const MAX_LEVERAGE = 50;
const LIQUIDATION_THRESHOLD = 500; // 5% in bps
const TRADING_FEE = 10; // 0.1% in bps

function resolveWalletPath(): string {
  const env = process.env.SOLANA_WALLET;
  if (env && fs.existsSync(env)) return env;
  const def = path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(def)) throw new Error(`Wallet not found: ${def}`);
  return def;
}

function fetchLocalIdl(): any {
  const paths = [
    path.resolve(process.cwd(), "target", "idl", "shadowperp.json"),
    path.resolve(process.cwd(), "app", "src", "idl", "shadowperp.json"),
  ];
  const found = paths.find((p) => fs.existsSync(p));
  if (!found) throw new Error("IDL not found");
  const idl = JSON.parse(fs.readFileSync(found, "utf8"));
  idl.address = PROGRAM_ID.toBase58();
  return idl;
}

function deriveMarketPda(baseAssetMint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), COLLATERAL_MINT.toBuffer(), baseAssetMint.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

async function main() {
  const rpcArg =
    process.argv.find((a) => a.startsWith("--rpc="))?.split("=")[1] ||
    (process.argv.includes("--rpc")
      ? process.argv[process.argv.indexOf("--rpc") + 1]
      : undefined) ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL;

  const rpcSelection = await resolveRpcEndpoint({
    preferred: rpcArg,
    commitment: "confirmed",
  });

  const walletPath = resolveWalletPath();
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
  const connection = new Connection(rpcSelection.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const idl = fetchLocalIdl();
  const program = new anchor.Program(idl as anchor.Idl, provider);

  console.log(`RPC:     ${rpcSelection.rpcUrl}`);
  console.log(`Wallet:  ${walletKeypair.publicKey.toBase58()}`);
  console.log(`Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`Collateral mint (USDC): ${COLLATERAL_MINT.toBase58()}`);
  console.log(`\nInitializing ${TRADING_PAIRS.length} market(s)...\n`);

  for (const pair of TRADING_PAIRS) {
    const baseAssetMint = pair.base.mint;
    const marketPda = deriveMarketPda(baseAssetMint);

    process.stdout.write(`[${pair.label}] market=${marketPda.toBase58()} ... `);

    // Check if already exists
    const existing = await connection.getAccountInfo(marketPda);
    if (existing !== null) {
      console.log("already exists, skipping");
      continue;
    }

    try {
      // Derive shared collateral vault + authority PDAs
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("shared_vault"), COLLATERAL_MINT.toBuffer()],
        PROGRAM_ID
      );
      const [sharedVaultAuthorityPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("shared_vault_authority"), COLLATERAL_MINT.toBuffer()],
        PROGRAM_ID
      );

      const tx = await (program.methods as any)
        .initialize(
          MAX_LEVERAGE,
          LIQUIDATION_THRESHOLD,
          TRADING_FEE,
          pair.pythFeedId
        )
        .accounts({
          authority: walletKeypair.publicKey,
          market: marketPda,
          collateralMint: COLLATERAL_MINT,
          baseAssetMint,
          vault: vaultPda,
          sharedVaultAuthority: sharedVaultAuthorityPda,
          priceFeeder: walletKeypair.publicKey,
          mxeCluster: MXE_CLUSTER,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc({ commitment: "confirmed" });

      console.log(`initialized  tx=${tx.slice(0, 16)}...`);
    } catch (err: any) {
      const msg = String(err?.message || err);
      // Anchor returns 0x0 when the account already exists (init constraint fails)
      if (msg.includes("custom program error: 0x0")) {
        console.log("already initialized");
      } else {
        console.error(`FAILED: ${msg.split("\n")[0]}`);
      }
    }
  }

  console.log("\nDone. Market PDAs:");
  for (const pair of TRADING_PAIRS) {
    const pda = deriveMarketPda(pair.base.mint);
    console.log(`  ${pair.label.padEnd(12)} ${pda.toBase58()}`);
  }
}

main().catch((err) => {
  console.error("init-markets failed:", err);
  process.exit(1);
});
