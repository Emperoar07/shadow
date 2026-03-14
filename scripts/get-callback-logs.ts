import { Connection, PublicKey } from "@solana/web3.js";

const RPC = "https://cool-boldest-yard.solana-devnet.quiknode.pro/3513dd000b0bf11aae344e55c52d9281969d0808";
const POSITION_PDA = new PublicKey("BAsf8npFC8j6x4mDRLkyTYBMWtKs3KWQ7tVYUp3J7UFN"); // position #4

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const sigs = await conn.getSignaturesForAddress(POSITION_PDA, { limit: 5 });

  for (const sig of sigs) {
    console.log(`\n--- ${sig.signature} ---`);
    console.log(`  Error: ${sig.err ? JSON.stringify(sig.err) : "none"}`);

    const tx = await conn.getTransaction(sig.signature, {
      maxSupportedTransactionVersion: 0,
    });
    if (tx?.meta?.logMessages) {
      for (const log of tx.meta.logMessages) {
        console.log(`  ${log}`);
      }
    }
  }
}

main().catch(console.error);
