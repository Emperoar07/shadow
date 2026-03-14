/**
 * Decode the computation output from a callback transaction.
 * Usage: npx ts-node scripts/decode-callback.ts --rpc <url> --sig <signature>
 */
import { Connection } from "@solana/web3.js";

const rpcIdx = process.argv.indexOf("--rpc");
const sigIdx = process.argv.indexOf("--sig");
const rpcUrl = rpcIdx !== -1 ? process.argv[rpcIdx + 1] : "https://api.devnet.solana.com";
const sig = sigIdx !== -1 ? process.argv[sigIdx + 1] : process.argv[2];

if (!sig) {
  console.error("Usage: npx ts-node scripts/decode-callback.ts --sig <signature> [--rpc <url>]");
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

  // Parse the computation account data
  // Show static account keys (skip address table lookups)
  const staticKeys = tx.transaction.message.staticAccountKeys || [];
  console.log("\nStatic account keys:");
  for (let i = 0; i < staticKeys.length; i++) {
    console.log(`  [${i}]: ${staticKeys[i]?.toBase58()}`);
  }

  // Show logs
  console.log("\nLogs:");
  for (const log of tx.meta?.logMessages || []) {
    console.log("  " + log);
  }

  // Decode any base64 program data events
  console.log("\nProgram data events (decoded):");
  for (const log of tx.meta?.logMessages || []) {
    if (log.startsWith("Program data: ")) {
      const b64 = log.replace("Program data: ", "");
      const bytes = Buffer.from(b64, "base64");
      console.log(`  base64: ${b64}`);
      console.log(`  hex: ${bytes.toString("hex")}`);
      console.log(`  length: ${bytes.length} bytes`);
      // Check for common patterns
      if (bytes.length > 32) {
        const possibleStatus = bytes[32]; // byte after a 32-byte pubkey
        console.log(`  byte[32] (possible status): ${possibleStatus} (0x${possibleStatus.toString(16)})`);
      }
      console.log("");
    }
  }
})();
