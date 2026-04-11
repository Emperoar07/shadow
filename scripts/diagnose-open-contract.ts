import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  SystemProgram,
} from "@solana/web3.js";
import {
  RescueCipher,
  uploadCircuit,
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
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomBytes } from "crypto";
import { resolveRpcEndpoint, sendAndConfirmWithPolling } from "./rpc";

const PROGRAM_ID = new PublicKey("ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4");
const DEFAULT_MARKET = new PublicKey("crEV9TSAU6xkiWFUAZebejHmWVh6VFx5EEFLcfX9L2T");
const CLUSTER_OFFSET = 456;

type ProbeSpec = {
  label: string;
  circuit: string;
  initMethod: string;
  runMethod: string;
  stage: number;
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

function resolveWallet(): Keypair {
  const walletPath =
    process.env.SOLANA_WALLET ||
    path.join(os.homedir(), ".config", "solana", "id.json");
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
}

function parseStatus(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "unknown";
  const key = Object.keys(raw as Record<string, unknown>)[0];
  return key ?? "unknown";
}

function readDiagnosticBool(account: Record<string, unknown>, key: string): boolean {
  const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const value = account[key] ?? account[camelKey];
  return Boolean(value);
}

function isCompDefCompleted(account: Record<string, unknown>): boolean {
  return Boolean(
    account?.circuitSource?.onChain?.[0]?.isCompleted ??
      account?.circuit_source?.on_chain?.[0]?.is_completed
  );
}

function rewriteProbeError(error: unknown, programId: PublicKey): never {
  if (error instanceof SendTransactionError) {
    const logs = error.transactionLogs ?? [];
    const fallbackMissing = logs.some((line) =>
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

async function ensureProbeCompDef(
  program: anchor.Program,
  connection: Connection,
  market: PublicKey,
  wallet: Keypair,
  probe: ProbeSpec
) {
  const offset = Buffer.from(getCompDefAccOffset(probe.circuit)).readUInt32LE(0);
  const compDef = getCompDefAccAddress(PROGRAM_ID, offset);
  const arciumProgramId = new PublicKey(
    process.env.NEXT_PUBLIC_ARCIUM_PROGRAM_ID ||
      "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
  );
  const arciumProgram = await anchor.Program.at(arciumProgramId, program.provider);
  const mxe = await (arciumProgram.account as any).mxeAccount.fetch(
    getMXEAccAddress(PROGRAM_ID)
  );
  const lutOffset = mxe.lutOffsetSlot ?? mxe.lut_offset_slot;
  const addressLookupTable = getLookupTableAddress(PROGRAM_ID, lutOffset);
  const existing = await connection.getAccountInfo(compDef);
  if (!existing) {
    console.log(`  [INIT] ${probe.circuit} comp-def`);
    const methods = (program.methods as any);
    const initMethod = methods?.[probe.initMethod];
    if (!initMethod) {
      throw new Error(`${probe.initMethod} is unavailable in the loaded IDL`);
    }

    const tx = await initMethod()
      .accounts({
        payer: wallet.publicKey,
        market,
        authority: wallet.publicKey,
        mxeAccount: getMXEAccAddress(PROGRAM_ID),
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
      rewriteProbeError(error, PROGRAM_ID);
    }
  } else {
    console.log(`  [OK] ${probe.circuit} comp-def exists: ${compDef.toBase58()}`);
  }

  const compDefAccount = await (arciumProgram.account as any).computationDefinitionAccount.fetch(
    compDef
  );
  if (!isCompDefCompleted(compDefAccount as Record<string, unknown>)) {
    console.log(`  [FINALIZE] ${probe.circuit} comp-def`);
    const circuitPath = path.resolve(__dirname, "..", "build", `${probe.circuit}.arcis`);
    if (!fs.existsSync(circuitPath)) {
      throw new Error(`Missing circuit artifact for ${probe.circuit}: ${circuitPath}`);
    }
    const rawCircuit = new Uint8Array(fs.readFileSync(circuitPath));
    await uploadCircuit(program.provider as anchor.AnchorProvider, probe.circuit, PROGRAM_ID, rawCircuit, true);
  }

  return compDef;
}

async function waitForDiagnostic(
  program: anchor.Program,
  diagnostic: PublicKey,
  timeoutMs = 120_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const account = await (program.account as any).openPositionDiagnostic.fetch(
        diagnostic
      );
      const status = parseStatus(account.status);
      if (status !== "pending") {
        return account;
      }
    } catch {
      // account may not be readable immediately
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`Diagnostic ${diagnostic.toBase58()} did not finalize in time`);
}

async function main() {
  const rpcOverride = readArg("rpc");
  const { rpcUrl, wsUrl } = await resolveRpcEndpoint({ preferred: rpcOverride });
  const wallet = resolveWallet();
  const market = new PublicKey(readArg("market") || DEFAULT_MARKET.toBase58());
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

  const idl = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "target", "idl", "shadowperp.json"), "utf8")
  );
  const program = new anchor.Program(
    { ...idl, address: PROGRAM_ID.toBase58() } as any,
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
  console.log(`Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`Market:  ${market.toBase58()}`);
  console.log(`Owner:   ${wallet.publicKey.toBase58()}`);
  console.log(`RPC:     ${rpcUrl.replace(/\/[a-f0-9]{20,}/, "/***")}`);
  console.log(`WS:      ${wsUrl.replace(/\/[a-f0-9]{20,}/, "/***")}`);

  const mxePubKey = await getMXEPublicKey(provider, PROGRAM_ID);
  if (!mxePubKey) {
    throw new Error("MXE public key unavailable");
  }

  const clientPriv = x25519.utils.randomPrivateKey();
  const clientPub = x25519.getPublicKey(clientPriv);
  const sharedSecret = x25519.getSharedSecret(clientPriv, mxePubKey);
  const cipher = new RescueCipher(sharedSecret);
  const nonceBytes = new Uint8Array(randomBytes(16));
  const nonce = new anchor.BN(Buffer.from(nonceBytes), "le");
  const encrypted = cipher.encrypt(
    [size, entryPrice, leverage, isLong, margin],
    nonceBytes
  ) as unknown as Uint8Array[];
  const [encSize, encEntryPrice, encLeverage, encIsLong, encMargin] =
    encrypted.map((value) => Array.from(Uint8Array.from(value)));

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
      PROGRAM_ID
    );

    await ensureProbeCompDef(program, connection, market, wallet, probe);

    console.log(`\n[RUN] ${probe.label}`);
    const methods = (program.methods as any);
    const runMethod = methods?.[probe.runMethod];
    if (!runMethod) {
      throw new Error(`${probe.runMethod} is unavailable in the loaded IDL`);
    }

    const builder =
      probe.stage === 1
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
        mxeAccount: getMXEAccAddress(PROGRAM_ID),
        compDefAccount: getCompDefAccAddress(
          PROGRAM_ID,
          Buffer.from(getCompDefAccOffset(probe.circuit)).readUInt32LE(0)
        ),
        clusterAccount: marketAccount.mxeCluster,
        mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
        executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
        computationAccount: getComputationAccAddress(CLUSTER_OFFSET, computationOffset),
        poolAccount: getFeePoolAccAddress(),
        signPdaAccount: PublicKey.findProgramAddressSync(
          [Buffer.from("ArciumSignerAccount")],
          PROGRAM_ID
        )[0],
        arciumProgram: new PublicKey(
          process.env.NEXT_PUBLIC_ARCIUM_PROGRAM_ID ||
            "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        ),
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
      rewriteProbeError(error, PROGRAM_ID);
    }

    console.log(`  queued tx: ${signature}`);
    console.log(`  diagnostic: ${diagnostic.toBase58()}`);

    const result = await waitForDiagnostic(program, diagnostic);
    const resultRecord = result as Record<string, unknown>;
    console.log(`  status: ${parseStatus(resultRecord.status)}`);
    console.log(
      `  results: [${readDiagnosticBool(resultRecord, "result_0")}, ${readDiagnosticBool(resultRecord, "result_1")}, ${readDiagnosticBool(resultRecord, "result_2")}, ${readDiagnosticBool(resultRecord, "result_3")}]`
    );
  }
}

main().catch((error) => {
  console.error("diagnose-open-contract failed:", error);
  process.exit(1);
});
