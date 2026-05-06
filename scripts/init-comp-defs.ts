import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  buildFinalizeCompDefTx,
  getArciumProgram,
  getArciumProgramId,
  getClusterAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getLookupTableAddress,
  getMXEAccAddress,
  getRawCircuitAccAddress,
  initMxePart1,
  initMxePart2,
  uploadCircuit,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import { resolveRpcEndpoint, sendAndConfirmWithPolling } from "./rpc";

type InitArgs = {
  programId: PublicKey;
  market: PublicKey;
  rpcUrl: string;
  arciumProgramId: PublicKey;
  mxeProgramId: PublicKey;
  clusterOffset: number;
};

const DEFAULT_CLUSTER_OFFSET = 456;
const EXPECTED_SIGNATURES: Record<string, { params: number; outputs: number }> = {
  // Actual on-chain param counts (from finalized comp-defs)
  open_position_probe_b: { params: 9, outputs: 1 },
  close_position_v3: { params: 9, outputs: 4 },
  seed_open_interest_state_v3: { params: 1, outputs: 4 },
  check_liquidation_v2: { params: 9, outputs: 3 },
};

const COMP_DEFS = [
  {
    circuit: "open_position_probe_b",
    methodName: "initOpenPositionCompDef",
    marketField: "openPositionCompDef",
  },
  {
    circuit: "close_position_v3",
    methodName: "initClosePositionCompDef",
    marketField: "closePositionCompDef",
  },
  {
    circuit: "check_liquidation_v2",
    methodName: "initLiquidationCompDef",
    marketField: "liquidationCompDef",
  },
  {
    circuit: "seed_open_interest_state_v3",
    methodName: "initSeedOpenInterestCompDef",
    marketField: "seedOpenInterestCompDef",
  },
  {
    circuit: "execute_private_order",
    methodName: "initExecutePrivateOrderCompDef",
    marketField: null,
  },
  {
    circuit: "open_position_tuple_probe_v1",
    methodName: "initOpenPositionTupleProbeCompDef",
    marketField: null,
  },
  {
    circuit: "open_position_tuple_probe_u8_v1",
    methodName: "initOpenPositionTupleProbeU8CompDef",
    marketField: null,
  },
  {
    circuit: "open_position_margin_probe_v1",
    methodName: "initOpenPositionMarginProbeCompDef",
    marketField: null,
  },
  {
    circuit: "open_position_full_probe_v1",
    methodName: "initOpenPositionFullProbeCompDef",
    marketField: null,
  },
] as const;

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

function parseArgs(): InitArgs {
  const args = process.argv.slice(2);
  const readArg = (name: string): string | undefined => {
    const key = `--${name}`;
    const index = args.indexOf(key);
    if (index === -1 || index + 1 >= args.length) return undefined;
    return args[index + 1];
  };

  const programIdRaw =
    readArg("program") || process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID;
  const marketRaw =
    readArg("market") || process.env.NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT;
  const rpcUrl =
    readArg("rpc") || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

  if (!programIdRaw) {
    throw new Error("Missing program id. Pass --program or set NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID.");
  }
  if (!marketRaw) {
    throw new Error("Missing market account. Pass --market or set NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT.");
  }

  const programId = new PublicKey(programIdRaw);
  const mxeProgramId = new PublicKey(readArg("mxe-program") || programIdRaw);
  const arciumProgramId = new PublicKey(
    readArg("arcium-program") ||
      process.env.NEXT_PUBLIC_ARCIUM_PROGRAM_ID ||
      getArciumProgramId()
  );

  const clusterOffsetRaw =
    readArg("cluster-offset") || process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET;
  const parsedClusterOffset = clusterOffsetRaw
    ? Number.parseInt(clusterOffsetRaw, 10)
    : Number.NaN;
  const clusterOffset =
    Number.isFinite(parsedClusterOffset) && parsedClusterOffset >= 0
      ? parsedClusterOffset
      : DEFAULT_CLUSTER_OFFSET;

  return {
    programId,
    market: new PublicKey(marketRaw),
    rpcUrl,
    arciumProgramId,
    mxeProgramId,
    clusterOffset,
  };
}

