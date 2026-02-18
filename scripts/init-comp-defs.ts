import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  clusterApiUrl,
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
  initMxePart1,
  initMxePart2,
  uploadCircuit,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";

type InitArgs = {
  programId: PublicKey;
  market: PublicKey;
  rpcUrl: string;
  arciumProgramId: PublicKey;
  mxeProgramId: PublicKey;
  clusterOffset: number;
};

const DEFAULT_CLUSTER_OFFSET = 456;

const COMP_DEFS = [
  {
    circuit: "open_position",
    methodName: "initOpenPositionCompDef",
    marketField: "openPositionCompDef",
  },
  {
    circuit: "close_position",
    methodName: "initClosePositionCompDef",
    marketField: "closePositionCompDef",
  },
  {
    circuit: "check_liquidation",
    methodName: "initLiquidationCompDef",
    marketField: "liquidationCompDef",
  },
] as const;

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
    readArg("rpc") || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("devnet");

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
  const raw = execSync(`anchor idl fetch ${programId.toBase58()}`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const idl = JSON.parse(raw);
  idl.address = programId.toBase58();
  return idl;
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

  try {
    const circuitPath = path.resolve(process.cwd(), "build", `${params.circuit}.arcis`);
    if (fs.existsSync(circuitPath)) {
      const rawCircuit = new Uint8Array(fs.readFileSync(circuitPath));
      const uploadSigs = await uploadCircuit(
        provider,
        params.circuit,
        params.mxeProgramId,
        rawCircuit,
        true
      );
      console.log(
        `Uploaded/finalized ${params.circuit} circuit (${uploadSigs.length} txs).`
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
          `Run 'arcium build' to generate build/${params.circuit}.arcis, then rerun this script.`
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
}

export async function initCompDefs(args: InitArgs): Promise<void> {
  const walletPath = resolveWalletPath();
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
  const connection = new Connection(args.rpcUrl, "confirmed");
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
  console.log("Cluster Offset:", args.clusterOffset);
  console.log("MXE Account:", mxeAccount.toBase58());
  console.log("Address Lookup Table:", addressLookupTable.toBase58());

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
  console.log("open_position:", openCompDefPk.toBase58());
  console.log("close_position:", closeCompDefPk.toBase58());
  console.log("check_liquidation:", liqCompDefPk.toBase58());

  const arciumProgram = getArciumProgram(provider);
  const compDefs = [
    { label: "open_position", pk: openCompDefPk },
    { label: "close_position", pk: closeCompDefPk },
    { label: "check_liquidation", pk: liqCompDefPk },
  ];
  console.log("\nComputation definition completion:");
  for (const comp of compDefs) {
    const account = await (arciumProgram.account as any).computationDefinitionAccount.fetch(
      comp.pk
    );
    const isCompleted =
      account?.circuitSource?.onChain?.[0]?.isCompleted ??
      account?.circuit_source?.on_chain?.[0]?.is_completed ??
      false;
    console.log(`- ${comp.label}: ${isCompleted ? "completed" : "pending upload/finalize"}`);
  }
}

async function main() {
  const args = parseArgs();
  await initCompDefs(args);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("init-comp-defs failed:", error);
    process.exit(1);
  });
}
