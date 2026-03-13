/**
 * Quick oracle price updater for devnet.
 * Usage: npx ts-node scripts/update-oracle-price.ts --rpc <url> [--price 86.00]
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const PROGRAM_ID = new PublicKey("Fc8SmsvjqDH768HYeAJmHkoEu6xP4FuThJaDaqco3beV");
const MARKET = new PublicKey("G6hRuJxx5ZKrzKNsKkeYqhHonEfvU7GrEtvQ4EMGQzh6");

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

async function main() {
  const rpcUrl = readArg("rpc") || "https://api.devnet.solana.com";
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
  const tx = await program.methods
    .updatePrice(priceLamports)
    .accounts({
      priceFeeder: wallet.publicKey,
      market: MARKET,
    })
    .rpc();

  console.log(`Oracle price updated! Tx: ${tx}`);

  const market = await (program.account as any).market.fetch(MARKET);
  console.log(`New price: $${(Number(market.oraclePrice) / 1e6).toFixed(2)}`);
  console.log(`Updated at: ${new Date(Number(market.lastPriceUpdate) * 1000).toISOString()}`);
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
