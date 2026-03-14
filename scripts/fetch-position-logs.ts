/**
 * Fetch full tx logs for all recent transactions on a position PDA.
 * Usage: npx ts-node scripts/fetch-position-logs.ts --rpc <url> --index <n>
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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
  const posIndex = parseInt(readArg("index") || "1", 10);

  const walletPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );

  const connection = new Connection(rpcUrl, "confirmed");

  const indexBuf = Buffer.alloc(8);
  indexBuf.writeBigUInt64LE(BigInt(posIndex));
  const [posPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), MARKET.toBuffer(), wallet.publicKey.toBuffer(), indexBuf],
    PROGRAM_ID
  );

  console.log(`Position PDA: ${posPda.toBase58()}`);
  console.log(`Index: ${posIndex}\n`);

  const sigs = await connection.getSignaturesForAddress(posPda, { limit: 10 });

  for (const s of sigs) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Sig: ${s.signature}`);
    console.log(`Error: ${s.err ? JSON.stringify(s.err) : "none"}`);
    console.log(`Time: ${s.blockTime ? new Date(s.blockTime * 1000).toISOString() : "?"}`);

    try {
      const tx = await connection.getTransaction(s.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      if (tx?.meta?.logMessages) {
        console.log("Logs:");
        for (const log of tx.meta.logMessages) {
          console.log(`  ${log}`);
        }
      }
    } catch (e: any) {
      console.log(`  Could not fetch tx details: ${e.message}`);
    }
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
