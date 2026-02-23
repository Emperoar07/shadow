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
import { resolveRpcEndpoint } from "./rpc";

const ARCIUM_PROGRAM_ID = getArciumProgramId();
const ARCIUM_CLUSTER_OFFSET = 456;
const ARCIUM_CLUSTER_ACCOUNT = getClusterAccAddress(ARCIUM_CLUSTER_OFFSET);
const CANONICAL_DEVNET_USDC = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

function resolveAnchorBin(): string {
  const explicit = process.env.ANCHOR_BIN;
  if (explicit) return explicit;

  const localExe = path.resolve(__dirname, "..", ".tools", "anchor-0.32.1.exe");
  if (process.platform === "win32" && fs.existsSync(localExe)) {
    return localExe;
  }

  return "anchor";
}

function resolveSolanaBin(): string {
  const explicit = process.env.SOLANA_BIN;
  if (explicit) return explicit;

  const localExe = path.resolve(
    __dirname,
    "..",
    ".tools",
    "solana-v2.3.13-extracted",
    "solana-release",
    "bin",
    "solana.exe"
  );
  if (process.platform === "win32" && fs.existsSync(localExe)) {
    return localExe;
  }

  return "solana";
}

function readProgramIdFromKeypair(programKeypairPath: string): PublicKey | null {
  if (!fs.existsSync(programKeypairPath)) {
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(programKeypairPath, "utf-8"));
  const keypair = Keypair.fromSecretKey(new Uint8Array(raw));
  return keypair.publicKey;
}

function readProgramIdFromIdl(idlPath: string): PublicKey | null {
  if (!fs.existsSync(idlPath)) {
    return null;
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8")) as { address?: string };
  if (!idl.address) return null;
  return new PublicKey(idl.address);
}

function rotateProgramKeypairForFreshNamespace(
  keypairPath: string,
  anchorBin: string,
  rootDir: string
): PublicKey {
  fs.mkdirSync(path.dirname(keypairPath), { recursive: true });
  if (fs.existsSync(keypairPath)) {
    const backupDir = path.resolve(rootDir, "target", "deploy", "backup");
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `shadowperp-keypair.${stamp}.json`);
    fs.copyFileSync(keypairPath, backupPath);
    console.log(`Backed up previous program keypair -> ${backupPath}`);
  }

  const keypair = Keypair.generate();
  fs.writeFileSync(keypairPath, JSON.stringify(Array.from(keypair.secretKey)));
  console.log("Generated fresh program keypair:", keypair.publicKey.toBase58());

  execSync(`"${anchorBin}" keys sync`, {
    cwd: rootDir,
    stdio: "inherit",
  });
  console.log("Synced program IDs via `anchor keys sync`.");
  return keypair.publicKey;
}

