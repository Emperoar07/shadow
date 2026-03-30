/**
 * Update the stored Pyth feed ID on a market account.
 * Authority-only — must be signed by the market authority.
 *
 * Usage:
 *   npx ts-node scripts/set-pyth-feed-id.ts --pair ORCA-USD
 *   npx ts-node scripts/set-pyth-feed-id.ts --pair ORCA-USD --rpc <URL>
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
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
  if (!found) throw new Error("IDL not found");
  const idl = JSON.parse(fs.readFileSync(found, "utf8"));
  idl.address = PROGRAM_ID.toBase58();
  return idl;
}

async function main() {
  const rpcArg =
    process.argv.find((a) => a.startsWith("--rpc="))?.split("=")[1] ||
    process.argv[process.argv.indexOf("--rpc") + 1] ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL;

  const pairLabel =
    process.argv.find((a) => a.startsWith("--pair="))?.split("=")[1] ||
    (process.argv.includes("--pair")
      ? process.argv[process.argv.indexOf("--pair") + 1]
      : undefined);

  const targetPairs = pairLabel
    ? TRADING_PAIRS.filter((p) => p.label === pairLabel)
    : TRADING_PAIRS;

  if (!targetPairs.length) {
    console.error(`No pair matching: ${pairLabel}`);
    process.exit(1);
  }

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

  for (const pair of targetPairs) {
    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), COLLATERAL_MINT.toBuffer(), pair.base.mint.toBuffer()],
      PROGRAM_ID
    );
    process.stdout.write(`[${pair.label}] market=${marketPda.toBase58()} feed=${pair.pythFeedId.slice(0, 10)}... `);
    try {
      const tx = await (program.methods as any)
        .setPythFeedId(pair.pythFeedId)
        .accounts({
          authority: walletKeypair.publicKey,
          market: marketPda,
        })
        .rpc({ commitment: "confirmed" });
      console.log(`updated tx=${tx.slice(0, 16)}...`);
    } catch (err: any) {
      console.error(`FAILED: ${String(err?.message || err).split("\n")[0]}`);
    }
  }
}

main().catch((err) => {
  console.error("set-pyth-feed-id failed:", err);
  process.exit(1);
});
