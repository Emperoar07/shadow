import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  SystemProgram,
} from "@solana/web3.js";
import {
  getClockAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getExecutingPoolAccAddress,
  getFeePoolAccAddress,
  getLookupTableAddress,
  getMempoolAccAddress,
  getMXEAccAddress,
  getMXEPublicKey,
  RescueCipher,
  uploadCircuit,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomBytes } from "crypto";
import { resolveRpcEndpoint, sendAndConfirmWithPolling } from "./rpc";

const DEFAULT_PROGRAM_ID = "DBshVTiQcB76wVpS6tLuSXuECZJ6LjqPQajxhEaCyDSD";
const DEFAULT_MARKET = "AwiH92K4RxfhoHpmkiQrwZEBi1ia93x1WrK4uoEchLBJ";
const DEFAULT_ARCIUM_PROGRAM_ID = "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ";
const DEFAULT_CLUSTER_OFFSET = 456;

type ProbeSpec = {
  label: string;
  circuit: string;
  initMethod: string;
  runMethod: string;
  stage: 1 | 2 | 3 | 4;
};

const PROBES: ProbeSpec[] = [
  {
    label: "tuple-only",
    circuit: "open_position_tuple_probe_v1",
    initMethod: "initOpenPositionTupleProbeCompDef",
    runMethod: "runOpenPositionTupleProbe",
    stage: 1,
  },
  {
    label: "tuple-u8-only",
    circuit: "open_position_tuple_probe_u8_v1",
    initMethod: "initOpenPositionTupleProbeU8CompDef",
    runMethod: "runOpenPositionTupleProbeU8",
    stage: 4,
  },
  {
    label: "margin-check",
    circuit: "open_position_margin_probe_v1",
    initMethod: "initOpenPositionMarginProbeCompDef",
    runMethod: "runOpenPositionMarginProbe",
    stage: 2,
  },
  {
    label: "full-check",
    circuit: "open_position_full_probe_v1",
    initMethod: "initOpenPositionFullProbeCompDef",
    runMethod: "runOpenPositionFullProbe",
    stage: 3,
  },
];

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
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

function resolveWallet(): Keypair {
  const walletPath =
    process.env.SOLANA_WALLET ||
    path.join(os.homedir(), ".config", "solana", "id.json");
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
      "IDL not found at target/idl/shadowperp.json or app/src/idl/shadowperp.json."
    );
  }
  return found;
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

function parseStatus(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "unknown";
  const key = Object.keys(raw as Record<string, unknown>)[0];
  return key ?? "unknown";
}

function pickField<T>(value: any, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (value != null && value[key] !== undefined && value[key] !== null) {
      return value[key] as T;
    }
  }
  return undefined;
}

function readDiagnosticBool(account: Record<string, unknown>, key: string): boolean {
  const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const value = account[key] ?? account[camelKey];
  return Boolean(value);
}

function isCompDefCompleted(account: Record<string, unknown>): boolean {
  const record = account as any;
  const onchainCompleted =
    record?.circuitSource?.onChain?.[0]?.isCompleted ??
    record?.circuitSource?.onChain?.isCompleted ??
    record?.circuit_source?.on_chain?.[0]?.is_completed ??
    record?.circuit_source?.on_chain?.is_completed ??
    false;
  const offchainSource =
    record?.circuitSource?.offChain ??
    record?.circuit_source?.off_chain ??
    record?.circuitSource?.OffChain ??
    record?.circuit_source?.OffChain;
  return Boolean(onchainCompleted || offchainSource);
}

function rewriteProbeError(error: unknown, programId: PublicKey): never {
  if (error instanceof SendTransactionError) {
    const logs = ((error as any)?.logs ??
      (error as any)?.transactionLogs ??
      []) as string[];
    const fallbackMissing = logs.some((line: string) =>
      line.includes("InstructionFallbackNotFound")
    );
    if (fallbackMissing) {
      throw new Error(
        `Deployed program ${programId.toBase58()} does not include the open-position diagnostic instructions yet. Rebuild and redeploy this branch before running diag:open-contract.`
      );
    }
  }

  throw error;
}