async function main() {
  console.log("\n=== ShadowPerp Devnet Deployment ===\n");
  const rootDir = path.resolve(__dirname, "..");
  const anchorBin = resolveAnchorBin();
  const solanaBin = resolveSolanaBin();
  const rpcOverride = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  const rpcSelection = await resolveRpcEndpoint({ preferred: rpcOverride, commitment: "confirmed" });
  const rpcUrl = rpcSelection.rpcUrl;
  const useMockCollateral =
    process.argv.includes("--mock-collateral") ||
    process.env.USE_MOCK_COLLATERAL === "1";
  const skipDeploy =
    process.argv.includes("--skip-deploy") ||
    process.env.SKIP_ANCHOR_DEPLOY === "1";
  const freshNamespace =
    process.argv.includes("--fresh-namespace") ||
    process.env.FRESH_NAMESPACE === "1";
  console.log("Anchor binary:", anchorBin);
  console.log(
    "Collateral mode:",
    useMockCollateral ? "mock mint (local authority)" : "canonical devnet USDC"
  );
  console.log("Anchor deploy step:", skipDeploy ? "skipped" : "enabled");
  console.log("Fresh namespace:", freshNamespace ? "enabled" : "disabled");
  console.log("RPC URL:", rpcUrl);
  if (rpcSelection.attempts.length > 1) {
    console.log("RPC failover attempts:");
    for (const attempt of rpcSelection.attempts) {
      console.log(`  - ${attempt.url} :: ${attempt.ok ? "ok" : `failed (${attempt.error})`}`);
    }
  }

  // 1. Build check (assume anchor build already ran in CI)
  console.log("Step 1: Checking build artifacts...");
  const soPath = path.resolve(rootDir, "target", "deploy", "shadowperp.so");
  const keypairPath = path.resolve(
    rootDir,
    "target",
    "deploy",
    "shadowperp-keypair.json"
  );
  const targetIdlPath = path.resolve(
    rootDir,
    "target",
    "idl",
    "shadowperp.json"
  );

  if (freshNamespace) {
    console.log("Step 1a: Rotating to fresh program namespace...");
    rotateProgramKeypairForFreshNamespace(keypairPath, anchorBin, rootDir);
  }

  const keypairProgramId = readProgramIdFromKeypair(keypairPath);
  const idlProgramId = readProgramIdFromIdl(targetIdlPath);
  const needsBuild =
    freshNamespace ||
    !fs.existsSync(soPath) ||
    !keypairProgramId ||
    !idlProgramId ||
    !idlProgramId.equals(keypairProgramId);

  if (needsBuild) {
    console.log("Build artifacts missing/stale, running anchor build...");
    try {
      execSync(`"${anchorBin}" build`, {
        cwd: rootDir,
        stdio: "inherit",
      });
    } catch {
      console.error("ERROR: `anchor build` failed.");
      process.exit(1);
    }
  } else {
    console.log("Build artifacts are up to date, skipping build.");
  }

  // 2. Deploy to devnet
  if (!skipDeploy) {
    console.log("\nStep 2: Deploying to devnet...");
    try {
      execSync(`"${anchorBin}" deploy --provider.cluster ${rpcUrl}`, {
        cwd: rootDir,
        stdio: "inherit",
      });
    } catch (anchorErr: any) {
      console.warn(
        `Anchor deploy failed (${String(anchorErr?.message || anchorErr).split("\n")[0]}). ` +
          "Falling back to direct solana program deploy over RPC..."
      );
      try {
        execSync(
          `"${solanaBin}" program deploy target/deploy/shadowperp.so --program-id target/deploy/shadowperp-keypair.json --url ${rpcUrl} --use-rpc --max-sign-attempts 12`,
          {
            cwd: rootDir,
            stdio: "inherit",
          }
        );
      } catch {
        console.error("ERROR: Deployment failed in both anchor and solana fallback modes.");
        console.error("Ensure deploy wallet has enough devnet SOL and RPC is not rate limited.");
        process.exit(1);
      }
    }
  } else {
    console.log("\nStep 2: Skipping program deploy (--skip-deploy)");
  }

  // Read the deployed program ID from Anchor keypair
  const programKeypairPath = keypairPath;
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
  const connection = new Connection(rpcUrl, "confirmed");
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

  // 4. Resolve collateral mint
  console.log("\nStep 3: Resolving collateral mint...");
  let collateralMint = CANONICAL_DEVNET_USDC;
  if (useMockCollateral) {
    collateralMint = await createMint(
      connection,
      walletKeypair,
      walletKeypair.publicKey,
      null,
      6 // USDC decimals
    );
    console.log("Mock USDC mint:", collateralMint.toBase58());
  } else {
    console.log("Using canonical devnet USDC:", collateralMint.toBase58());
  }

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
  const [signPdaAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("ArciumSignerAccount")],
    PROGRAM_ID
  );

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

  // 7. Initialize local Arcium signer PDA used by queue_computation
  console.log("\nStep 5: Initializing Arcium signer PDA...");
  try {
    await program.methods
      .initArciumSigner()
      .accounts({
        payer: walletKeypair.publicKey,
        signPdaAccount,
      })
      .rpc();
    console.log("Arcium signer PDA initialized:", signPdaAccount.toBase58());
  } catch (e: any) {
    if (e.message?.includes("already in use")) {
      console.log("Arcium signer PDA already initialized:", signPdaAccount.toBase58());
    } else {
      throw e;
    }
  }

  // 8. Initialize Arcium computation definitions
  console.log("\nStep 6: Initializing Arcium computation definitions...");
  try {
    execSync(
      `npx --yes ts-node scripts/init-comp-defs.ts --program ${PROGRAM_ID.toBase58()} --market ${marketPda.toBase58()} --rpc ${connection.rpcEndpoint} --arcium-program ${ARCIUM_PROGRAM_ID.toBase58()} --mxe-program ${PROGRAM_ID.toBase58()} --cluster-offset ${ARCIUM_CLUSTER_OFFSET}`,
      {
        cwd: rootDir,
        stdio: "inherit",
      }
    );
  } catch {
    console.error("ERROR: Failed to initialize Arcium computation definitions.");
    process.exit(1);
  }

  // 9. Set initial oracle price (SOL ~$103)
  console.log("\nStep 7: Setting initial oracle price...");
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

  // 10. Optionally mint test USDC (mock-only)
  if (useMockCollateral) {
    console.log("\nStep 8: Minting test USDC...");
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
  } else {
    console.log("\nStep 8: Skipping mint (canonical devnet USDC has external faucet/swap routes).");
  }

  // 11. Write .env.local
  console.log("\nStep 9: Writing app/.env.local...");
  const envContent = `NEXT_PUBLIC_SOLANA_RPC_URL=${rpcUrl}
NEXT_PUBLIC_ARCIUM_RPC_URL=https://devnet.helius-rpc.com

# ShadowPerp program (deployed to devnet - matches Anchor.toml [programs.devnet])
NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID=${PROGRAM_ID.toBase58()}

# Arcium network accounts (devnet)
# NEXT_PUBLIC_ARCIUM_MXE_PROGRAM_ID is the MXE PDA namespace (ShadowPerp program ID in this repo).
# getMXEAccAddress/getArciumMXEPublicKey derive the MXE PDA from this program id.
NEXT_PUBLIC_ARCIUM_PROGRAM_ID=${ARCIUM_PROGRAM_ID.toBase58()}
NEXT_PUBLIC_ARCIUM_MXE_PROGRAM_ID=${PROGRAM_ID.toBase58()}
NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET=${ARCIUM_CLUSTER_OFFSET}
NEXT_PUBLIC_ARCIUM_CLUSTER_ACCOUNT=${ARCIUM_CLUSTER_ACCOUNT.toBase58()}

# Market account (PDA of the initialize instruction)
NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT=${marketPda.toBase58()}
`;

  fs.writeFileSync(path.resolve(rootDir, "app", ".env.local"), envContent);
  console.log("Written to app/.env.local");

  // 11. Sync latest IDL for frontend/runtime
  const appIdlPath = path.resolve(rootDir, "app", "src", "idl", "shadowperp.json");
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
