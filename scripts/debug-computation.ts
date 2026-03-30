/**
 * Debug a computation account's raw data to understand abort reason.
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import {
  getArciumProgram,
  getComputationAccAddress,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

async function main() {
  const rpcUrl = readArg("rpc") || "https://cool-boldest-yard.solana-devnet.quiknode.pro/3513dd000b0bf11aae344e55c52d9281969d0808";
  const compAddr = readArg("address");
  if (!compAddr) {
    console.error("Usage: --address <computation account pubkey>");
    process.exit(1);
  }

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

  const pubkey = new PublicKey(compAddr);
  console.log(`Computation account: ${pubkey.toBase58()}\n`);

  // Raw account data
  const info = await connection.getAccountInfo(pubkey);
  if (!info) {
    console.error("Account not found");
    return;
  }
  console.log(`Size: ${info.data.length} bytes`);
  console.log(`Owner: ${info.owner.toBase58()}`);

  // Hex dump first 200 bytes
  const hexDump = Buffer.from(info.data).toString("hex");
  console.log(`\nRaw data (first 400 hex chars):`);
  for (let i = 0; i < Math.min(hexDump.length, 400); i += 64) {
    console.log(`  ${i/2}: ${hexDump.slice(i, i + 64)}`);
  }

  // Try to decode via Arcium program
  const arciumProgram = getArciumProgram(provider);
  try {
    const comp = await (arciumProgram.account as any).computation.fetch(pubkey);
    console.log("\nDecoded computation:");
    for (const [key, value] of Object.entries(comp)) {
      const valStr = value instanceof PublicKey ? value.toBase58() :
        value instanceof Uint8Array ? Buffer.from(value).toString("hex").slice(0, 40) + "..." :
        typeof value === 'object' ? JSON.stringify(value) : String(value);
      console.log(`  ${key}: ${valStr.slice(0, 120)}`);
    }
  } catch (e: any) {
    console.log("\nCould not decode as computation:", e.message?.slice(0, 200));
  }

  // Check transaction logs
  console.log("\nTransactions:");
  const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 10 });
  for (const s of sigs) {
    const status = s.err ? `FAILED: ${JSON.stringify(s.err)}` : "OK";
    const time = s.blockTime ? new Date(s.blockTime * 1000).toISOString() : "?";
    console.log(`  ${s.signature.slice(0, 50)}... ${status} (${time})`);

    // Fetch logs for the OK ones (to see what happened)
    if (!s.err) {
      try {
        const tx = await connection.getTransaction(s.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        });
        if (tx?.meta?.logMessages) {
          const relevantLogs = tx.meta.logMessages.filter(
            (l) => l.includes("Instruction:") || l.includes("log:") || l.includes("data:")
          );
          for (const log of relevantLogs.slice(0, 5)) {
            console.log(`    ${log}`);
          }
        }
      } catch {}
    }
  }
}

main().catch((err) => {
  console.error("Debug failed:", err);
  process.exit(1);
});
