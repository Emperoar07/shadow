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
import {
  awaitComputationFinalization,
  getArciumProgramId,
  getClusterAccAddress,
  getComputationAccAddress,
  getClockAccAddress,
  getExecutingPoolAccAddress,
  getFeePoolAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
} from "@arcium-hq/client";
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

function toWslPath(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!match) return normalized;
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

function buildAnchorEnv(rootDir: string) {
  const solanaBin = path.resolve(
    rootDir,
    ".tools",
    "solana-v2.3.13-extracted",
    "solana-release",
    "bin"
  );
  const wrapperDir = path.resolve(rootDir, "scripts");
  const sbfSdk = path.join(solanaBin, "platform-tools-sdk", "sbf");

  return {
    ...process.env,
    HOME: process.env.USERPROFILE || process.env.HOME,
    PATH: `${wrapperDir};${solanaBin};${process.env.PATH || ""}`,
    SBF_SDK_PATH: sbfSdk,
  };
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

function readConfiguredDevnetProgramId(rootDir: string): PublicKey | null {
  const anchorTomlPath = path.resolve(rootDir, "Anchor.toml");
  if (!fs.existsSync(anchorTomlPath)) {
    return null;
  }
  const anchorToml = fs.readFileSync(anchorTomlPath, "utf-8");
  const match = anchorToml.match(
    /\[programs\.devnet\][\s\S]*?shadowperp\s*=\s*"([^"]+)"/
  );
  return match ? new PublicKey(match[1]) : null;
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
    env: buildAnchorEnv(rootDir),
  });
  const arciumTomlPath = path.resolve(rootDir, "Arcium.toml");
  if (fs.existsSync(arciumTomlPath)) {
    const arciumToml = fs.readFileSync(arciumTomlPath, "utf-8");
    const nextProgramId = keypair.publicKey.toBase58();
    const nextClusterOffset = String(ARCIUM_CLUSTER_OFFSET);
    const updatedArciumToml = arciumToml
      .replace(/program_id = "[^"]*"/, `program_id = "${nextProgramId}"`)
      .replace(/cluster_offset = \d+/, `cluster_offset = ${nextClusterOffset}`);
    if (updatedArciumToml !== arciumToml) {
      fs.writeFileSync(arciumTomlPath, updatedArciumToml);
      console.log("Synced Arcium.toml MXE metadata.");
    }
  }
  console.log("Synced program IDs via `anchor keys sync`.");
  return keypair.publicKey;
}