async function runCompatibilityOpenPositionSimulation(args: {
  program: anchor.Program;
  wallet: Keypair;
  market: PublicKey;
  marketAccount: any;
  arciumProgramId: PublicKey;
  clusterOffset: number;
  requestedMargin: anchor.BN;
  clientPubKey: Uint8Array;
  nonce: anchor.BN;
  encSize: number[];
  encEntryPrice: number[];
  encLeverage: number[];
  encIsLong: number[];
  encMargin: number[];
}): Promise<void> {
  const {
    program,
    wallet,
    market,
    marketAccount,
    arciumProgramId,
    clusterOffset,
    requestedMargin,
    clientPubKey,
    nonce,
    encSize,
    encEntryPrice,
    encLeverage,
    encIsLong,
    encMargin,
  } = args;

  const openCompDef = pickField<PublicKey>(
    marketAccount,
    "openPositionCompDef",
    "open_position_comp_def"
  );
  const marketCluster = pickField<PublicKey>(marketAccount, "mxeCluster", "mxe_cluster");
  if (!openCompDef || !marketCluster) {
    throw new Error("Market is missing open_position comp-def or mxe_cluster");
  }

  const [marginPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("margin"), wallet.publicKey.toBuffer()],
    program.programId
  );
  const marginAccount = await (program.account as any).marginAccount.fetch(marginPda);
  const balance = Number(
    pickField<any>(marginAccount, "balance")?.toString?.() ??
      pickField<any>(marginAccount, "balance")
  );
  const locked = Number(
    pickField<any>(marginAccount, "lockedBalance", "locked_balance")?.toString?.() ??
      pickField<any>(marginAccount, "lockedBalance", "locked_balance") ??
      0
  );
  const available = balance - locked;
  const requestedMarginNum = Number(requestedMargin.toString());
  if (!Number.isFinite(available) || available < requestedMarginNum) {
    throw new Error(
      `Compatibility fallback needs at least ${requestedMarginNum} margin units, available=${available}`
    );
  }

  const positionIndex = pickField<any>(marginAccount, "positionsOpened", "positions_opened");
  if (!positionIndex) {
    throw new Error("Margin account missing positions_opened");
  }

  const [positionPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      market.toBuffer(),
      wallet.publicKey.toBuffer(),
      positionIndex.toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );
  const fundingStateCandidate = PublicKey.findProgramAddressSync(
    [Buffer.from("funding"), market.toBuffer()],
    program.programId
  )[0];
  const fundingStateInfo = await (program.provider as anchor.AnchorProvider).connection.getAccountInfo(
    fundingStateCandidate
  );
  const fundingStatePda = fundingStateInfo ? fundingStateCandidate : null;
  const posFundingRefPda = PublicKey.findProgramAddressSync(
    [Buffer.from("pos-funding"), positionPda.toBuffer()],
    program.programId
  )[0];
  const computationOffset = new anchor.BN(randomBytes(8), "le");

  await (program.methods as any)
    .openPosition(
      encSize,
      encEntryPrice,
      encLeverage,
      encIsLong,
      encMargin,
      0,
      requestedMargin,
      true,
      Array.from(clientPubKey),
      nonce,
      computationOffset
    )
    .accounts({
      owner: wallet.publicKey,
      market,
      marginAccount: marginPda,
      position: positionPda,
      fundingState: fundingStatePda,
      posFundingRef: posFundingRefPda,
      mxeAccount: getMXEAccAddress(program.programId),
      compDefAccount: openCompDef,
      clusterAccount: marketCluster,
      mempoolAccount: getMempoolAccAddress(clusterOffset),
      executingPool: getExecutingPoolAccAddress(clusterOffset),
      computationAccount: getComputationAccAddress(clusterOffset, computationOffset),
      poolAccount: getFeePoolAccAddress(),
      signPdaAccount: PublicKey.findProgramAddressSync(
        [Buffer.from("ArciumSignerAccount")],
        program.programId
      )[0],
      arciumProgram: arciumProgramId,
      systemProgram: SystemProgram.programId,
      clockAccount: getClockAccAddress(),
    })
    .simulate();

  console.log("\n[COMPAT] legacy probe instructions are not deployed; direct openPosition simulation passed");
}

