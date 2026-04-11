/**
 * ShadowPerp devnet canary.
 *
 * One-command readiness check before trading smoke tests:
 * - oracle freshness + comp-def finalized checks
 * - client init (encryption bootstrap) health
 * - queue path health via non-destructive open_position simulation
 *
 * Usage:
 *   npx ts-node scripts/devnet-canary.ts
 *   npx ts-node scripts/devnet-canary.ts --max-oracle-age-seconds 300
 */

import * as anchor from "@coral-xyz/anchor";
import {
  getArciumProgram,
  getArciumProgramId,
  getClockAccAddress,
  getComputationAccAddress,
  getExecutingPoolAccAddress,
  getFeePoolAccAddress,
  getMempoolAccAddress,
  getMXEAccAddress,
  getMXEPublicKey,
  RescueCipher,
  x25519,
} from "@arcium-hq/client";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { randomBytes } from "crypto";
import { BN } from "bn.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveRpcEndpoint } from "./rpc";

type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

const DEFAULT_ORACLE_MAX_AGE_SECONDS = 300;
const DEFAULT_CLUSTER_OFFSET = 456;
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const key = `--${name}`;
  const index = args.indexOf(key);
  if (index < 0 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

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

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    const value = normalizeValue(line.slice(sep + 1));
    if (!value) continue;
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parsePublicKey(name: string, value?: string): PublicKey {
  const normalized = normalizeValue(value);
  if (!normalized) {
    throw new Error(`Missing required value: ${name}`);
  }
  return new PublicKey(normalized);
}

function resolveWalletPath(): string {
  if (process.env.SOLANA_WALLET && fs.existsSync(process.env.SOLANA_WALLET)) {
    return process.env.SOLANA_WALLET;
  }
  return path.join(os.homedir(), ".config", "solana", "id.json");
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

function isCompDefCompleted(account: any): boolean {
  return (
    account?.circuitSource?.onChain?.[0]?.isCompleted ??
    account?.circuit_source?.on_chain?.[0]?.is_completed ??
    false
  );
}

function formatCheck(check: Check): string {
  return `${check.ok ? "PASS" : "FAIL"}  ${check.name} - ${check.detail}`;
}

function shortError(error: any): string {
  const rawMsg =
    error?.message ||
    error?.error?.errorMessage ||
    error?.errorMessage ||
    error?.toString?.() ||
    "unknown error";
  const msg = String(rawMsg);
  const logs: string[] =
    error?.logs ||
    error?.error?.logs ||
    error?.error?.errorLogs ||
    error?.transactionLogs ||
    error?.simulationResponse?.logs ||
    error?.error?.simulationResponse?.logs ||
    [];
  const logText = logs.join(" | ");
  if (msg.includes("AccountDidNotSerialize") || logText.includes("AccountDidNotSerialize")) {
    return "AccountDidNotSerialize (queue computation account serialization)";
  }
  if (msg.includes("ComputationInProgress") || logText.includes("ComputationInProgress")) {
    return "ComputationInProgress (pending computation already bound)";
  }
  if (msg === "Error" && logText.length > 0) {
    return logText.split(" | ").slice(-3).join(" | ").slice(0, 220);
  }
  return msg.split("\n")[0].slice(0, 220);
}

function extractLogs(error: any): string[] {
  const logs: string[] =
    error?.logs ||
    error?.error?.logs ||
    error?.error?.errorLogs ||
    error?.transactionLogs ||
    error?.simulationResponse?.logs ||
    error?.error?.simulationResponse?.logs ||
    [];
  return Array.isArray(logs) ? logs : [];
}

function generateClientPrivateKey(): Uint8Array {
  const utils = x25519.utils as {
    randomSecretKey?: () => Uint8Array;
    randomPrivateKey?: () => Uint8Array;
  };
  if (utils.randomSecretKey) return utils.randomSecretKey();
  if (utils.randomPrivateKey) return utils.randomPrivateKey();
  throw new Error("x25519 key generation unavailable");
}

async function main(): Promise<void> {
  const verbose = process.argv.includes("--verbose");
  loadEnvFile(path.resolve(__dirname, "..", "app", ".env.local"));

  const maxOracleAgeSeconds = Number.parseInt(
    readArg("max-oracle-age-seconds") || `${DEFAULT_ORACLE_MAX_AGE_SECONDS}`,
    10
  );
  if (!Number.isFinite(maxOracleAgeSeconds) || maxOracleAgeSeconds < 1) {
    throw new Error("Invalid --max-oracle-age-seconds");
  }

  const clusterOffsetRaw = normalizeValue(process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET);
  const clusterOffset = clusterOffsetRaw
    ? Number.parseInt(clusterOffsetRaw, 10)
    : DEFAULT_CLUSTER_OFFSET;
  if (!Number.isFinite(clusterOffset) || clusterOffset < 0) {
    throw new Error("Invalid NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET");
  }

  const rpcSelection = await resolveRpcEndpoint({
    preferred:
      process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    commitment: "confirmed",
  });
  const rpcUrl = rpcSelection.rpcUrl;

  const programId = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID",
    process.env.SHADOWPERP_PROGRAM_ID || process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID
  );
  const marketPk = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT",
    process.env.SHADOWPERP_MARKET || process.env.NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT
  );
  const arciumProgramId = parsePublicKey(
    "NEXT_PUBLIC_ARCIUM_PROGRAM_ID",
    process.env.NEXT_PUBLIC_ARCIUM_PROGRAM_ID || getArciumProgramId().toBase58()
  );

  const walletPath = resolveWalletPath();
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Operator wallet not found at ${walletPath}`);
  }
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );

  const checks: Check[] = [];
  const connection = new Connection(rpcUrl, "confirmed");
  await connection.getLatestBlockhash("processed");
  checks.push({ name: "RPC", ok: true, detail: rpcUrl });

  const programInfo = await connection.getAccountInfo(programId);
  checks.push({
    name: "Program executable + owner",
    ok: Boolean(programInfo?.executable) && Boolean(programInfo?.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)),
    detail: programInfo
      ? `executable=${programInfo.executable}, owner=${programInfo.owner.toBase58()}`
      : "missing",
  });

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
    commitment: "confirmed",
  });
  const idl = JSON.parse(fs.readFileSync(resolveIdlPath(), "utf8"));
  idl.address = programId.toBase58();
  const program = new anchor.Program(idl as anchor.Idl, provider);
  const arciumProgram = getArciumProgram(provider);

  const market = await (program.account as any).market.fetch(marketPk);
  const openCompDef = pickField<PublicKey>(market, "openPositionCompDef", "open_position_comp_def");
  const closeCompDef = pickField<PublicKey>(market, "closePositionCompDef", "close_position_comp_def");
  const liquidationCompDef = pickField<PublicKey>(
    market,
    "liquidationCompDef",
    "liquidation_comp_def"
  );
  for (const entry of [
    { label: "open_position", key: openCompDef },
    { label: "close_position", key: closeCompDef },
    { label: "check_liquidation", key: liquidationCompDef },
  ]) {
    const exists = entry.key instanceof PublicKey;
    checks.push({
      name: `Comp-def pointer (${entry.label})`,
      ok: exists,
      detail: exists ? entry.key!.toBase58() : "missing",
    });
    if (!exists) continue;
    const compDefState = await (arciumProgram.account as any).computationDefinitionAccount.fetch(
      entry.key!
    );
    checks.push({
      name: `Comp-def finalized (${entry.label})`,
      ok: isCompDefCompleted(compDefState),
      detail: isCompDefCompleted(compDefState) ? "completed" : "pending",
    });
  }

  const oraclePriceRaw = toNumber(pickField<any>(market, "oraclePrice", "oracle_price"));
  const lastPriceUpdate = toNumber(pickField<any>(market, "lastPriceUpdate", "last_price_update"));
  const chainSlot = await connection.getSlot("confirmed");
  const chainTime = await connection.getBlockTime(chainSlot);
  const nowSeconds = Number.isFinite(chainTime)
    ? (chainTime as number)
    : Math.floor(Date.now() / 1000);
  const ageSeconds = nowSeconds - lastPriceUpdate;
  const oracleFresh =
    Number.isFinite(ageSeconds) && ageSeconds >= 0 && ageSeconds <= maxOracleAgeSeconds;
  checks.push({
    name: "Oracle price set",
    ok: Number.isFinite(oraclePriceRaw) && oraclePriceRaw > 0,
    detail: Number.isFinite(oraclePriceRaw)
      ? `$${(oraclePriceRaw / 1_000_000).toFixed(4)}`
      : "invalid",
  });
  checks.push({
    name: "Oracle freshness",
    ok: oracleFresh,
    detail: `age=${ageSeconds}s (max ${maxOracleAgeSeconds}s)`,
  });

  // Client init health: MXE public key fetch + x25519 shared-secret + Rescue cipher bootstrap.
  let cipher: RescueCipher | null = null;
  let clientPubKey: Uint8Array | null = null;
  let nonceBytes: Uint8Array | null = null;
  try {
    const mxePubKey = await getMXEPublicKey(provider, programId);
    if (!mxePubKey || mxePubKey.length !== 32) {
      throw new Error("MXE public key missing/invalid");
    }
    const clientPriv = generateClientPrivateKey();
    clientPubKey = x25519.getPublicKey(clientPriv);
    const sharedSecret = x25519.getSharedSecret(clientPriv, mxePubKey);
    cipher = new RescueCipher(sharedSecret);
    nonceBytes = new Uint8Array(randomBytes(16));
    const probeCiphertext = cipher.encrypt([1n], nonceBytes);
    if (!probeCiphertext || probeCiphertext.length !== 1) {
      throw new Error("cipher probe failed");
    }
    checks.push({
      name: "Client init",
      ok: true,
      detail: `encryption bootstrap OK (client pubkey ${Buffer.from(clientPubKey).toString("hex").slice(0, 10)}...)`,
    });
  } catch (error: any) {
    checks.push({
      name: "Client init",
      ok: false,
      detail: shortError(error),
    });
  }

  // Queue call health (non-destructive): open_position simulation only.
  try {
    if (!cipher || !clientPubKey || !nonceBytes) {
      checks.push({
        name: "Queue call health (open_position simulate)",
        ok: true,
        detail: "skipped (client init failed)",
      });
      throw new Error("__queue_skip__");
    }
    if (!oracleFresh) {
      checks.push({
        name: "Queue call health (open_position simulate)",
        ok: true,
        detail: "skipped (oracle stale; refresh price first)",
      });
      throw new Error("__queue_skip__");
    }

    const [marginPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("margin"), marketPk.toBuffer(), wallet.publicKey.toBuffer()],
      programId
    );
    const marginAccount = await (program.account as any).marginAccount.fetch(marginPda);
    const balance = toNumber(pickField<any>(marginAccount, "balance"));
    const locked = toNumber(pickField<any>(marginAccount, "lockedBalance", "locked_balance"));
    const available = balance - locked;
    if (!Number.isFinite(available) || available <= 0) {
      throw new Error("margin account has no available collateral for simulation");
    }

    const marginAmountNum = Math.min(1_000_000, Math.floor(available)); // 1 USDC max for canary
    if (marginAmountNum <= 0) {
      throw new Error("insufficient margin for queue simulation");
    }
    const marginAmount = new BN(marginAmountNum);

    const positionIndex = pickField<any>(marginAccount, "positionsOpened", "positions_opened");
    if (!positionIndex) {
      throw new Error("positions_opened unavailable");
    }
    const [positionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        marketPk.toBuffer(),
        wallet.publicKey.toBuffer(),
        positionIndex.toArrayLike(Buffer, "le", 8),
      ],
      programId
    );

    const oraclePrice = BigInt(Math.max(1, Math.floor(oraclePriceRaw)));
    const values = [
      BigInt(Math.max(1, marginAmountNum * 2)), // size (u64, 6dp quote notional)
      oraclePrice, // entry price
      BigInt(2), // leverage (u8)
      BigInt(1), // is_long (bool)
      BigInt(marginAmountNum), // margin
    ];
    const encryptedTuple = cipher.encrypt(values, nonceBytes) as unknown as Uint8Array[];
    const [encSize, encEntryPrice, encLeverage, encIsLong, encMargin] = encryptedTuple.map((buf) =>
      Array.from(buf)
    );

    const computationOffset = new BN(randomBytes(8), "le");
    const mxeAccount = getMXEAccAddress(programId);
    const computationAccount = getComputationAccAddress(clusterOffset, computationOffset);
    const signPdaAccount = PublicKey.findProgramAddressSync(
      [Buffer.from("ArciumSignerAccount")],
      programId
    )[0];
    const marketCluster = pickField<PublicKey>(market, "mxeCluster", "mxe_cluster");
    if (!marketCluster) {
      throw new Error("market missing mxe_cluster");
    }

    const fundingStatePda = PublicKey.findProgramAddressSync(
      [Buffer.from("funding"), marketPk.toBuffer()],
      programId
    )[0];
    const posFundingRefPda = PublicKey.findProgramAddressSync(
      [Buffer.from("pos-funding"), positionPda.toBuffer()],
      programId
    )[0];

    await (program.methods as any)
      .openPosition(
        encSize,
        encEntryPrice,
        encLeverage,
        encIsLong,
        encMargin,
        0,
        marginAmount,
        true, // is_long plaintext flag
        Array.from(clientPubKey),
        new BN(nonceBytes, "le"),
        computationOffset
      )
      .accounts({
        owner: wallet.publicKey,
        market: marketPk,
        marginAccount: marginPda,
        position: positionPda,
        fundingState: fundingStatePda,
        posFundingRef: posFundingRefPda,
        mxeAccount,
        compDefAccount: openCompDef,
        clusterAccount: marketCluster,
        mempoolAccount: getMempoolAccAddress(clusterOffset),
        executingPool: getExecutingPoolAccAddress(clusterOffset),
        computationAccount,
        poolAccount: getFeePoolAccAddress(),
        signPdaAccount,
        arciumProgram: arciumProgramId,
        systemProgram: SystemProgram.programId,
        clockAccount: getClockAccAddress(),
      })
      .simulate();

    checks.push({
      name: "Queue call health (open_position simulate)",
      ok: true,
      detail: "simulation passed",
    });
  } catch (error: any) {
    if (String(error?.message || error).includes("__queue_skip__")) {
      // Already recorded a skip check above.
      // Keep canary output focused on the primary actionable failure.
      // eslint-disable-next-line no-empty
    } else {
    if (verbose) {
      const logs = extractLogs(error);
      if (logs.length > 0) {
        console.log("\nQueue simulation logs:");
        console.log(logs.join("\n"));
      } else {
        console.log("\nQueue simulation logs: <none>");
      }
    }
    checks.push({
      name: "Queue call health (open_position simulate)",
      ok: false,
      detail: shortError(error),
    });
    }
  }

  console.log("ShadowPerp Devnet Canary");
  console.log(`Program: ${programId.toBase58()}`);
  console.log(`Market:  ${marketPk.toBase58()}`);
  console.log(`RPC:     ${rpcUrl}`);
  console.log("");
  for (const check of checks) {
    console.log(formatCheck(check));
  }

  const failures = checks.filter((c) => !c.ok);
  if (failures.length > 0) {
    console.error(`\nCanary failed: ${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nCanary passed: devnet stack is ready for trading smoke tests.");
}

main().catch((error) => {
  console.error("devnet-canary failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
