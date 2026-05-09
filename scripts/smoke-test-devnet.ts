/**
 * Devnet smoke test for ShadowPerp.
 *
 * Checks on-chain state (market, comp-defs, oracle) and optionally
 * attempts a full open-position → callback → close-position cycle.
 *
 * Usage:
 *   npx ts-node scripts/smoke-test-devnet.ts --rpc <url>
 *   npx ts-node scripts/smoke-test-devnet.ts --rpc <url> --trade   # also open+close a position
 */

import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount as getTokenAccount,
} from "@solana/spl-token";
import {
  RescueCipher,
  getComputationAccAddress,
  getClockAccAddress,
  getClusterAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getFeePoolAccAddress,
  getMXEAccAddress,
  getMXEPublicKey as getArciumMXEPublicKey,
  getCompDefAccAddress,
  getCompDefAccOffset,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveRpcEndpoint } from "./rpc";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_PROGRAM_ID = "DBshVTiQcB76wVpS6tLuSXuECZJ6LjqPQajxhEaCyDSD";
const DEFAULT_MARKET_ACCOUNT = "AwiH92K4RxfhoHpmkiQrwZEBi1ia93x1WrK4uoEchLBJ";
const DEFAULT_ARCIUM_PROGRAM_ID = "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ";
const DEFAULT_CLUSTER_OFFSET = 456;

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.resolve(__dirname, "..", "app", ".env.local"));

const PROGRAM_ID = new PublicKey(
  readArg("program") ||
    process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ||
    process.env.SHADOWPERP_PROGRAM_ID ||
    DEFAULT_PROGRAM_ID
);
const MARKET_ACCOUNT = new PublicKey(
  readArg("market") ||
    process.env.NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT ||
    process.env.SHADOWPERP_MARKET ||
    DEFAULT_MARKET_ACCOUNT
);
const ARCIUM_PROGRAM_ID = new PublicKey(
  readArg("arcium-program") ||
    process.env.NEXT_PUBLIC_ARCIUM_PROGRAM_ID ||
    DEFAULT_ARCIUM_PROGRAM_ID
);
const CLUSTER_OFFSET = Number(
  readArg("cluster-offset") ||
    process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET ||
    DEFAULT_CLUSTER_OFFSET
);

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function resolveWallet(): Keypair {
  const walletPath =
    process.env.SOLANA_WALLET ||
    path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(walletPath)) throw new Error(`Wallet not found: ${walletPath}`);
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
}

function resolveIdlPath(): string {
  const candidates = [
    path.resolve(__dirname, "..", "target", "idl", "shadowperp.json"),
    path.resolve(__dirname, "..", "app", "src", "idl", "shadowperp.json"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `IDL not found at ${candidates.join(" or ")}. Run 'anchor build' first if needed.`
    );
  }
  return found;
}

function ok(label: string) {
  console.log(`  [OK] ${label}`);
}
function fail(label: string, err?: string) {
  console.log(`  [FAIL] ${label}${err ? ": " + err : ""}`);
}
function info(label: string) {
  console.log(`  [INFO] ${label}`);
}

