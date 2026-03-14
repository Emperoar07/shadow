import { Connection, PublicKey } from "@solana/web3.js";

const RPC = "https://cool-boldest-yard.solana-devnet.quiknode.pro/3513dd000b0bf11aae344e55c52d9281969d0808";
const MARKET = new PublicKey("G6hRuJxx5ZKrzKNsKkeYqhHonEfvU7GrEtvQ4EMGQzh6");

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const sigs = await conn.getSignaturesForAddress(MARKET, { limit: 5 });

  for (const sig of sigs) {
    if (!sig.err) continue; // skip successful txs
    console.log(`\n--- ${sig.signature.slice(0, 40)}... ---`);
    console.log(`  Error: ${JSON.stringify(sig.err)}`);

    const tx = await conn.getTransaction(sig.signature, { maxSupportedTransactionVersion: 0 });
    if (tx?.meta?.logMessages) {
      for (const log of tx.meta.logMessages) {
        console.log(`  ${log}`);
      }
    }
  }
}

main().catch(console.error);
