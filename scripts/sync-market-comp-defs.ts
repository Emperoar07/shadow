import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getCompDefAccAddress, getCompDefAccOffset } from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveRpcEndpoint } from "./rpc";

type SyncArgs = {
  programId: PublicKey;
  market: PublicKey;
  rpcUrl: string;
  mxeProgramId: PublicKey;
  openCompDef?: PublicKey;
  closeCompDef?: PublicKey;
  liquidationCompDef?: PublicKey;
};

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const key = `--${name}`;
  const index = args.indexOf(key);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

function parsePublicKey(name: string, value?: string): PublicKey {
  if (!value) throw new Error(`Missing --${name}`);
  return new PublicKey(value);
}

function parseArgs(): SyncArgs {
  const programRaw =
    readArg("program") || process.env.SHADOWPERP_PROGRAM_ID || process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID;
  const marketRaw =
    readArg("market") || process.env.SHADOWPERP_MARKET || process.env.NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT;
  if (!programRaw) throw new Error("Missing program id. Pass --program or set NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID.");
  if (!marketRaw) throw new Error("Missing market account. Pass --market or set NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT.");

  const programId = new PublicKey(programRaw);
  const mxeProgramId = new PublicKey(readArg("mxe-program") || process.env.NEXT_PUBLIC_ARCIUM_MXE_PROGRAM_ID || programRaw);
  const rpcUrl = readArg("rpc") || process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "";

  return {
    programId,
    market: new PublicKey(marketRaw),
    rpcUrl,
    mxeProgramId,
    openCompDef: readArg("open-comp-def") ? parsePublicKey("open-comp-def", readArg("open-comp-def")) : undefined,
    closeCompDef: readArg("close-comp-def") ? parsePublicKey("close-comp-def", readArg("close-comp-def")) : undefined,
    liquidationCompDef: readArg("liq-comp-def") ? parsePublicKey("liq-comp-def", readArg("liq-comp-def")) : undefined,
  };
}

function resolveWalletPath(): string {
  if (process.env.SOLANA_WALLET && fs.existsSync(process.env.SOLANA_WALLET)) {
    return process.env.SOLANA_WALLET;
  }
  const fallback = path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(fallback)) {
    throw new Error(`Wallet not found at ${fallback}`);
  }
  return fallback;
}

function resolveIdlPath(): string {
  const candidates = [
    path.resolve(__dirname, "..", "target", "idl", "shadowperp.json"),
    path.resolve(__dirname, "..", "app", "src", "idl", "shadowperp.json"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error("IDL not found at target/idl/shadowperp.json or app/src/idl/shadowperp.json.");
  }
  return found;
}

function deriveCompDef(mxeProgramId: PublicKey, circuit: string): PublicKey {
  const offset = Buffer.from(getCompDefAccOffset(circuit)).readUInt32LE(0);
  return getCompDefAccAddress(mxeProgramId, offset);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(resolveWalletPath(), "utf8")))
  );
  const rpcSelection = await resolveRpcEndpoint({
    preferred: args.rpcUrl,
    commitment: "confirmed",
  });
  const connection = new Connection(rpcSelection.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idlPath = resolveIdlPath();
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  idl.address = args.programId.toBase58();
  const program = new anchor.Program(idl as anchor.Idl, provider);

  const openCompDef = args.openCompDef ?? deriveCompDef(args.mxeProgramId, "open_position_probe_b");
  const closeCompDef = args.closeCompDef ?? deriveCompDef(args.mxeProgramId, "close_position_v2");
  const liqCompDef = args.liquidationCompDef ?? deriveCompDef(args.mxeProgramId, "check_liquidation_v2");
  const seedOiCompDef = deriveCompDef(args.mxeProgramId, "seed_open_interest_state_v3");

  const signature = await (program.methods as any)
    .syncCompDefs()
    .accounts({
      authority: wallet.publicKey,
      market: args.market,
      openPositionCompDef: openCompDef,
      closePositionCompDef: closeCompDef,
      liquidationCompDef: liqCompDef,
      seedOpenInterestCompDef: seedOiCompDef,
    })
    .rpc();

  console.log("sync_comp_defs signature:", signature);
  console.log("rpc:", rpcSelection.rpcUrl);
  console.log("open_position_probe_b:", openCompDef.toBase58());
  console.log("close_position_v2:", closeCompDef.toBase58());
  console.log("check_liquidation_v2:", liqCompDef.toBase58());
  console.log("seed_open_interest_state_v3:", seedOiCompDef.toBase58());
}

main().catch((error) => {
  console.error("sync-market-comp-defs failed:", error);
  process.exit(1);
});
