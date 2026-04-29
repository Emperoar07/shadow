/**
 * Check position + fetch logs from failed callback transactions.
 * Usage: npx ts-node scripts/check-position-logs.ts --rpc <url> [--index 0]
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const PROGRAM_ID = new PublicKey("34wszdEvGvyAVADY7ozpbdAvAB9zHRBTaT1YsNcpRJdo");
const MARKET = new PublicKey("uGdPR4kmFWR3HwJ8esEjbeMwnuBKVD7oA9ENRv32uvy");

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

async function main() {
  const rpcUrl = readArg("rpc") || "https://cool-boldest-yard.solana-devnet.quiknode.pro/3513dd000b0bf11aae344e55c52d9281969d0808";
  const posIndex = parseInt(readArg("index") || "0", 10);

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
