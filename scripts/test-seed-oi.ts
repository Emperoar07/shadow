/**
 * Test seed_open_interest_state computation — simplest circuit (no encryption).
 * If this works, the MPC cluster is fine and the issue is with encrypted args.
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  getComputationAccAddress,
  getClockAccAddress,
  getClusterAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getFeePoolAccAddress,
  getMXEAccAddress,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const PROGRAM_ID = new PublicKey("34wszdEvGvyAVADY7ozpbdAvAB9zHRBTaT1YsNcpRJdo");
const MARKET = new PublicKey("uGdPR4kmFWR3HwJ8esEjbeMwnuBKVD7oA9ENRv32uvy");
const ARCIUM_PROGRAM_ID = new PublicKey("Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ");
const CLUSTER_OFFSET = 456;
const RPC = process.argv[2] || "https://cool-boldest-yard.solana-devnet.quiknode.pro/3513dd000b0bf11aae344e55c52d9281969d0808";

async function main() {
  const walletPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );

  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const idlPath = path.resolve(__dirname, "..", "target", "idl", "shadowperp.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const program = new anchor.Program(
    { ...idl, address: PROGRAM_ID.toBase58() } as any,
    provider
  );

  // Check market state first
  const market = await (program.account as any).market.fetch(MARKET);
  console.log("Market OI nonce:", market.oiNonce?.toString());
  console.log("Active positions:", market.activePositions?.toString());
  console.log("Encrypted long OI all zeros:", Buffer.from(market.encryptedTotalLongOi || []).every((b: number) => b === 0));
  console.log("Encrypted short OI all zeros:", Buffer.from(market.encryptedTotalShortOi || []).every((b: number) => b === 0));

  if (market.oiNonce > 0 || market.activePositions > 0) {
    console.log("Market already has OI seeded or active positions. Cannot re-seed.");
    console.log("Skipping seed test.");
    return;
  }

  const computationOffset = new anchor.BN(
    Buffer.from(crypto.getRandomValues(new Uint8Array(8))),
    "le"
  );

  const mxeAccount = getMXEAccAddress(PROGRAM_ID);
  const clusterAddress = getClusterAccAddress(CLUSTER_OFFSET);
  const computationAccount = getComputationAccAddress(CLUSTER_OFFSET, computationOffset);
  const signPdaAccount = PublicKey.findProgramAddressSync(
    [Buffer.from("ArciumSignerAccount")],
    PROGRAM_ID
  )[0];

  console.log("\nSending seedOpenInterestState tx...");
  try {
    const txSig = await program.methods
      .seedOpenInterestState(computationOffset)
      .accounts({
        authority: wallet.publicKey,
        market: MARKET,
        mxeAccount,
        compDefAccount: market.seedOpenInterestCompDef,
        clusterAccount: clusterAddress,
        mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
        executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
        computationAccount,
        poolAccount: getFeePoolAccAddress(),
        signPdaAccount,
        clockAccount: getClockAccAddress(),
        arciumProgram: ARCIUM_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`seedOpenInterestState tx: ${txSig}`);

    // Wait for callback
    console.log("Waiting for MPC callback (up to 120s)...");
    const start = Date.now();
    while (Date.now() - start < 120_000) {
      await new Promise((r) => setTimeout(r, 3000));
      const m = await (program.account as any).market.fetch(MARKET);
      if (m.oiNonce > 0) {
        console.log("\nSeed OI SUCCEEDED! OI nonce:", m.oiNonce.toString());
        console.log("Long OI (encrypted):", Buffer.from(m.encryptedTotalLongOi || []).toString("hex").slice(0, 40));
        console.log("Short OI (encrypted):", Buffer.from(m.encryptedTotalShortOi || []).toString("hex").slice(0, 40));
        return;
      }
      const elapsed = Math.round((Date.now() - start) / 1000);
      process.stdout.write(`  Still waiting... (${elapsed}s)\r`);
    }

    // Check for failed callback
    const sigs = await connection.getSignaturesForAddress(MARKET, { limit: 10 });
    console.log("\nRecent market transactions:");
    for (const s of sigs) {
      console.log(`  ${s.signature.slice(0, 40)}... ${s.err ? `FAILED: ${JSON.stringify(s.err)}` : "OK"}`);
    }
    console.log("\nFAILED: Seed OI still not complete after 120s");

  } catch (e: any) {
    console.error("Failed:", e.message?.slice(0, 300));
  }
}

main().catch(console.error);
