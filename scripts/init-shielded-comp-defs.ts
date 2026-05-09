/**
 * Init comp-defs for shielded-collateral circuits:
 *  - lock_margin_private
 *  - settle_private_position
 *
 * Run after deploying the program with --features shielded-collateral.
 */
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
  getCompDefAccAddress,
  getCompDefAccOffset,
  getLookupTableAddress,
  getMXEAccAddress,
  uploadCircuit,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveRpcEndpoint } from "./rpc";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ||
    "DBshVTiQcB76wVpS6tLuSXuECZJ6LjqPQajxhEaCyDSD"
);
const ARCIUM_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_ARCIUM_PROGRAM_ID || getArciumProgramId()
);
const CLUSTER_OFFSET = Number(
  process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET || "456"
);

const COLLATERAL_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_MOCKUSDC_MINT ||
  process.env.NEXT_PUBLIC_SHADOWPERP_COLLATERAL_MINT ||
    "DbF1Z21WCTbcx5feBB9LNkhtqRE99DZt9ENJT79prHc6"
);
const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");


const SHIELDED_CIRCUITS = [
  {
    circuit: "lock_margin_private",
    methodName: "initLockMarginPrivateCompDef",
  },
  {
    circuit: "settle_private_position",
    methodName: "initSettlePrivatePositionCompDef",
  },
] as const;

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
  if (!found) throw new Error("IDL not found in target/idl or app/src/idl");
  const idl = JSON.parse(fs.readFileSync(found, "utf8"));
  idl.address = PROGRAM_ID.toBase58();
  return idl;
}

function readCompDefOffset(circuit: string): number {
  return Buffer.from(getCompDefAccOffset(circuit)).readUInt32LE(0);
}

function isCompDefCompleted(account: any): boolean {
  const onchainCompleted =
    account?.circuitSource?.onChain?.[0]?.isCompleted ??
    account?.circuitSource?.onChain?.isCompleted ??
    account?.circuit_source?.on_chain?.[0]?.is_completed ??
    account?.circuit_source?.on_chain?.is_completed ??
    false;
  const offchainSource =
    account?.circuitSource?.offChain ??
    account?.circuit_source?.off_chain ??
    account?.circuitSource?.OffChain ??
    account?.circuit_source?.OffChain;
  return Boolean(onchainCompleted || offchainSource);
}

async function ensureShieldedCompDef(
  program: any,
  provider: anchor.AnchorProvider,
  arciumProgram: any,
  mxeAccount: PublicKey,
  addressLookupTable: PublicKey,
  circuit: string,
  methodName: string,
  marketPda: PublicKey
): Promise<void> {
  const offset = readCompDefOffset(circuit);
  const compDefAccount = getCompDefAccAddress(PROGRAM_ID, offset);

  console.log(`\n[${circuit}]`);
  console.log(`  comp-def PDA: ${compDefAccount.toBase58()}`);
  console.log(`  market PDA:   ${marketPda.toBase58()}`);

  // Try init (idempotent).
  // The on-chain struct requires `market` but the IDL (generated without
  // --features shielded-collateral) omits it. Inject it via remainingAccounts
  // so Anchor passes it through without trying to resolve it from the IDL.
  try {
    await (program.methods as any)
      [methodName]()
      .accounts({
        payer: provider.wallet.publicKey,
        market: marketPda,
        authority: provider.wallet.publicKey,
        mxeAccount,
        compDefAccount,
        addressLookupTable,
        lutProgram: new PublicKey("AddressLookupTab1e1111111111111111111111111"),
        arciumProgram: ARCIUM_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  Initialized comp-def`);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (
      msg.includes("already in use") ||
      msg.includes("already initialized") ||
      msg.includes("custom program error: 0x0")
    ) {
      console.log(`  Comp-def already initialized`);
    } else {
      throw err;
    }
  }

  // Check if already finalized
  const existing = await (arciumProgram.account as any).computationDefinitionAccount.fetch(
    compDefAccount
  );
  if (isCompDefCompleted(existing)) {
    console.log(`  Already finalized — skipping upload`);
    return;
  }

  // Upload circuit artifact
  const arcisPath = path.resolve(process.cwd(), "build", `${circuit}.arcis`);
  if (!fs.existsSync(arcisPath)) {
    throw new Error(`Circuit artifact not found: ${arcisPath}. Run 'arcium build' first.`);
  }

  console.log(`  Uploading ${circuit}.arcis (${fs.statSync(arcisPath).size} bytes)...`);
  const rawCircuit = new Uint8Array(fs.readFileSync(arcisPath));
  const uploadSigs = await uploadCircuit(
    provider,
    circuit,
    PROGRAM_ID,
    rawCircuit,
    true
  );
  console.log(`  Uploaded and finalized (${uploadSigs.length} txs)`);

  const refreshed = await (arciumProgram.account as any).computationDefinitionAccount.fetch(
    compDefAccount
  );
  console.log(`  Finalized: ${isCompDefCompleted(refreshed)}`);
}

async function main() {
  const rpcArg = process.argv.find((a) => a.startsWith("--rpc="))?.split("=")[1] ||
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
  const arciumProgram = getArciumProgram(provider);

  const mxeAccount = getMXEAccAddress(PROGRAM_ID);
  const mxe = await (arciumProgram.account as any).mxeAccount.fetch(mxeAccount);
  const lutOffset = mxe.lutOffsetSlot ?? mxe.lut_offset_slot;
  const addressLookupTable = getLookupTableAddress(PROGRAM_ID, lutOffset);

  console.log(`RPC: ${rpcSelection.rpcUrl}`);
  console.log(`Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`MXE Account: ${mxeAccount.toBase58()}`);
  console.log(`Address Lookup Table: ${addressLookupTable.toBase58()}`);

  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), COLLATERAL_MINT.toBuffer(), SOL_MINT.toBuffer()],
    PROGRAM_ID
  );
  console.log(`Market PDA: ${marketPda.toBase58()}`);

  for (const { circuit, methodName } of SHIELDED_CIRCUITS) {
    await ensureShieldedCompDef(
      program,
      provider,
      arciumProgram,
      mxeAccount,
      addressLookupTable,
      circuit,
      methodName,
      marketPda
    );
  }

  console.log("\nDone. Both shielded comp-defs initialized and finalized.");
}

main().catch((err) => {
  console.error("init-shielded-comp-defs failed:", err);
  process.exit(1);
});