async function ensureProbeCompDef(
  program: anchor.Program,
  connection: Connection,
  market: PublicKey,
  wallet: Keypair,
  programId: PublicKey,
  arciumProgramId: PublicKey,
  probe: ProbeSpec
): Promise<PublicKey> {
  const offset = Buffer.from(getCompDefAccOffset(probe.circuit)).readUInt32LE(0);
  const compDef = getCompDefAccAddress(programId, offset);
  const arciumProgram = await anchor.Program.at(arciumProgramId, program.provider);
  const mxe = await (arciumProgram.account as any).mxeAccount.fetch(
    getMXEAccAddress(programId)
  );
  const lutOffset = mxe.lutOffsetSlot ?? mxe.lut_offset_slot;
  const addressLookupTable = getLookupTableAddress(programId, lutOffset);
  const existing = await connection.getAccountInfo(compDef);

  if (!existing) {
    const methods = program.methods as Record<string, (...args: unknown[]) => any>;
    const initMethod = methods?.[probe.initMethod];
    if (!initMethod) {
      throw new Error(`${probe.initMethod} is unavailable in the loaded IDL`);
    }

    const tx = await initMethod()
      .accounts({
        payer: wallet.publicKey,
        market,
        authority: wallet.publicKey,
        mxeAccount: getMXEAccAddress(programId),
        compDefAccount: compDef,
        addressLookupTable,
        lutProgram: new PublicKey("AddressLookupTab1e1111111111111111111111111"),
        arciumProgram: arciumProgramId,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    try {
      await sendAndConfirmWithPolling(connection, wallet, tx, {
        commitment: "confirmed",
      });
    } catch (error) {
      rewriteProbeError(error, programId);
    }
  }

  const compDefAccount = await (arciumProgram.account as any).computationDefinitionAccount.fetch(
    compDef
  );
  if (!isCompDefCompleted(compDefAccount as Record<string, unknown>)) {
    const circuitPath = path.resolve(__dirname, "..", "build", `${probe.circuit}.arcis`);
    if (!fs.existsSync(circuitPath)) {
      throw new Error(`Missing circuit artifact for ${probe.circuit}: ${circuitPath}`);
    }
    const rawCircuit = new Uint8Array(fs.readFileSync(circuitPath));
    await uploadCircuit(
      program.provider as anchor.AnchorProvider,
      probe.circuit,
      programId,
      rawCircuit,
      true
    );
  }

  return compDef;
}

async function waitForDiagnostic(
  program: anchor.Program,
  diagnostic: PublicKey,
  timeoutMs = 120_000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const account = await (program.account as any).openPositionDiagnostic.fetch(diagnostic);
      const status = parseStatus((account as Record<string, unknown>).status);
      if (status !== "pending") {
        return account as Record<string, unknown>;
      }
    } catch {
      // Diagnostic account may not be readable immediately after queueing.
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`Diagnostic ${diagnostic.toBase58()} did not finalize in time`);
}

async function main(): Promise<void> {
  loadEnvFile(path.resolve(__dirname, "..", "app", ".env.local"));

  const rpcOverride = readArg("rpc");
  const { rpcUrl, wsUrl } = await resolveRpcEndpoint({ preferred: rpcOverride });
  const wallet = resolveWallet();
  const programId = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID",
    readArg("program") ||
      process.env.SHADOWPERP_PROGRAM_ID ||
      process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ||
      DEFAULT_PROGRAM_ID
  );
  const market = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT",
    readArg("market") ||
      process.env.SHADOWPERP_MARKET ||
      process.env.NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT ||
      DEFAULT_MARKET
  );
  const arciumProgramId = parsePublicKey(
    "NEXT_PUBLIC_ARCIUM_PROGRAM_ID",
    process.env.NEXT_PUBLIC_ARCIUM_PROGRAM_ID || DEFAULT_ARCIUM_PROGRAM_ID
  );
  const clusterOffset = Number.parseInt(
    readArg("cluster-offset") ||
      process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET ||
      `${DEFAULT_CLUSTER_OFFSET}`,
    10
  );
  if (!Number.isFinite(clusterOffset) || clusterOffset < 0) {
    throw new Error("Invalid cluster offset");
  }

  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: wsUrl,
  });
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync(resolveIdlPath(), "utf8"));
  const program = new anchor.Program(
    { ...idl, address: programId.toBase58() } as any,
    provider
  );

  const marketAccount = await (program.account as any).market.fetch(market);
  const oraclePrice = Number(marketAccount.oraclePrice);
  const requestedMargin = new anchor.BN(1_000_000);
  const size = BigInt(2_000_000);
  const entryPrice = BigInt(oraclePrice);
  const leverage = BigInt(2);
  const isLong = BigInt(1);
  const margin = BigInt(requestedMargin.toString());

  console.log("=== Open Contract Diagnostics ===");
  console.log(`Program: ${programId.toBase58()}`);
  console.log(`Market:  ${market.toBase58()}`);
  console.log(`Owner:   ${wallet.publicKey.toBase58()}`);
  console.log(`RPC:     ${rpcUrl}`);
  console.log(`WS:      ${wsUrl}`);

  const mxePubKey = await getMXEPublicKey(provider, programId);
  if (!mxePubKey) {
    throw new Error("MXE public key unavailable");
  }

  const clientPriv = generateClientPrivateKey();
  const clientPub = x25519.getPublicKey(clientPriv);
  const sharedSecret = x25519.getSharedSecret(clientPriv, mxePubKey);
  const cipher = new RescueCipher(sharedSecret);
  const nonceBytes = new Uint8Array(randomBytes(16));
  const nonce = new anchor.BN(Buffer.from(nonceBytes), "le");
  const encrypted = cipher.encrypt(
    [size, entryPrice, leverage, isLong, margin],
    nonceBytes
  ) as unknown as Uint8Array[];
  const [encSize, encEntryPrice, encLeverage, encIsLong, encMargin] = encrypted.map((value) =>
    Array.from(Uint8Array.from(value))
  );

  const methods = program.methods as Record<string, (...args: unknown[]) => any>;
  const missingProbeMethods = PROBES.flatMap((probe) => {
    const missing: string[] = [];
    if (typeof methods?.[probe.initMethod] !== "function") missing.push(probe.initMethod);
    if (typeof methods?.[probe.runMethod] !== "function") missing.push(probe.runMethod);
    return missing;
  });

  if (missingProbeMethods.length > 0) {
    console.log(
      `\n[INFO] deployed program/IDL is missing legacy probe methods: ${Array.from(
        new Set(missingProbeMethods)
      ).join(", ")}`
    );
    await runCompatibilityOpenPositionSimulation({
      program,
      wallet,
      market,
      marketAccount,
      arciumProgramId,
      clusterOffset,
      requestedMargin,
      clientPubKey: clientPub,
      nonce,
      encSize,
      encEntryPrice,
      encLeverage,
      encIsLong,
      encMargin,
    });
    return;
  }

  for (let index = 0; index < PROBES.length; index += 1) {
    const probe = PROBES[index];
    const runId = new anchor.BN(Date.now() + index);
    const computationOffset = new anchor.BN(randomBytes(8), "le");
    const [diagnostic] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("open-position-diagnostic"),
        market.toBuffer(),
        wallet.publicKey.toBuffer(),
        runId.toArrayLike(Buffer, "le", 8),
      ],
      programId
    );

    const compDefAccount = await ensureProbeCompDef(
      program,
      connection,
      market,
      wallet,
      programId,
      arciumProgramId,
      probe
    );

    console.log(`\n[RUN] ${probe.label}`);
    const runMethod = methods?.[probe.runMethod];
    if (!runMethod) {
      throw new Error(`${probe.runMethod} is unavailable in the loaded IDL`);
    }

    const builder =
      probe.stage === 1 || probe.stage === 4
        ? runMethod(
            encSize,
            encEntryPrice,
            encLeverage,
            encIsLong,
            encMargin,
            Array.from(clientPub),
            nonce,
            runId,
            computationOffset
          )
        : runMethod(
            encSize,
            encEntryPrice,
            encLeverage,
            encIsLong,
            encMargin,
            Array.from(clientPub),
            nonce,
            requestedMargin,
            runId,
            computationOffset
          );

    const tx = await builder
      .accounts({
        owner: wallet.publicKey,
        market,
        diagnostic,
        mxeAccount: getMXEAccAddress(programId),
        compDefAccount,
        clusterAccount: marketAccount.mxeCluster,
        mempoolAccount: getMempoolAccAddress(clusterOffset),
        executingPool: getExecutingPoolAccAddress(clusterOffset),
        computationAccount: getComputationAccAddress(clusterOffset, computationOffset),
        poolAccount: getFeePoolAccAddress(),
        signPdaAccount: PublicKey.findProgramAddressSync(
          [Buffer.from("ArciumSignerAccount")],
          programId
        )[0],
        arciumProgram: arciumProgramId,
        systemProgram: SystemProgram.programId,
        clockAccount: getClockAccAddress(),
      })
      .transaction();

    let signature: string;
    try {
      signature = await sendAndConfirmWithPolling(connection, wallet, tx, {
        commitment: "confirmed",
      });
    } catch (error) {
      rewriteProbeError(error, programId);
    }

    console.log(`  queued tx: ${signature}`);
    console.log(`  diagnostic: ${diagnostic.toBase58()}`);

    const result = await waitForDiagnostic(program, diagnostic);
    console.log(`  status: ${parseStatus(result.status)}`);
    console.log(
      `  results: [${readDiagnosticBool(result, "result_0")}, ${readDiagnosticBool(result, "result_1")}, ${readDiagnosticBool(result, "result_2")}, ${readDiagnosticBool(result, "result_3")}]`
    );
  }
}

main().catch((error) => {
  console.error("diagnose-open-contract failed:", error);
  process.exit(1);
});