async function resolveFundingStatePda(
  connection: Connection,
  market: PublicKey
): Promise<PublicKey | null> {
  const candidate = PublicKey.findProgramAddressSync(
    [Buffer.from("funding"), market.toBuffer()],
    PROGRAM_ID
  )[0];
  const info = await connection.getAccountInfo(candidate);
  return info ? candidate : null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const rpcUrl =
    readArg("rpc") ||
    (await resolveRpcEndpoint({ preferred: readArg("rpc") })).rpcUrl;

  const wallet = resolveWallet();
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  // Load IDL
  const idlPath = resolveIdlPath();
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const program = new anchor.Program(
    { ...idl, address: PROGRAM_ID.toBase58() } as any,
    provider
  );

  console.log("\n=== ShadowPerp Devnet Smoke Test ===\n");
  console.log(`  Program:  ${PROGRAM_ID.toBase58()}`);
  console.log(`  Market:   ${MARKET_ACCOUNT.toBase58()}`);
  console.log(`  Wallet:   ${wallet.publicKey.toBase58()}`);
  console.log(`  RPC:      ${rpcUrl.replace(/\/[a-f0-9]{20,}/, "/***")}`);
  console.log("");

  let passed = 0;
  let failed = 0;

  // ---- 1. Program deployed? ----
  console.log("1. Program deployment");
  try {
    const accInfo = await connection.getAccountInfo(PROGRAM_ID);
    if (accInfo && accInfo.executable) {
      ok(`Program is deployed (${accInfo.data.length} bytes)`);
      passed++;
    } else {
      fail("Program account is not executable");
      failed++;
    }
  } catch (e: any) {
    fail("Cannot fetch program account", e.message);
    failed++;
  }

  // ---- 2. Market account ----
  console.log("\n2. Market account");
  let market: any;
  try {
    market = await (program.account as any).market.fetch(MARKET_ACCOUNT);
    ok(`Market loaded — authority=${market.authority.toBase58().slice(0, 8)}...`);
    passed++;

    // Check key fields
    if (market.oraclePrice > 0) {
      const priceUi = market.oraclePrice / 1_000_000;
      const slot = await connection.getSlot("confirmed");
      const chainTime = await connection.getBlockTime(slot);
      const nowSeconds = Number.isFinite(chainTime)
        ? (chainTime as number)
        : Math.floor(Date.now() / 1000);
      const age = nowSeconds - Number(market.lastPriceUpdate);
      ok(`Oracle price: $${priceUi.toFixed(2)} (age: ${age}s)`);
      if (age > 300) {
        fail("Oracle price is STALE (>300s)");
        failed++;
      } else {
        passed++;
      }
    } else {
      fail("Oracle price is zero");
      failed++;
    }

    // Check comp-defs
    const compDefs = {
      openPositionCompDef: market.openPositionCompDef,
      closePositionCompDef: market.closePositionCompDef,
      liquidationCompDef: market.liquidationCompDef,
      seedOpenInterestCompDef: market.seedOpenInterestCompDef,
    };
    for (const [name, addr] of Object.entries(compDefs)) {
      if (addr && !PublicKey.default.equals(addr as PublicKey)) {
        ok(`${name}: ${(addr as PublicKey).toBase58().slice(0, 12)}...`);
        passed++;
      } else {
        fail(`${name}: not set`);
        failed++;
      }
    }

    info(`Max leverage: ${market.maxLeverage}x`);
    info(`Collateral mint: ${market.collateralMint.toBase58().slice(0, 12)}...`);
  } catch (e: any) {
    fail("Cannot fetch market", e.message);
    failed++;
  }

  // ---- 3. MXE account ----
  console.log("\n3. MXE / Arcium infrastructure");
  try {
    const mxeAddr = getMXEAccAddress(PROGRAM_ID);
    const mxeInfo = await connection.getAccountInfo(mxeAddr);
    if (mxeInfo) {
      ok(`MXE account exists: ${mxeAddr.toBase58().slice(0, 12)}...`);
      passed++;
    } else {
      fail("MXE account not found");
      failed++;
    }
  } catch (e: any) {
    fail("MXE check failed", e.message);
    failed++;
  }

  // Cluster
  try {
    const clusterAddr = getClusterAccAddress(CLUSTER_OFFSET);
    const clusterInfo = await connection.getAccountInfo(clusterAddr);
    if (clusterInfo) {
      ok(`Cluster account exists: ${clusterAddr.toBase58().slice(0, 12)}...`);
      passed++;
    } else {
      fail("Cluster account not found");
      failed++;
    }
  } catch (e: any) {
    fail("Cluster check failed", e.message);
    failed++;
  }

  // MXE public key (for encryption)
  try {
    const mxePubkey = await getArciumMXEPublicKey(provider, PROGRAM_ID);
    if (mxePubkey && mxePubkey.length === 32) {
      ok(`MXE public key available (${mxePubkey.length} bytes)`);
      passed++;
    } else {
      fail("MXE public key not available");
      failed++;
    }
  } catch (e: any) {
    fail("MXE pubkey fetch failed", e.message);
    failed++;
  }

  // ---- 4. Comp-def circuits finalized? ----
  console.log("\n4. Circuit comp-defs");
  const circuits = [
    "open_position_probe_b",
    "close_position_v3",
    "check_liquidation_v3",
    "seed_open_interest_state_v3",
  ];
  const arciumProgram = new anchor.Program(
    { ...(await anchor.Program.fetchIdl(ARCIUM_PROGRAM_ID, provider) || {}), address: ARCIUM_PROGRAM_ID.toBase58() } as any,
    provider
  );

  for (const circuit of circuits) {
    try {
      const offset = Buffer.from(getCompDefAccOffset(circuit)).readUInt32LE(0);
      const compDefAddr = getCompDefAccAddress(PROGRAM_ID, offset);
      const compDefInfo = await connection.getAccountInfo(compDefAddr);
      if (compDefInfo) {
        ok(`${circuit}: ${compDefAddr.toBase58().slice(0, 12)}... (${compDefInfo.data.length} bytes)`);
        passed++;
      } else {
        fail(`${circuit}: account not found`);
        failed++;
      }
    } catch (e: any) {
      fail(`${circuit}`, e.message);
      failed++;
    }
  }

  // ---- 5. Wallet balance ----
  console.log("\n5. Wallet");
  try {
    const balance = await connection.getBalance(wallet.publicKey);
    const sol = balance / 1e9;
    if (sol > 0.1) {
      ok(`Balance: ${sol.toFixed(4)} SOL`);
      passed++;
    } else {
      fail(`Low balance: ${sol.toFixed(4)} SOL`);
      failed++;
    }
  } catch (e: any) {
    fail("Balance check failed", e.message);
    failed++;
  }

  // Check if wallet has collateral tokens
  if (market) {
    try {
      const ata = await getAssociatedTokenAddress(
        market.collateralMint,
        wallet.publicKey
      );
      const tokenAcc = await getTokenAccount(connection, ata);
      const amount = Number(tokenAcc.amount) / 1e6;
      ok(`Collateral token balance: ${amount.toFixed(2)} (ATA: ${ata.toBase58().slice(0, 12)}...)`);
      passed++;
    } catch {
      info("No collateral token account (needed for trading)");
    }
  }

  // ---- 6. Margin account ----
  console.log("\n6. Margin account");
  if (market) {
    try {
      const [marginPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("margin"), wallet.publicKey.toBuffer()],
        PROGRAM_ID
      );
      const marginAcc = await (program.account as any).marginAccount.fetch(marginPda);
      ok(`Margin account: ${marginPda.toBase58().slice(0, 12)}...`);
      info(`  Balance: ${Number(marginAcc.balance) / 1e6}`);
      info(`  Locked: ${Number(marginAcc.lockedBalance) / 1e6}`);
      info(`  Positions opened: ${marginAcc.positionsOpened}`);
      info(`  Active positions: ${marginAcc.activePositions}`);
      passed++;
    } catch {
      info("No margin account yet (deposit collateral to create one)");
    }
  }

  // ---- 7. Trade test (optional) ----
  if (hasFlag("trade") && market) {
    console.log("\n7. Open position smoke test");
    try {
      const [marginPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("margin"), wallet.publicKey.toBuffer()],
        PROGRAM_ID
      );

      // Auto-deposit if no margin account or insufficient balance
      let marginAcc: any;
      try {
        marginAcc = await (program.account as any).marginAccount.fetch(marginPda);
      } catch {
        marginAcc = null;
      }

      const available = marginAcc
        ? Number(marginAcc.balance) - Number(marginAcc.lockedBalance)
        : 0;

      if (available < 5_000_000) {
        const depositAmount = new anchor.BN(5_000_000); // 5 USDC
        info("Depositing 5 USDC collateral...");
        const userTokenAccount = await getAssociatedTokenAddress(
          market.collateralMint,
          wallet.publicKey
        );
        const depositTx = await program.methods
          .depositCollateral(depositAmount)
          .accounts({
            owner: wallet.publicKey,
            market: MARKET_ACCOUNT,
            marginAccount: marginPda,
            userTokenAccount,
            vault: market.vault,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        ok(`Deposited 5 USDC: ${depositTx.slice(0, 20)}...`);
        passed++;

        // Re-fetch margin account
        marginAcc = await (program.account as any).marginAccount.fetch(marginPda);
      }

      {
        // Initialize encryption
        const privKey = x25519.utils.randomPrivateKey
          ? x25519.utils.randomPrivateKey()
          : (x25519.utils as any).randomSecretKey();
        const pubKey = x25519.getPublicKey(privKey);
        const mxePubkey = await getArciumMXEPublicKey(provider, PROGRAM_ID);
        const sharedSecret = x25519.getSharedSecret(privKey, mxePubkey!);
        const cipher = new RescueCipher(sharedSecret);

        // Encrypt position: size=1 SOL, entry=oracle price, leverage=2x, long=true, margin=1 USDC
        const margin = new anchor.BN(1_000_000); // 1 USDC
        const size = BigInt(1_000_000); // 1 unit
        const entryPrice = BigInt(market.oraclePrice.toString());
        const leverage = BigInt(2);
        const isLong = BigInt(1);
        const marginBig = BigInt(1_000_000);

        const nonce = new Uint8Array(16);
        crypto.getRandomValues(nonce);
        const nonceBN = new anchor.BN(Buffer.from(nonce), "le");

        const encrypted = cipher.encrypt(
          [size, entryPrice, leverage, isLong, marginBig],
          nonce
        ) as unknown as Uint8Array[];

        const [eSize, eEntry, eLeverage, eIsLong, eMargin] = encrypted.map(
          (v) => Uint8Array.from(v)
        );

        const computationOffset = new anchor.BN(
          Buffer.from(crypto.getRandomValues(new Uint8Array(8))),
          "le"
        );

        const positionAddress = PublicKey.findProgramAddressSync(
          [
            Buffer.from("position"),
            MARKET_ACCOUNT.toBuffer(),
            wallet.publicKey.toBuffer(),
            marginAcc.positionsOpened.toArrayLike(Buffer, "le", 8),
          ],
          PROGRAM_ID
        )[0];

        const mxeAccount = getMXEAccAddress(PROGRAM_ID);
        const clusterAddress = getClusterAccAddress(CLUSTER_OFFSET);
        const computationAccount = getComputationAccAddress(
          CLUSTER_OFFSET,
          computationOffset
        );
        const signPdaAccount = PublicKey.findProgramAddressSync(
          [Buffer.from("ArciumSignerAccount")],
          PROGRAM_ID
        )[0];

        const fundingStatePda = await resolveFundingStatePda(connection, MARKET_ACCOUNT);
        const posFundingRefPda = PublicKey.findProgramAddressSync(
          [Buffer.from("pos-funding"), positionAddress.toBuffer()],
          PROGRAM_ID
        )[0];
        const openAccounts = {
          owner: wallet.publicKey,
          market: MARKET_ACCOUNT,
          marginAccount: marginPda,
          position: positionAddress,
          fundingState: fundingStatePda,
          posFundingRef: posFundingRefPda,
          mxeAccount,
          compDefAccount: market.openPositionCompDef,
          clusterAccount: clusterAddress,
          mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
          executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
          computationAccount,
          poolAccount: getFeePoolAccAddress(),
          signPdaAccount,
          arciumProgram: ARCIUM_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          clockAccount: getClockAccAddress(),
        };

        info("Sending openPosition tx...");
        const openTx = await program.methods
          .openPosition(
            Array.from(eSize),
            Array.from(eEntry),
            Array.from(eLeverage),
            Array.from(eIsLong),
            Array.from(eMargin),
            0, // cross margin
            margin,
            true, // is_long plaintext flag (hardcoded long for smoke test)
            Array.from(pubKey),
            nonceBN,
            computationOffset
          )
          .accounts(openAccounts as any)
          .transaction();

        // Use polling-based confirmation (works with Alchemy which lacks signatureSubscribe)
        const latestBlockhash = await connection.getLatestBlockhash("confirmed");
        openTx.recentBlockhash = latestBlockhash.blockhash;
        openTx.feePayer = wallet.publicKey;
        openTx.sign(wallet);
        const txSig = await connection.sendRawTransaction(openTx.serialize(), { skipPreflight: false });

        // Poll for confirmation via getSignatureStatuses instead of WebSocket
        const confirmStart = Date.now();
        let confirmed = false;
        while (Date.now() - confirmStart < 30_000) {
          await new Promise((r) => setTimeout(r, 2000));
          const statuses = await connection.getSignatureStatuses([txSig]);
          const status = statuses?.value?.[0];
          if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
            confirmed = true;
            break;
          }
          if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
        }
        if (!confirmed) throw new Error(`Transaction was not confirmed in 30s. Sig: ${txSig}`);

        ok(`openPosition tx: ${txSig.slice(0, 20)}...`);
        passed++;

        // Poll for callback (position status change)
        info("Waiting for MPC callback (up to 120s)...");
        const start = Date.now();
        let positionStatus = 0; // Pending
        while (Date.now() - start < 120_000) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const pos = await (program.account as any).position.fetch(positionAddress);
            positionStatus = pos.status?.pending !== undefined ? 0
              : pos.status?.open !== undefined ? 1
              : pos.status?.closing !== undefined ? 2
              : pos.status?.closed !== undefined ? 3
              : -1;
            if (positionStatus !== 0) break;
            info(`  Still pending... (${Math.round((Date.now() - start) / 1000)}s)`);
          } catch {
            // Position account might not be readable yet
          }
        }

        if (positionStatus === 1) {
          ok("Position opened successfully! MPC callback completed.");
          passed++;
        } else if (positionStatus === 0) {
          fail("Position still pending after 120s (MPC callback not received)");
          failed++;
        } else {
          fail(`Unexpected position status: ${positionStatus}`);
          failed++;
        }
      }
    } catch (e: any) {
      fail("Trade test failed", e.message?.slice(0, 200));
      failed++;
    }
  }

  // ---- Summary ----
  console.log("\n" + "=".repeat(50));
  console.log(`  PASSED: ${passed}  |  FAILED: ${failed}`);
  if (failed === 0) {
    console.log("  All checks passed!");
  } else {
    console.log("  Some checks failed. Review above.");
  }
  console.log("=".repeat(50) + "\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