function resolveWalletPath(): string {
  if (process.env.SOLANA_WALLET && fs.existsSync(process.env.SOLANA_WALLET)) {
    return process.env.SOLANA_WALLET;
  }
  const defaultPath = path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(defaultPath)) {
    throw new Error(`Solana wallet not found: ${defaultPath}`);
  }
  return defaultPath;
}

function fetchShadowIdl(programId: PublicKey): any {
  try {
    const raw = execSync(`anchor idl fetch ${programId.toBase58()}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const idl = JSON.parse(raw);
    idl.address = programId.toBase58();
    return idl;
  } catch (error: any) {
    const fallbackPaths = [
      path.resolve(process.cwd(), "target", "idl", "shadowperp.json"),
      path.resolve(process.cwd(), "app", "src", "idl", "shadowperp.json"),
    ];
    const fallback = fallbackPaths.find((candidate) => fs.existsSync(candidate));
    if (!fallback) {
      throw error;
    }
    console.warn(
      `anchor idl fetch failed (${String(error?.message || error).split("\n")[0]}). ` +
        `Falling back to local IDL at ${fallback}.`
    );
    const idl = JSON.parse(fs.readFileSync(fallback, "utf8"));
    idl.address = programId.toBase58();
    return idl;
  }
}

function readCompDefOffset(circuit: string): number {
  return Buffer.from(getCompDefAccOffset(circuit)).readUInt32LE(0);
}

function randomOffset(): anchor.BN {
  const randomBytes = Keypair.generate().secretKey.slice(0, 8);
  return new anchor.BN(Buffer.from(randomBytes), "le");
}

function parseNodeOffset(value: any): number {
  if (typeof value === "number") return value;
  if (typeof value?.toString === "function") {
    const asNum = Number.parseInt(value.toString(), 10);
    if (Number.isFinite(asNum)) return asNum;
  }
  return 0;
}

function isCompDefCompleted(account: any): boolean {
  return (
    account?.circuitSource?.onChain?.[0]?.isCompleted ??
    account?.circuit_source?.on_chain?.[0]?.is_completed ??
    false
  );
}

function readCompDefSignature(account: any): { params: number; outputs: number; circuitLen: number | null } {
  const definition = account?.definition ?? account?.computationDefinition ?? account?.computation_definition;
  const signature = definition?.signature;
  const params = Array.isArray(signature?.parameters) ? signature.parameters.length : 0;
  const outputs = Array.isArray(signature?.outputs) ? signature.outputs.length : 0;
  const circuitLenRaw = definition?.circuitLen ?? definition?.circuit_len;
  const circuitLen =
    circuitLenRaw !== undefined && circuitLenRaw !== null
      ? Number.parseInt(circuitLenRaw.toString(), 10)
      : null;
  return { params, outputs, circuitLen: Number.isFinite(circuitLen) ? circuitLen : null };
}

function resolveCircuitArtifactPath(circuit: string): string | null {
  const preferredArcisPath = path.resolve(process.cwd(), "build", `${circuit}.arcis`);
  const fallbackIdarcPath = path.resolve(process.cwd(), "build", `${circuit}.idarc`);
  if (fs.existsSync(preferredArcisPath)) return preferredArcisPath;
  if (fs.existsSync(fallbackIdarcPath)) return fallbackIdarcPath;
  return null;
}

function validateCompDefAgainstExpected(
  circuit: string,
  compDefAccount: PublicKey,
  account: any
): void {
  const expected = EXPECTED_SIGNATURES[circuit];
  const actual = readCompDefSignature(account);
  if (expected && (actual.params !== expected.params || actual.outputs !== expected.outputs)) {
    throw new Error(
      [
        `FRESH_NAMESPACE_REQUIRED: finalized comp-def mismatch for ${circuit}.`,
        `  comp-def: ${compDefAccount.toBase58()}`,
        `  expected signature: params=${expected.params}, outputs=${expected.outputs}`,
        `  actual signature:   params=${actual.params}, outputs=${actual.outputs}`,
        "This comp-def is immutable once finalized; rotate to a fresh MXE namespace (new program ID) and re-init comp-defs.",
      ].join("\n")
    );
  }

  const circuitPath = resolveCircuitArtifactPath(circuit);
  if (!circuitPath || actual.circuitLen === null) return;
  const localLen = fs.statSync(circuitPath).size;
  if (localLen !== actual.circuitLen) {
    throw new Error(
      [
        `FRESH_NAMESPACE_REQUIRED: finalized comp-def circuit length mismatch for ${circuit}.`,
        `  comp-def: ${compDefAccount.toBase58()}`,
        `  on-chain circuit_len: ${actual.circuitLen}`,
        `  local ${path.basename(circuitPath)} length: ${localLen}`,
        "A finalized comp-def cannot be resized/replaced in-place safely; rotate to a fresh namespace and re-finalize.",
      ].join("\n")
    );
  }
}

function describeLamportShortfall(error: unknown): string | null {
  const text = String((error as any)?.message || error || "");
  const match = text.match(/insufficient lamports\s+(\d+),\s+need\s+(\d+)/i);
  if (!match) return null;

  const current = Number.parseInt(match[1], 10);
  const needed = Number.parseInt(match[2], 10);
  if (!Number.isFinite(current) || !Number.isFinite(needed)) return null;

  const shortfallLamports = Math.max(0, needed - current);
  const shortfallSol = shortfallLamports / anchor.web3.LAMPORTS_PER_SOL;
  return `short by ${shortfallSol.toFixed(6)} SOL (${shortfallLamports.toLocaleString()} lamports) for one resize step`;
}

const MAX_REALLOC_PER_IX = 10_240;
const MAX_UPLOAD_PER_TX_BYTES = 814;
const SAFE_EMBIGGEN_IX_PER_TX = 9; // Use 9 instead of SDK's 18 to avoid per-tx growth limit
const DEFAULT_UPLOAD_CHUNK_SIZE = 25;
const SEQUENTIAL_UPLOAD_CONFIRM_TIMEOUT_MS = 300_000;

function readUploadChunkSize(): number {
  const raw = process.env.ARCIUM_UPLOAD_CHUNK_SIZE;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_UPLOAD_CHUNK_SIZE;
  return Math.min(parsed, 500);
}

async function growRawCircuitAccount(
  provider: anchor.AnchorProvider,
  compDefPubkey: PublicKey,
  compDefOffset: number,
  mxeProgramId: PublicKey,
  rawCircuitIndex: number,
  requiredSize: number,
  confirmOptions: anchor.web3.ConfirmOptions
): Promise<void> {
  const arciumProgram = getArciumProgram(provider);
  const rawCircuitPda = getRawCircuitAccAddress(compDefPubkey, rawCircuitIndex);

  while (true) {
    const existingAcc = await provider.connection.getAccountInfo(rawCircuitPda);
    const currentSize = existingAcc?.data.length ?? 0;
    if (currentSize >= requiredSize) break;

    const remaining = requiredSize - currentSize;
    const ixCount = Math.min(SAFE_EMBIGGEN_IX_PER_TX, Math.ceil(remaining / MAX_REALLOC_PER_IX));

    const ix = await (arciumProgram.methods as any)
      .embiggenRawCircuitAcc(compDefOffset, mxeProgramId, rawCircuitIndex)
      .accounts({ signer: provider.publicKey })
      .instruction();

    const tx = new anchor.web3.Transaction();
    for (let i = 0; i < ixCount; i++) tx.add(ix);

    const blockInfo = await provider.connection.getLatestBlockhash({ commitment: "confirmed" });
    tx.recentBlockhash = blockInfo.blockhash;
    tx.lastValidBlockHeight = blockInfo.lastValidBlockHeight;

    console.log(`Growing raw circuit (${currentSize} → ${currentSize + ixCount * MAX_REALLOC_PER_IX} bytes, ${ixCount} ixs)`);
    await provider.sendAndConfirm(tx, [], confirmOptions);
  }
}

async function uploadRawCircuitSequential(
  params: {
    provider: anchor.AnchorProvider;
    arciumProgram: any;
    payer: Keypair;
    compDefOffset: number;
    mxeProgramId: PublicKey;
    rawCircuitIndex: number;
    rawCircuit: Uint8Array;
    label: string;
  }
): Promise<string[]> {
  const signatures: string[] = [];
  const txCount = Math.ceil(params.rawCircuit.length / MAX_UPLOAD_PER_TX_BYTES);

  console.log(`Sequentially uploading ${params.label} (${txCount} txs)`);

  for (let i = 0; i < txCount; i += 1) {
    const offset = i * MAX_UPLOAD_PER_TX_BYTES;
    let bytes = Buffer.copyBytesFrom(
      params.rawCircuit,
      offset,
      MAX_UPLOAD_PER_TX_BYTES
    );
    if (bytes.length < MAX_UPLOAD_PER_TX_BYTES) {
      const padded = Buffer.allocUnsafe(MAX_UPLOAD_PER_TX_BYTES);
      padded.fill(0);
      padded.set(bytes);
      bytes = padded;
    }

    const tx = await (params.arciumProgram.methods as any)
      .uploadCircuit(
        params.compDefOffset,
        params.mxeProgramId,
        params.rawCircuitIndex,
        Array.from(bytes),
        offset
      )
      .accounts({ signer: params.payer.publicKey })
      .transaction();

    const sig = await sendAndConfirmWithPolling(
      params.provider.connection,
      params.payer,
      tx,
      {
        commitment: "confirmed",
        timeoutMs: SEQUENTIAL_UPLOAD_CONFIRM_TIMEOUT_MS,
        pollMs: 2_000,
        sendOptions: { skipPreflight: true, preflightCommitment: "confirmed" },
      }
    );
    signatures.push(sig);

    if ((i + 1) % 25 === 0 || i + 1 === txCount) {
      console.log(`Uploaded ${params.label} chunk ${i + 1}/${txCount}`);
    }
  }

  const finalizeTx = await buildFinalizeCompDefTx(
    params.provider,
    params.compDefOffset,
    params.mxeProgramId
  );
  const finalizeSig = await sendAndConfirmWithPolling(
    params.provider.connection,
    params.payer,
    finalizeTx,
    {
      commitment: "confirmed",
      timeoutMs: SEQUENTIAL_UPLOAD_CONFIRM_TIMEOUT_MS,
      pollMs: 2_000,
      sendOptions: { skipPreflight: true, preflightCommitment: "confirmed" },
    }
  );
  signatures.push(finalizeSig);
  console.log(`Finalized ${params.label}. Tx: ${finalizeSig}`);

  return signatures;
}

async function ensureMxeInitialized(
  provider: anchor.AnchorProvider,
  connection: Connection,
  mxeProgramId: PublicKey,
  clusterOffset: number
): Promise<anchor.BN> {
  const mxeAccount = getMXEAccAddress(mxeProgramId);
  const existing = await connection.getAccountInfo(mxeAccount);

  if (!existing) {
    console.log(`MXE account missing (${mxeAccount.toBase58()}). Initializing...`);

    try {
      const sig1 = await initMxePart1(provider, mxeProgramId);
      console.log(`initMxePart1: ${sig1}`);
    } catch (error: any) {
      const message = String(error?.message || error);
      if (!message.includes("already in use") && !message.includes("already initialized")) {
        throw error;
      }
      console.log("initMxePart1 already initialized.");
    }

    const arciumProgram = getArciumProgram(provider);
    const clusterAccount = getClusterAccAddress(clusterOffset);
    const cluster = await (arciumProgram.account as any).cluster.fetch(clusterAccount);
    const nodeOffsets = ((cluster.nodes || []) as Array<any>)
      .map((node) => parseNodeOffset(node.offset))
      .filter((offset) => offset > 0);

    if (nodeOffsets.length === 0) {
      throw new Error(
        `Cluster ${clusterOffset} has no active nodes. Pick a valid Arcium devnet cluster offset.`
      );
    }

    const recoveryPeers = new Array<number>(100).fill(0);
    const requiredNonZeroPeers = Math.max(4, nodeOffsets.length);
    for (let i = 0; i < Math.min(100, requiredNonZeroPeers); i += 1) {
      recoveryPeers[i] = nodeOffsets[i % nodeOffsets.length];
    }

    const keygenOffset = randomOffset();
    const keyRecoveryInitOffset = randomOffset();
    const slot = await connection.getSlot("confirmed");
    const lutOffset = new anchor.BN(slot);

    try {
      const sig2 = await initMxePart2(
        provider,
        clusterOffset,
        mxeProgramId,
        recoveryPeers,
        keygenOffset,
        keyRecoveryInitOffset,
        lutOffset,
        provider.wallet.publicKey
      );
      console.log(`initMxePart2: ${sig2}`);
    } catch (error: any) {
      const message = String(error?.message || error);
      if (
        !message.includes("already in use") &&
        !message.includes("already initialized") &&
        !message.includes("already exists")
      ) {
        throw error;
      }
      console.log("initMxePart2 already initialized.");
    }
  } else {
    console.log(`MXE account exists: ${mxeAccount.toBase58()}`);
  }

  const arciumProgram = getArciumProgram(provider);
  const mxe = await (arciumProgram.account as any).mxeAccount.fetch(mxeAccount);
  const lutOffset = mxe.lutOffsetSlot ?? mxe.lut_offset_slot;
  if (!lutOffset) {
    throw new Error("Unable to read lut_offset_slot from MXE account.");
  }
  return lutOffset as anchor.BN;
}

async function ensureCompDef(
  program: any,
  provider: anchor.AnchorProvider,
  params: {
    methodName: string;
    circuit: string;
    payer: PublicKey;
    authority: PublicKey;
    market: PublicKey;
    mxeAccount: PublicKey;
    addressLookupTable: PublicKey;
    arciumProgramId: PublicKey;
    mxeProgramId: PublicKey;
    arciumProgram: any;
    payerKeypair: Keypair;
  }
): Promise<void> {
  const offset = readCompDefOffset(params.circuit);
  const compDefAccount = getCompDefAccAddress(params.mxeProgramId, offset);
  const method = (program.methods as any)[params.methodName];
  if (!method) {
    throw new Error(`IDL missing method: ${params.methodName}`);
  }

  try {
    await method()
      .accounts({
        payer: params.payer,
        market: params.market,
        authority: params.authority,
        mxeAccount: params.mxeAccount,
        compDefAccount,
        addressLookupTable: params.addressLookupTable,
        lutProgram: new PublicKey("AddressLookupTab1e1111111111111111111111111"),
        arciumProgram: params.arciumProgramId,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`Initialized ${params.circuit} comp-def: ${compDefAccount.toBase58()}`);
  } catch (error: any) {
    const message = String(error?.message || error);
    if (
      message.includes("already in use") ||
      message.includes("already initialized") ||
      message.includes("custom program error: 0x0")
    ) {
      console.log(`Comp-def already initialized for ${params.circuit}: ${compDefAccount.toBase58()}`);
    } else {
      throw error;
    }
  }

  const existingCompDef = await (params.arciumProgram.account as any).computationDefinitionAccount.fetch(
    compDefAccount
  );
  if (isCompDefCompleted(existingCompDef)) {
    validateCompDefAgainstExpected(params.circuit, compDefAccount, existingCompDef);
    const actual = readCompDefSignature(existingCompDef);
    console.log(
      `Comp-def already finalized for ${params.circuit} (params=${actual.params}, outputs=${actual.outputs}, circuit_len=${actual.circuitLen ?? "n/a"})`
    );
    return;
  }

  try {
    const circuitPath = resolveCircuitArtifactPath(params.circuit);

    if (circuitPath) {
      const rawCircuit = new Uint8Array(fs.readFileSync(circuitPath));
      const requiredSize = rawCircuit.length + 9;
      const rawCircuitIndex = 0;
      const rawCircuitPda = getRawCircuitAccAddress(compDefAccount, rawCircuitIndex);
      const existingRawCircuit = await provider.connection.getAccountInfo(rawCircuitPda);

      if (existingRawCircuit) {
        // Pre-grow existing raw circuit accounts using smaller transactions. Missing
        // raw accounts must be initialized by uploadCircuit before they can grow.
        await growRawCircuitAccount(
          provider,
          compDefAccount,
          offset,
          params.mxeProgramId,
          rawCircuitIndex,
          requiredSize,
          { skipPreflight: true, commitment: "confirmed" }
        );

        const uploadSigs = await uploadRawCircuitSequential({
          provider,
          arciumProgram: params.arciumProgram,
          payer: params.payerKeypair,
          compDefOffset: offset,
          mxeProgramId: params.mxeProgramId,
          rawCircuitIndex,
          rawCircuit,
          label: params.circuit,
        });
        console.log(
          `Uploaded/finalized ${params.circuit} circuit from ${path.basename(circuitPath)} (${uploadSigs.length} txs, sequential).`
        );
        return;
      }

      const uploadChunkSize = readUploadChunkSize();
      const uploadSigs = await uploadCircuit(
        provider,
        params.circuit,
        params.mxeProgramId,
        rawCircuit,
        true,
        uploadChunkSize,
        { skipPreflight: true, commitment: "confirmed" }
      );
      console.log(
        `Uploaded/finalized ${params.circuit} circuit from ${path.basename(circuitPath)} (${uploadSigs.length} txs, chunk=${uploadChunkSize}).`
      );
    } else {
      const finalizeTx = await buildFinalizeCompDefTx(provider, offset, params.mxeProgramId);
      const signature = await provider.sendAndConfirm(finalizeTx, []);
      console.log(`Finalized ${params.circuit} comp-def. Tx: ${signature}`);
    }
  } catch (error: any) {
    const message = String(error?.message || error);
    const lamportShortfall = describeLamportShortfall(error);
    if (
      message.includes("already completed") ||
      message.includes("already finalized") ||
      message.includes("Computation definition already completed")
    ) {
      console.log(`Comp-def already finalized for ${params.circuit}`);
    } else if (
      message.includes("comp_def_raw") ||
      message.includes("AccountOwnedByWrongProgram")
    ) {
      console.warn(
        `Skipped finalization for ${params.circuit}: raw circuit is not uploaded yet. ` +
          `Run 'arcium build' to generate build/${params.circuit}.arcis (preferred), then rerun this script.`
      );
    } else if (lamportShortfall) {
      throw new Error(
        `Insufficient SOL while uploading ${params.circuit}: ${lamportShortfall}. ` +
          `Fund ${params.payer.toBase58()} on devnet, then rerun this script.`
      );
    } else {
      throw error;
    }
  }

  const refreshed = await (params.arciumProgram.account as any).computationDefinitionAccount.fetch(
    compDefAccount
  );
  if (isCompDefCompleted(refreshed)) {
    validateCompDefAgainstExpected(params.circuit, compDefAccount, refreshed);
  }
}

export async function initCompDefs(args: InitArgs): Promise<void> {
  const walletPath = resolveWalletPath();
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
  const rpcSelection = await resolveRpcEndpoint({
    preferred: args.rpcUrl,
    commitment: "confirmed",
  });
  const connection = new Connection(rpcSelection.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(walletKeypair), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const shadowIdl = fetchShadowIdl(args.programId);
  const shadowProgram = new anchor.Program(shadowIdl as anchor.Idl, provider);
  const market = await (shadowProgram.account as any).market.fetch(args.market);

  if (market.authority.toBase58() !== walletKeypair.publicKey.toBase58()) {
    throw new Error(
      `Wallet ${walletKeypair.publicKey.toBase58()} is not market authority (${market.authority.toBase58()}).`
    );
  }

  const expectedCluster = getClusterAccAddress(args.clusterOffset);
  const marketCluster: PublicKey = market.mxeCluster ?? market.mxe_cluster;
  if (marketCluster && marketCluster.toBase58() !== expectedCluster.toBase58()) {
    console.warn(
      `Market mxe_cluster is ${marketCluster.toBase58()}, but cluster offset ${args.clusterOffset} maps to ${expectedCluster.toBase58()}.`
    );
  }

  const mxeAccount = getMXEAccAddress(args.mxeProgramId);
  const lutOffset = await ensureMxeInitialized(
    provider,
    connection,
    args.mxeProgramId,
    args.clusterOffset
  );
  const addressLookupTable = getLookupTableAddress(args.mxeProgramId, lutOffset);

  console.log("Program:", args.programId.toBase58());
  console.log("Market:", args.market.toBase58());
  console.log("Arcium Program:", args.arciumProgramId.toBase58());
  console.log("MXE Program:", args.mxeProgramId.toBase58());
  console.log("RPC:", rpcSelection.rpcUrl);
  console.log("Cluster Offset:", args.clusterOffset);
  console.log("MXE Account:", mxeAccount.toBase58());
  console.log("Address Lookup Table:", addressLookupTable.toBase58());
  const arciumProgram = getArciumProgram(provider);

  for (const def of COMP_DEFS) {
    await ensureCompDef(shadowProgram, provider, {
      methodName: def.methodName,
      circuit: def.circuit,
      payer: walletKeypair.publicKey,
      authority: walletKeypair.publicKey,
      market: args.market,
      mxeAccount,
      addressLookupTable,
      arciumProgramId: args.arciumProgramId,
      mxeProgramId: args.mxeProgramId,
      arciumProgram: arciumProgram,
      payerKeypair: walletKeypair,
    });
  }

  const refreshedMarket = await (shadowProgram.account as any).market.fetch(args.market);
  console.log("\nUpdated market comp-defs:");
  const openCompDefPk =
    refreshedMarket.openPositionCompDef ?? refreshedMarket.open_position_comp_def;
  const closeCompDefPk =
    refreshedMarket.closePositionCompDef ?? refreshedMarket.close_position_comp_def;
  const liqCompDefPk =
    refreshedMarket.liquidationCompDef ?? refreshedMarket.liquidation_comp_def;
  const seedOiCompDefPk =
    refreshedMarket.seedOpenInterestCompDef ?? refreshedMarket.seed_open_interest_comp_def;
  console.log("open_position_probe_b:", openCompDefPk.toBase58());
  console.log("close_position_v3:", closeCompDefPk.toBase58());
  console.log("check_liquidation_v2:", liqCompDefPk.toBase58());
  console.log("seed_open_interest_state_v3:", seedOiCompDefPk.toBase58());

  // Include all circuits (including those not stored on market account)
  const allCircuits = [
    "open_position_probe_b",
    "close_position_v3",
    "check_liquidation_v2",
    "seed_open_interest_state_v3",
    "execute_private_order",
    "open_position_tuple_probe_v1",
    "open_position_tuple_probe_u8_v1",
    "open_position_margin_probe_v1",
    "open_position_full_probe_v1",
  ];
  const arciumProg = getArciumProgram(provider);
  console.log("\nComputation definition completion:");
  for (const circuit of allCircuits) {
    const offset = readCompDefOffset(circuit);
    const compDefPk = getCompDefAccAddress(args.mxeProgramId, offset);
    try {
      const account = await (arciumProg.account as any).computationDefinitionAccount.fetch(compDefPk);
      const isCompleted = isCompDefCompleted(account);
      console.log(`- ${circuit}: ${isCompleted ? "completed" : "pending upload/finalize"}`);
    } catch {
      console.log(`- ${circuit}: not initialized`);
    }
  }
}

async function main() {
  loadEnvFile(path.resolve(__dirname, "..", "app", ".env.local"));
  const args = parseArgs();
  await initCompDefs(args);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("init-comp-defs failed:", error);
    process.exit(1);
  });
}
