/**
 * Dump computation account raw data for debugging.
 * Usage: npx ts-node scripts/check-comp-account.ts --rpc <url> --addr <pubkey>
 */
import { Connection, PublicKey } from "@solana/web3.js";

const rpcIdx = process.argv.indexOf("--rpc");
const addrIdx = process.argv.indexOf("--addr");
const rpcUrl = rpcIdx !== -1 ? process.argv[rpcIdx + 1] : "https://cool-boldest-yard.solana-devnet.quiknode.pro/3513dd000b0bf11aae344e55c52d9281969d0808";
const addr = addrIdx !== -1 ? process.argv[addrIdx + 1] : undefined;

if (!addr) {
  console.error("Usage: npx ts-node scripts/check-comp-account.ts --addr <pubkey> [--rpc <url>]");
  process.exit(1);
}

(async () => {
  const conn = new Connection(rpcUrl, "confirmed");
  const pubkey = new PublicKey(addr);
  const info = await conn.getAccountInfo(pubkey);
  if (!info) {
    console.log("Account not found");
    return;
  }

  console.log("Owner:", info.owner.toBase58());
  console.log("Data length:", info.data.length, "bytes");
  console.log("Lamports:", info.lamports);
  console.log("");

  // Dump first 200 bytes hex
  const data = info.data;
  console.log("Raw data (first 300 bytes):");
  for (let i = 0; i < Math.min(300, data.length); i += 32) {
    const chunk = data.slice(i, i + 32);
    const hex = Buffer.from(chunk).toString("hex");
    const ascii = Buffer.from(chunk).toString("ascii").replace(/[^\x20-\x7e]/g, ".");
    console.log(`  [${i.toString().padStart(4)}] ${hex}  ${ascii}`);
  }

  // Try to identify known Arcium computation account fields
  // Typically: discriminator (8) + status + comp_def + cluster + various fields
  if (data.length >= 8) {
    console.log("\nDiscriminator:", Buffer.from(data.slice(0, 8)).toString("hex"));
  }
  // Check for is_aborted flag at various offsets
  console.log("\nLooking for abort flags:");
  for (const offset of [8, 9, 40, 41, 72, 73, 104, 105]) {
    if (offset < data.length) {
      console.log(`  byte[${offset}] = ${data[offset]} (0x${data[offset].toString(16)})`);
    }
  }
})();
