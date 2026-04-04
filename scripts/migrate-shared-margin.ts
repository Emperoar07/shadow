import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { resolveRpcEndpoint, retryRpcCall, sendAndConfirmWithPolling } from "./rpc";
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
  const candidates = [
    path.resolve(process.cwd(), "target", "idl", "shadowperp.json"),
    path.resolve(process.cwd(), "app", "src", "idl", "shadowperp.json"),
  ];
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) throw new Error("IDL not found in target/idl or app/src/idl");
  const idl = JSON.parse(fs.readFileSync(found, "utf8"));
  idl.address = PROGRAM_ID.toBase58();
  return idl;
}

function deriveMarketPda(baseAssetMint: PublicKey): PublicKey {
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), COLLATERAL_MINT.toBuffer(), baseAssetMint.toBuffer()],
    PROGRAM_ID
  );
  return marketPda;
}

async function main() {
  const rpcArg =
    process.argv.find((arg) => arg.startsWith("--rpc="))?.split("=")[1] ||
    process.argv[process.argv.indexOf("--rpc") + 1] ||
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

  const owner = walletKeypair.publicKey;
  const [globalMarginAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("margin"), owner.toBuffer()],
    PROGRAM_ID
  );

  console.log(`RPC: ${rpcSelection.rpcUrl}`);
  console.log(`Owner: ${owner.toBase58()}`);
  console.log(`Global margin: ${globalMarginAccount.toBase58()}`);
  console.log("");

  for (const pair of TRADING_PAIRS) {
    const market = deriveMarketPda(pair.base.mint);
    const marketAccount = await retryRpcCall<any | null>(
      `[${pair.label}] fetch market`,
      () => (program.account as any).market.fetchNullable(market)
    );
    if (!marketAccount) {
      console.log(`[${pair.label}] market missing, skipping`);
      continue;
    }

    const [legacyMarginAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("margin"), market.toBuffer(), owner.toBuffer()],
      PROGRAM_ID
    );
    const legacyMargin = await retryRpcCall<any | null>(
      `[${pair.label}] fetch legacy margin`,
      () => (program.account as any).marginAccount.fetchNullable(legacyMarginAccount)
    );
    if (!legacyMargin) {
      console.log(`[${pair.label}] no legacy margin account`);
      continue;
    }

    if (Number(legacyMargin.balance) === 0 && Number(legacyMargin.lockedBalance) === 0) {
      console.log(`[${pair.label}] no legacy balance to migrate`);
      continue;
    }

    if (Number(legacyMargin.lockedBalance) > 0) {
      console.log(`[${pair.label}] locked balance present, settle/close positions first`);
      continue;
    }

    const sharedVault = new PublicKey(marketAccount.vault);

    process.stdout.write(`[${pair.label}] migrating legacy margin... `);
    const tx = await (program.methods as any)
      .migrateLegacyMarginAccount()
      .accounts({
        owner,
        market,
        legacyMarginAccount,
        globalMarginAccount,
        sharedVault,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    const sig = await sendAndConfirmWithPolling(connection, walletKeypair, tx, {
      commitment: "confirmed",
    });
    console.log(`ok ${sig.slice(0, 18)}...`);
  }
}

main().catch((error) => {
  console.error("migrate-shared-margin failed:", error);
  process.exit(1);
});
