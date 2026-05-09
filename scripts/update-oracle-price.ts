/**
 * Quick oracle price updater for devnet.
 * Usage: npx ts-node scripts/update-oracle-price.ts --rpc <url> [--price 86.00]
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const PROGRAM_ID = new PublicKey("DBshVTiQcB76wVpS6tLuSXuECZJ6LjqPQajxhEaCyDSD");
const MARKET = new PublicKey("AwiH92K4RxfhoHpmkiQrwZEBi1ia93x1WrK4uoEchLBJ");

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

async function pollConfirmation(connection: Connection, sig: string, maxRetries = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    const status = await connection.getSignatureStatus(sig);
    const value = status?.value;
    if (value?.confirmationStatus === "confirmed" || value?.confirmationStatus === "finalized") {
      if (value.err) throw new Error(`Transaction failed: ${JSON.stringify(value.err)}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Transaction not confirmed after ${maxRetries * 2}s`);
}

async function main() {
  const rpcUrl = readArg("rpc") || "https://cool-boldest-yard.solana-devnet.quiknode.pro/3513dd000b0bf11aae344e55c52d9281969d0808";
  const priceUsd = parseFloat(readArg("price") || "86.00");
  const priceLamports = new anchor.BN(Math.round(priceUsd * 1_000_000));

  const walletPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );

  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const idlPath = path.resolve(__dirname, "..", "target", "idl", "shadowperp.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const program = new anchor.Program(
    { ...idl, address: PROGRAM_ID.toBase58() } as any,
    provider
  );

  console.log(`Updating oracle price to $${priceUsd.toFixed(2)}...`);

  // Build tx and send raw to avoid WebSocket signatureSubscribe
  const ix = await program.methods
    .updatePrice(priceLamports)
    .accounts({
      priceFeeder: wallet.publicKey,
      market: MARKET,
    })
    .instruction();

  const tx = new anchor.web3.Transaction().add(ix);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(wallet);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  console.log(`Tx sent: ${sig}`);

  await pollConfirmation(connection, sig);
  console.log(`Tx confirmed!`);

  const market = await (program.account as any).market.fetch(MARKET);
  console.log(`New price: $${(Number(market.oraclePrice) / 1e6).toFixed(2)}`);
  console.log(`Updated at: ${new Date(Number(market.lastPriceUpdate) * 1000).toISOString()}`);
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
