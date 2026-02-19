/**
 * ShadowPerp Devnet Deployment Script
 *
 * Prerequisites:
 *   1. Install Rust + Solana CLI + Anchor CLI
 *   2. Configure Solana CLI for devnet: `solana config set --url devnet`
 *   3. Create a keypair: `solana-keygen new` (or use existing ~/.config/solana/id.json)
 *   4. Airdrop SOL: `solana airdrop 5`
 *
 * Usage:
 *   npx ts-node scripts/deploy-devnet.ts
 *
 * What this script does:
 *   1. Builds the Anchor program
 *   2. Deploys to devnet
 *   3. Creates a mock USDC mint
 *   4. Initializes the ShadowPerp market
 *   5. Initializes Arcium computation definitions
 *   6. Sets the initial oracle price
 *   7. Writes all addresses to app/.env.local
 *   8. Syncs latest IDL into app/src/idl/shadowperp.json
 */

import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Connection,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { getArciumProgramId, getClusterAccAddress } from "@arcium-hq/client";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const ARCIUM_PROGRAM_ID = getArciumProgramId();
const ARCIUM_CLUSTER_OFFSET = 456;
const ARCIUM_CLUSTER_ACCOUNT = getClusterAccAddress(ARCIUM_CLUSTER_OFFSET);

