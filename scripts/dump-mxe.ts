import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { getMXEAccAddress } from "@arcium-hq/client";

const PROGRAM_ID = new PublicKey("Fc8SmsvjqDH768HYeAJmHkoEu6xP4FuThJaDaqco3beV");
const ARCIUM_PROGRAM_ID = new PublicKey("Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ");
const RPC = process.argv[2] || "https://cool-boldest-yard.solana-devnet.quiknode.pro/3513dd000b0bf11aae344e55c52d9281969d0808";

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(conn, wallet, { commitment: "confirmed" });

  const arciumIdl = await anchor.Program.fetchIdl(ARCIUM_PROGRAM_ID, provider);
  if (!arciumIdl) throw new Error("Cannot fetch Arcium IDL");
  const arciumProgram = new anchor.Program(
    { ...arciumIdl, address: ARCIUM_PROGRAM_ID.toBase58() } as any,
    provider
  );

  const mxeAddr = getMXEAccAddress(PROGRAM_ID);
  console.log("MXE Address:", mxeAddr.toBase58());

  const mxe = await (arciumProgram.account as any).mxeAccount.fetch(mxeAddr);

  for (const [k, v] of Object.entries(mxe)) {
    if (v instanceof PublicKey) {
      console.log(`  ${k}: ${v.toBase58()}`);
    } else if (v && typeof v === "object" && "toNumber" in (v as any)) {
      console.log(`  ${k}: ${(v as any).toString()}`);
    } else if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
      console.log(`  ${k}: [${(v as any).length} bytes] ${Buffer.from(v as any).toString("hex").slice(0, 64)}...`);
    } else if (Array.isArray(v)) {
      console.log(`  ${k}: [${v.length} items]`, v.slice(0, 5).map(String).join(", "), v.length > 5 ? "..." : "");
    } else {
      console.log(`  ${k}:`, v);
    }
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
