/**
 * Check position + fetch logs from failed callback transactions.
 * Usage: npx ts-node scripts/check-position-logs.ts --rpc <url> [--index 0]
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const PROGRAM_ID = new PublicKey("5Va2JgK2M2kwkoPdwX4RTjfaqwAXgd5hHSWEP5QS848T");
const MARKET = new PublicKey("GUpRFdAG6QD4athYD7CtPN54yqgC2xt2UH5pYeVyXo6Z");

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

async function main() {
  const rpcUrl = readArg("rpc") || "https://devnet.helius-rpc.com/?api-key=b077c7fc-8625-488f-93fd-1daf8de886c1";
  const posPda = new PublicKey("FTLzGK7enerizMYKfkNWsaz28As8ZjwHWuC81wF8PF6P");

  const walletPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );

  const connection = new Connection(rpcUrl, "confirmed");

  console.log(`Position PDA: ${posPda.toBase58()}\n`);

  // Get all signatures
  const sigs = await connection.getSignaturesForAddress(posPda, { limit: 10 });

  for (const s of sigs) {
    const status = s.err ? `FAILED` : "OK";
    console.log(`\n--- TX: ${s.signature} (${status}) ---`);

    if (s.err) {
      console.log(`Error: ${JSON.stringify(s.err)}`);
    }

    try {
      const tx = await connection.getTransaction(s.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      if (tx?.meta?.logMessages) {
        console.log("Logs:");
        for (const log of tx.meta.logMessages) {
          console.log("  " + log);
        }
      }
    } catch (e: any) {
      console.log("  Could not fetch tx:", e.message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
