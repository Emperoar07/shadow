/**
 * Full market bootstrap for all 6 trading pairs.
 *
 * Phase 1: Create market PDAs (skips existing)
 * Phase 2: init_*_comp_def instructions per market (registers comp-defs on new markets)
 * Phase 3: sync_comp_defs — stamps global comp-def addresses onto each market account
 *
 * Safe to re-run.
 *
 * Usage:
 *   npx ts-node scripts/init-all-markets.ts
 *   npx ts-node scripts/init-all-markets.ts --rpc <URL>
 *   npx ts-node scripts/init-all-markets.ts --skip-comp-defs   # Phase 1 only
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  getArciumProgramId,
  getClusterAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveRpcEndpoint } from "./rpc";
import { TRADING_PAIRS } from "../app/src/lib/tokens";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ||
    "ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4"
);
const COLLATERAL_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_SHADOWPERP_COLLATERAL_MINT ||
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);
const ARCIUM_CLUSTER_OFFSET = Number(
  process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET || "456"
);
const MXE_CLUSTER = getClusterAccAddress(ARCIUM_CLUSTER_OFFSET);

const MAX_LEVERAGE = 50;
const LIQUIDATION_THRESHOLD = 500;
const TRADING_FEE = 10;

// Comp-def circuit names → init method names
const COMP_DEFS = [
  { circuit: "open_position_probe_b", method: "initOpenPositionCompDef" },
  { circuit: "close_position_v2",      method: "initClosePositionCompDef" },
  { circuit: "check_liquidation_v2",    method: "initLiquidationCompDef" },
  { circuit: "seed_open_interest_state_v3", method: "initSeedOpenInterestCompDef" },
] as const;

function readFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function readArg(name: string): string | undefined {
  const key = `--${name}`;
  const i = process.argv.indexOf(key);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  const prefixed = process.argv.find((a) => a.startsWith(`${key}=`));
  return prefixed ? prefixed.slice(key.length + 1) : undefined;
}

function resolveWalletPath(): string {
  const env = process.env.SOLANA_WALLET;
  if (env && fs.existsSync(env)) return env;
  const def = path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(def)) throw new Error(`Wallet not found: ${def}`);
  return def;
}

function fetchLocalIdl(): any {
  const candidates = [
    path.resolve(process.cwd(), "target", "idl", "shadowperp.json"),
    path.resolve(process.cwd(), "app", "src", "idl", "shadowperp.json"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error("IDL not found in target/idl or app/src/idl");
  const idl = JSON.parse(fs.readFileSync(found, "utf8"));
  idl.address = PROGRAM_ID.toBase58();
  return idl;
}

function deriveMarketPda(baseAssetMint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), COLLATERAL_MINT.toBuffer(), baseAssetMint.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

function getCompDefPda(circuit: string): PublicKey {
  const offset = Buffer.from(getCompDefAccOffset(circuit)).readUInt32LE(0);
  return getCompDefAccAddress(PROGRAM_ID, offset);
}

async function initMarket(
  program: anchor.Program,
  connection: Connection,
  walletKeypair: Keypair,
  pair: (typeof TRADING_PAIRS)[number]
): Promise<{ pda: PublicKey; created: boolean }> {
  const baseAssetMint = pair.base.mint;
  const marketPda = deriveMarketPda(baseAssetMint);

  process.stdout.write(`  [${pair.label}] market=${marketPda.toBase58().slice(0, 12)}... `);

  const existing = await connection.getAccountInfo(marketPda);
  if (existing !== null) {
    console.log("already exists");
    return { pda: marketPda, created: false };
  }

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shared_vault"), COLLATERAL_MINT.toBuffer()],
    PROGRAM_ID
  );
  const [sharedVaultAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shared_vault_authority"), COLLATERAL_MINT.toBuffer()],
    PROGRAM_ID
  );

  try {
    const tx = await (program.methods as any)
      .initialize(MAX_LEVERAGE, LIQUIDATION_THRESHOLD, TRADING_FEE, pair.pythFeedId)
      .accounts({
        authority: walletKeypair.publicKey,
        market: marketPda,
        collateralMint: COLLATERAL_MINT,
        baseAssetMint,
        vault: vaultPda,
        sharedVaultAuthority: sharedVaultAuthorityPda,
        priceFeeder: walletKeypair.publicKey,
        mxeCluster: MXE_CLUSTER,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc({ commitment: "confirmed" });

    console.log(`created  tx=${tx.slice(0, 16)}...`);
    return { pda: marketPda, created: true };
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes("custom program error: 0x0")) {
      console.log("already initialized");
      return { pda: marketPda, created: false };
    }
    console.error(`FAILED: ${msg.split("\n")[0]}`);
    throw err;
  }
}

async function initCompDefsForMarket(
  program: anchor.Program,
  walletKeypair: Keypair,
  marketPda: PublicKey,
  arciumProgramId: PublicKey
): Promise<void> {
  for (const { circuit, method } of COMP_DEFS) {
    const compDefAccount = getCompDefPda(circuit);
    const fn = (program.methods as any)[method];
    if (!fn) {
      console.log(`    IDL missing ${method}, skipping`);
      continue;
    }
    process.stdout.write(`    ${circuit}... `);
    try {
      await fn()
        .accounts({
          payer: walletKeypair.publicKey,
          market: marketPda,
          authority: walletKeypair.publicKey,
          compDefAccount,
          arciumProgram: arciumProgramId,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
      console.log("ok");
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (
        msg.includes("already in use") ||
        msg.includes("already initialized") ||
        msg.includes("custom program error: 0x0")
      ) {
        console.log("already initialized");
      } else {
        console.log(`skipped (${msg.split("\n")[0]})`);
      }
    }
  }
}

async function syncCompDefs(
  program: anchor.Program,
  walletKeypair: Keypair,
  marketPda: PublicKey,
  label: string
): Promise<void> {
  const openDef   = getCompDefPda("open_position_probe_b");
  const closeDef  = getCompDefPda("close_position_v2");
  const liqDef    = getCompDefPda("check_liquidation_v2");
  const seedDef   = getCompDefPda("seed_open_interest_state_v3");

  process.stdout.write(`  [${label}] sync_comp_defs... `);
  try {
    const tx = await (program.methods as any)
      .syncCompDefs()
      .accounts({
        authority: walletKeypair.publicKey,
        market: marketPda,
        openPositionCompDef: openDef,
        closePositionCompDef: closeDef,
        liquidationCompDef: liqDef,
        seedOpenInterestCompDef: seedDef,
      })
      .rpc({ commitment: "confirmed" });
    console.log(`ok  tx=${tx.slice(0, 16)}...`);
  } catch (err: any) {
    const msg = String(err?.message || err);
    // Already synced — comp-defs fields already set
    if (msg.includes("custom program error: 0x0") || msg.includes("already")) {
      console.log("already synced");
    } else {
      console.error(`FAILED: ${msg.split("\n")[0]}`);
      throw err;
    }
  }
}

async function main() {
  const rpcArg = readArg("rpc") || process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  const skipCompDefs = readFlag("skip-comp-defs");

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

  const arciumProgramId = new PublicKey(
    process.env.NEXT_PUBLIC_ARCIUM_PROGRAM_ID || getArciumProgramId()
  );

  console.log(`\nRPC:        ${rpcSelection.rpcUrl}`);
  console.log(`Wallet:     ${walletKeypair.publicKey.toBase58()}`);
  console.log(`Program:    ${PROGRAM_ID.toBase58()}`);
  console.log(`USDC mint:  ${COLLATERAL_MINT.toBase58()}`);
  console.log(`Cluster:    offset=${ARCIUM_CLUSTER_OFFSET}`);
  console.log(`\nBootstrapping ${TRADING_PAIRS.length} market(s)...\n`);

  const results: { label: string; pda: PublicKey; created: boolean }[] = [];

  // ── Phase 1: create market accounts ────────────────────────────────────
  console.log("=== Phase 1: Market accounts ===");
  for (const pair of TRADING_PAIRS) {
    const { pda, created } = await initMarket(program, connection, walletKeypair, pair);
    results.push({ label: pair.label, pda, created });
  }

  if (skipCompDefs) {
    console.log("\n--skip-comp-defs set. Skipping phases 2 & 3.\n");
  } else {
    // ── Phase 2: init comp-def pointers per market ──────────────────────
    console.log("\n=== Phase 2: Register comp-defs on each market ===");
    for (const { label, pda } of results) {
      console.log(`\n  [${label}]`);
      await initCompDefsForMarket(program, walletKeypair, pda, arciumProgramId);
    }

    // ── Phase 3: sync comp-def addresses into market account ───────────
    console.log("\n=== Phase 3: Sync comp-def addresses into market accounts ===");
    for (const { label, pda } of results) {
      await syncCompDefs(program, walletKeypair, pda, label);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log("\n=== Market PDAs ===");
  for (const { label, pda, created } of results) {
    const tag = created ? "NEW" : "existing";
    console.log(`  ${label.padEnd(12)} ${pda.toBase58()}  [${tag}]`);
  }
}

main().catch((err) => {
  console.error("\ninit-all-markets failed:", err);
  process.exit(1);
});