async function main() {
  console.log("\n=== ShadowPerp Devnet Deployment ===\n");

  // 1. Build check (assume anchor build already ran in CI)
  console.log("Step 1: Checking build artifacts...");
  const soPath = path.resolve(__dirname, "..", "target", "deploy", "shadowperp.so");
  if (!fs.existsSync(soPath)) {
    console.log("No build artifacts found, running anchor build...");
    try {
      execSync("anchor build", { cwd: path.resolve(__dirname, ".."), stdio: "inherit" });
    } catch {
      console.error("ERROR: `anchor build` failed.");
      process.exit(1);
    }
  } else {
    console.log("Build artifacts found, skipping build.");
  }

  // 2. Deploy to devnet
  console.log("\nStep 2: Deploying to devnet...");
  try {
    execSync("anchor deploy --provider.cluster devnet", {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
    });
  } catch {
    console.error("ERROR: Deployment failed. Ensure you have devnet SOL:");
    console.error("  solana config set --url devnet");
    console.error("  solana airdrop 5");
    process.exit(1);
  }

  // Read the deployed program ID from Anchor keypair
  const programKeypairPath = path.resolve(
    __dirname,
    "..",
    "target",
    "deploy",
    "shadowperp-keypair.json"
  );
  if (!fs.existsSync(programKeypairPath)) {
    console.error("ERROR: Program keypair not found at", programKeypairPath);
    process.exit(1);
  }
  const programKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(programKeypairPath, "utf-8")))
  );
  const PROGRAM_ID = programKeypair.publicKey;
  console.log("Program deployed:", PROGRAM_ID.toBase58());

  // 3. Connect and set up provider
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const walletKeypairPath =
    process.env.SOLANA_WALLET || path.resolve(process.env.HOME || "~", ".config", "solana", "id.json");
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletKeypairPath, "utf-8")))
  );
  console.log("Deployer wallet:", walletKeypair.publicKey.toBase58());

  // Check SOL balance
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log("SOL balance:", balance / LAMPORTS_PER_SOL);
  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.log("Airdropping SOL...");
    const sig = await connection.requestAirdrop(walletKeypair.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
  }

  // 4. Create mock USDC mint
  console.log("\nStep 3: Creating mock USDC mint...");
  const collateralMint = await createMint(
    connection,
    walletKeypair,
    walletKeypair.publicKey,
    null,
    6 // USDC decimals
  );
  console.log("Mock USDC mint:", collateralMint.toBase58());

  // 5. Derive market PDA
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), collateralMint.toBuffer()],
    PROGRAM_ID
  );
  console.log("Market PDA:", marketPda.toBase58());

  // 6. Initialize the market
  console.log("\nStep 4: Initializing market...");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  const idlPath = path.resolve(__dirname, "..", "target", "idl", "shadowperp.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  (idl as { address?: string }).address = PROGRAM_ID.toBase58();
  const program = new anchor.Program(idl as anchor.Idl, provider);

  const priceFeeder = walletKeypair; // deployer is also price feeder for devnet

  try {
    await program.methods
      .initialize(50, 500, 10) // 50x max leverage, 5% liq threshold, 0.1% fee
      .accounts({
        authority: walletKeypair.publicKey,
        collateralMint,
        priceFeeder: priceFeeder.publicKey,
        mxeCluster: ARCIUM_CLUSTER_ACCOUNT,
      })
      .rpc();
    console.log("Market initialized successfully");
  } catch (e: any) {
    if (e.message?.includes("already in use")) {
      console.log("Market already initialized");
    } else {
      throw e;
    }
  }

  // 7. Set initial oracle price (SOL ~$103)
  console.log("\nStep 5: Initializing Arcium computation definitions...");
  try {
    execSync(
      `npx --yes ts-node scripts/init-comp-defs.ts --program ${PROGRAM_ID.toBase58()} --market ${marketPda.toBase58()} --rpc ${connection.rpcEndpoint} --arcium-program ${ARCIUM_PROGRAM_ID.toBase58()} --mxe-program ${ARCIUM_PROGRAM_ID.toBase58()} --cluster-offset ${ARCIUM_CLUSTER_OFFSET}`,
      {
        cwd: path.resolve(__dirname, ".."),
        stdio: "inherit",
      }
    );
  } catch {
    console.error("ERROR: Failed to initialize Arcium computation definitions.");
    process.exit(1);
  }

  // 8. Set initial oracle price (SOL ~$103)
  console.log("\nStep 6: Setting initial oracle price...");
  try {
    await program.methods
      .updatePrice(new anchor.BN(103_000_000)) // $103.00 in 1e6 scale
      .accounts({
        priceFeeder: priceFeeder.publicKey,
        market: marketPda,
      })
      .signers([priceFeeder])
      .rpc();
    console.log("Oracle price set to $103.00");
  } catch (e: any) {
    console.error("Failed to set price:", e.message);
  }

  // 9. Mint some test USDC to deployer
  console.log("\nStep 7: Minting test USDC...");
  const deployerAta = await getOrCreateAssociatedTokenAccount(
    connection,
    walletKeypair,
    collateralMint,
    walletKeypair.publicKey
  );
  await mintTo(
    connection,
    walletKeypair,
    collateralMint,
    deployerAta.address,
    walletKeypair,
    10_000_000_000 // 10,000 USDC
  );
  console.log("Minted 10,000 USDC to deployer");

  // 10. Write .env.local
  console.log("\nStep 8: Writing app/.env.local...");
  const envContent = `NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_ARCIUM_RPC_URL=https://devnet.helius-rpc.com

# ShadowPerp program (deployed to devnet - matches Anchor.toml [programs.devnet])
NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID=${PROGRAM_ID.toBase58()}

# Arcium network accounts (devnet)
# NEXT_PUBLIC_ARCIUM_MXE_PROGRAM_ID is the Arcium runtime program, NOT your ShadowPerp program.
# getMXEAccAddress/getArciumMXEPublicKey derive the MXE PDA from this program.
NEXT_PUBLIC_ARCIUM_PROGRAM_ID=${ARCIUM_PROGRAM_ID.toBase58()}
NEXT_PUBLIC_ARCIUM_MXE_PROGRAM_ID=${ARCIUM_PROGRAM_ID.toBase58()}
NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET=${ARCIUM_CLUSTER_OFFSET}
NEXT_PUBLIC_ARCIUM_CLUSTER_ACCOUNT=${ARCIUM_CLUSTER_ACCOUNT.toBase58()}

# Market account (PDA of the initialize instruction)
NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT=${marketPda.toBase58()}
`;

  fs.writeFileSync(path.resolve(__dirname, "..", "app", ".env.local"), envContent);
  console.log("Written to app/.env.local");

  // 11. Sync latest IDL for frontend/runtime
  const appIdlPath = path.resolve(__dirname, "..", "app", "src", "idl", "shadowperp.json");
  fs.copyFileSync(idlPath, appIdlPath);
  console.log("Synced IDL to app/src/idl/shadowperp.json");

  // Summary
  console.log("\n=== Deployment Complete ===\n");
  console.log("Program ID:     ", PROGRAM_ID.toBase58());
  console.log("Market:         ", marketPda.toBase58());
  console.log("Collateral Mint:", collateralMint.toBase58());
  console.log("Price Feeder:   ", priceFeeder.publicKey.toBase58());
  console.log("\nNext steps:");
  console.log("  1. cd app && pnpm dev");
  console.log("  2. Connect wallet (Phantom/Solflare) on devnet");
  console.log("  3. Get devnet USDC from the mock mint above");
  console.log("  4. Deposit collateral and open positions!");
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
