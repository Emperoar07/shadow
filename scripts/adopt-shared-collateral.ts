import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { resolveRpcEndpoint, retryRpcCall, sendAndConfirmWithPolling } from "./rpc";
import { TRADING_PAIRS } from "../app/src/lib/tokens";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ||
    "DBshVTiQcB76wVpS6tLuSXuECZJ6LjqPQajxhEaCyDSD"
);
const COLLATERAL_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_SHADOWPERP_COLLATERAL_MINT ||
    "DbF1Z21WCTbcx5feBB9LNkhtqRE99DZt9ENJT79prHc6"
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

  const [sharedVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("shared_vault"), COLLATERAL_MINT.toBuffer()],
    PROGRAM_ID
  );
  const [sharedVaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("shared_vault_authority"), COLLATERAL_MINT.toBuffer()],
    PROGRAM_ID
  );

  console.log(`RPC: ${rpcSelection.rpcUrl}`);
  console.log(`Authority: ${walletKeypair.publicKey.toBase58()}`);
  console.log(`Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`Shared vault: ${sharedVault.toBase58()}`);
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

    const [legacyVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), market.toBuffer()],
      PROGRAM_ID
    );

    const currentVault = new PublicKey(marketAccount.vault);
    if (currentVault.equals(sharedVault)) {
      console.log(`[${pair.label}] already adopted`);
      continue;
    }

    process.stdout.write(`[${pair.label}] adopting shared vault... `);
    const tx = await (program.methods as any)
      .adoptSharedCollateralVault()
      .accounts({
        authority: walletKeypair.publicKey,
        market,
        collateralMint: COLLATERAL_MINT,
        legacyVault,
        sharedVault,
        sharedVaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .transaction();

    const sig = await sendAndConfirmWithPolling(connection, walletKeypair, tx, {
      commitment: "confirmed",
    });

    console.log(`ok ${sig.slice(0, 18)}...`);
  }
}

main().catch((error) => {
  console.error("adopt-shared-collateral failed:", error);
  process.exit(1);
});