async function main() {
  console.log("\n=== ShadowPerp Devnet Deployment ===\n");
  const rootDir = path.resolve(__dirname, "..");
  const anchorBin = resolveAnchorBin();
  const solanaBin = resolveSolanaBin();
  const anchorEnv = buildAnchorEnv(rootDir);
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
  const useWslBuild =
    process.platform === "win32" &&
    process.env.USE_WSL_BUILD !== "0" &&
    fs.existsSync(path.resolve(rootDir, "scripts", "wsl-anchor-build.sh"));
  console.log("Anchor binary:", anchorBin);
  console.log(
    "Collateral mode:",
    useMockCollateral ? "mock mint (local authority)" : "canonical devnet USDC"
  );
  console.log("Anchor deploy step:", skipDeploy ? "skipped" : "enabled");
  console.log("Fresh namespace:", freshNamespace ? "enabled" : "disabled");
  console.log("WSL build lane:", useWslBuild ? "enabled" : "disabled");
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
  const configuredProgramId = readConfiguredDevnetProgramId(rootDir);
  const needsBuild =
    freshNamespace ||
    !fs.existsSync(soPath) ||
    !keypairProgramId ||
    !idlProgramId ||
    !idlProgramId.equals(keypairProgramId);

  if (needsBuild) {
    console.log("Build artifacts missing/stale, running anchor build...");
    try {
      if (useWslBuild) {
        const repoWslPath = toWslPath(rootDir);
        execSync(`wsl bash -lc "cd '${repoWslPath}' && bash scripts/wsl-anchor-build.sh"`, {
          cwd: rootDir,
          stdio: "inherit",
          env: process.env,
        });
      } else {
        execSync(`"${anchorBin}" build -- --skip-tools-install`, {
          cwd: rootDir,
          stdio: "inherit",
          env: anchorEnv,
        });
      }
    } catch {
      console.error("ERROR: `anchor build` failed.");
      process.exit(1);
    }
  } else {
    console.log("Build artifacts are up to date, skipping build.");
  }

  // 1b. Pre-deploy: reclaim stale buffers and ensure sufficient SOL
  const useWslDeploy =
    process.platform === "win32" &&
    process.env.USE_WSL_DEPLOY !== "0";
  const solanaBinWsl = "$HOME/.local/share/solana-2.3.13/active_release/bin";
  const walletPath = process.env.SOLANA_WALLET || path.resolve(process.env.HOME || process.env.USERPROFILE || "~", ".config", "solana", "id.json");
  const walletWsl = toWslPath(walletPath);

  if (!skipDeploy) {
    // Reclaim any stale deploy buffers from previous failed attempts
    console.log("\nStep 1b: Reclaiming stale deploy buffers...");
    try {
      const wslSolana = `${solanaBinWsl}/solana`;
      const buffersCmd = `${wslSolana} program show --buffers --keypair '${walletWsl}' --url '${rpcUrl}' --output json`;
      const buffersOut = execSync(
        useWslDeploy
          ? `wsl bash -c "${buffersCmd.replace(/"/g, '\\"')}"`
          : `"${solanaBin}" program show --buffers --url ${rpcUrl} --output json`,
        { cwd: rootDir, env: process.env, encoding: "utf-8" }
      ).trim();
      if (buffersOut) {
        const buffers = JSON.parse(buffersOut) as Array<{ address: string; lamports: number }>;
        for (const buf of buffers) {
          console.log(`  Closing buffer ${buf.address} (${(buf.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL)...`);
          try {
            const closeCmd = `${wslSolana} program close ${buf.address} --keypair '${walletWsl}' --url '${rpcUrl}'`;
            execSync(
              useWslDeploy
                ? `wsl bash -c "${closeCmd.replace(/"/g, '\\"')}"`
                : `"${solanaBin}" program close ${buf.address} --url ${rpcUrl}`,
              { cwd: rootDir, stdio: "inherit", env: process.env }
            );
          } catch {
            console.warn(`  Warning: failed to close buffer ${buf.address}, continuing...`);
          }
        }
      }
    } catch {
      console.log("  No stale buffers found (or unable to query).");
    }

    // Check balance and airdrop if needed (deploy needs ~8 SOL for buffer)
    const DEPLOY_MIN_SOL = 10;
    const preDeployConnection = new Connection(rpcUrl, "confirmed");
    const walletKeypairForBalance = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
    );
    const preBal = await preDeployConnection.getBalance(walletKeypairForBalance.publicKey);
    const preBalSol = preBal / LAMPORTS_PER_SOL;
    console.log(`  Deploy wallet balance: ${preBalSol.toFixed(4)} SOL (need ~${DEPLOY_MIN_SOL})`);
    if (preBalSol < DEPLOY_MIN_SOL) {
      const needed = Math.ceil(DEPLOY_MIN_SOL - preBalSol);
      console.log(`  Airdropping ${needed} SOL in 2-SOL batches...`);
      for (let i = 0; i < needed; i += 2) {
        const amount = Math.min(2, needed - i);
        try {
          const sig = await preDeployConnection.requestAirdrop(
            walletKeypairForBalance.publicKey,
            amount * LAMPORTS_PER_SOL
          );
          await preDeployConnection.confirmTransaction(sig);
          console.log(`  Airdropped ${amount} SOL`);
        } catch (e: any) {
          console.warn(`  Airdrop failed: ${e.message || e}. You may need to fund manually.`);
          break;
        }
      }
      const postBal = await preDeployConnection.getBalance(walletKeypairForBalance.publicKey);
      console.log(`  Post-airdrop balance: ${(postBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    }
  }

  // 2. Deploy to devnet
  if (!skipDeploy) {
    console.log("\nStep 2: Deploying to devnet...");
    console.log("Deploy lane:", useWslDeploy ? "WSL" : "Windows");
    const useConfiguredUpgradePath =
      !freshNamespace &&
      Boolean(configuredProgramId) &&
      (!keypairProgramId || !configuredProgramId!.equals(keypairProgramId));

    if (useConfiguredUpgradePath) {
      console.log(
        "Deploy target is the configured devnet program id from Anchor.toml:",
        configuredProgramId!.toBase58()
      );
      try {
        execSync(
          [
            `"${anchorBin}" upgrade`,
            `--program-id ${configuredProgramId!.toBase58()}`,
            `--provider.cluster devnet`,
            `--provider.wallet "${walletPath}"`,
            `"${soPath}"`,
            `-- --use-rpc --with-compute-unit-price 10000 --max-sign-attempts 100`,
          ].join(" "),
          {
            cwd: rootDir,
            stdio: "inherit",
            env: anchorEnv,
          }
        );
      } catch {
        console.error("ERROR: Anchor upgrade failed against configured devnet program id.");
        process.exit(1);
      }
    } else if (useWslDeploy) {
      // Deploy from WSL using the clean Solana 2.3.13 lane — avoids Windows
      // networking issues that cause AlreadyProcessed / write failures.
      const repoWsl = toWslPath(rootDir);
      const soPathWsl = toWslPath(soPath);
      const keypairPathWsl = toWslPath(keypairPath);
      const deployCmdLine = [
        `${solanaBinWsl}/solana program deploy '${soPathWsl}'`,
        `--program-id '${keypairPathWsl}'`,
        `--keypair '${walletWsl}'`,
        `--url '${rpcUrl}'`,
        `--use-rpc`,
        `--with-compute-unit-price 10000`,
        `--max-sign-attempts 100`,
      ].join(" ");
      const wslDeployCmd = `cd '${repoWsl}' && ${deployCmdLine}`;

      try {
        execSync(`wsl bash -c "${wslDeployCmd.replace(/"/g, '\\"')}"`, {
          cwd: rootDir,
          stdio: "inherit",
          env: process.env,
        });
      } catch {
        console.error("ERROR: WSL deploy failed.");
        console.error("Check buffer status: wsl bash -c 'solana program show --buffers --url devnet'");
        process.exit(1);
      }
    } else {
      // Windows deploy lane — use solana.exe directly (skip anchor deploy which
      // has toolchain issues on this machine)
      try {
        execSync(
          `"${solanaBin}" program deploy target/deploy/shadowperp.so --program-id target/deploy/shadowperp-keypair.json --url ${rpcUrl} --use-rpc --with-compute-unit-price 10000 --max-sign-attempts 100`,
          {
            cwd: rootDir,
            stdio: "inherit",
            env: anchorEnv,
          }
        );
      } catch {
        console.error("ERROR: Windows deploy failed.");
        console.error("Check buffer status with: solana program show --buffers --url devnet");
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
  const PROGRAM_ID =
    !freshNamespace && configuredProgramId ? configuredProgramId : programKeypair.publicKey;
  console.log("Program deployed:", PROGRAM_ID.toBase58());

  console.log("Step 2a: Verifying deployed program is visible on RPC...");
  let deployVisible = false;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const accountInfo = await new Connection(rpcUrl, "confirmed").getAccountInfo(PROGRAM_ID);
      if (accountInfo?.executable) {
        deployVisible = true;
        break;
      }
    } catch {
      // Retry after a short delay if the selected RPC has not caught up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  if (!deployVisible) {
    console.error(
      `ERROR: Expected deployed program ${PROGRAM_ID.toBase58()} is not visible on ${rpcUrl}.`
    );
    console.error(
      "Stopping before market initialization to avoid writing state against the wrong program id."
    );
    process.exit(1);
  }

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

  // SOL mint — base asset for the SOL-USD market
  const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
  // Pyth SOL/USD feed ID (devnet + mainnet)
  const SOL_USD_PYTH_FEED_ID =
    "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

  // 5. Derive market PDA (includes base_asset_mint in seed since multi-market refactor)
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), collateralMint.toBuffer(), SOL_MINT.toBuffer()],
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
      .initialize(50, 500, 10, SOL_USD_PYTH_FEED_ID) // 50x max leverage, 5% liq threshold, 0.1% fee
      .accounts({
        authority: walletKeypair.publicKey,
        collateralMint,
        baseAssetMint: SOL_MINT,
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

  // 9. Skip encrypted OI seeding.
  // Aggregate OI is no longer maintained through Arcium because MXE-owned
  // OI ciphertext creation is the observed abort source on devnet.
  console.log("\nStep 7: Skipping encrypted OI seed.");

  // 10. Set initial oracle price (SOL ~$103)
  console.log("\nStep 8: Setting initial oracle price...");
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

  // 11. Optionally mint test USDC (mock-only)
  if (useMockCollateral) {
    console.log("\nStep 9: Minting test USDC...");
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
    console.log("\nStep 9: Skipping mint (canonical devnet USDC has external faucet/swap routes).");
  }

  // 12. Write .env.local
  console.log("\nStep 10: Writing app/.env.local...");
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
  console.log("  1. cd app && npm run dev");
  console.log("  2. Connect wallet (Phantom/Solflare) on devnet");
  console.log("  3. Get devnet USDC from the mock mint above");
  console.log("  4. Deposit collateral and open positions!");
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
