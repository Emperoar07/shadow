/**
 * Fetch and display transaction logs for a given signature.
 * Usage: npx ts-node scripts/fetch-tx-logs.ts --rpc <url> --sig <signature>
 */
import { Connection } from "@solana/web3.js";

const rpcIdx = process.argv.indexOf("--rpc");
const sigIdx = process.argv.indexOf("--sig");
const rpcUrl = rpcIdx !== -1 ? process.argv[rpcIdx + 1] : "https://api.devnet.solana.com";
const sig = sigIdx !== -1 ? process.argv[sigIdx + 1] : process.argv[2];

if (!sig) {
  console.error("Usage: npx ts-node scripts/fetch-tx-logs.ts --sig <signature> [--rpc <url>]");
  process.exit(1);
}

(async () => {
  const conn = new Connection(rpcUrl, "confirmed");
  const tx = await conn.getTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  if (!tx) {
    console.error("Transaction not found");
    process.exit(1);
  }
  console.log("Slot:", tx.slot);
  console.log("Error:", tx.meta?.err ? JSON.stringify(tx.meta.err) : "none");
  console.log("\nLogs:");
  for (const log of tx.meta?.logMessages || []) {
    console.log("  " + log);
  }
})();
