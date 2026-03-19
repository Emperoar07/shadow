/**
 * Quick check on a position account's status and recent transactions.
 * Usage: npx ts-node scripts/check-position.ts --rpc <url> [--index 0]
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const PROGRAM_ID = new PublicKey("ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4");
const MARKET = new PublicKey("2NjpdDpP5Qt4ErvEoP787VPvgVMR6Hh1DD2HdjzjLkTb");

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

async function main() {
  const rpcUrl = readArg("rpc") || "https://api.devnet.solana.com";
  const posIndex = parseInt(readArg("index") || "0", 10);

  const walletPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );

  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idl = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "target", "idl", "shadowperp.json"), "utf8")
  );
  idl.address = PROGRAM_ID.toBase58();
  const program = new anchor.Program(idl as anchor.Idl, provider);

  const indexBuf = Buffer.alloc(8);
  indexBuf.writeBigUInt64LE(BigInt(posIndex));
  const [posPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), MARKET.toBuffer(), wallet.publicKey.toBuffer(), indexBuf],
    PROGRAM_ID
  );

  console.log(`Position PDA: ${posPda.toBase58()}`);
  console.log(`Owner: ${wallet.publicKey.toBase58()}`);
  console.log(`Index: ${posIndex}`);
  console.log("");

  try {
    const pos = await (program.account as any).position.fetch(posPda);
    console.log("Status:", JSON.stringify(pos.status));
    console.log("Pending computation:", pos.pendingComputationAccount?.toBase58() || "none");
    console.log("Pending callback kind:", pos.pendingCallbackKind);
    console.log("Computation offset:", pos.pendingComputationOffset?.toString());
    console.log("Opened at:", pos.openedAt?.toString());
    console.log("Requested margin:", pos.requestedMargin?.toString());
    console.log("Margin:", pos.margin?.toString());
    console.log("Client pubkey:", Buffer.from(pos.clientPubkey || []).toString("hex").slice(0, 16) + "...");
  } catch (e: any) {
    console.error("Position fetch failed:", e.message);
  }

  console.log("\nRecent transactions on position PDA:");
  const sigs = await connection.getSignaturesForAddress(posPda, { limit: 10 });
  for (const s of sigs) {
    const status = s.err ? `FAILED: ${JSON.stringify(s.err)}` : "OK";
    const time = s.blockTime ? new Date(s.blockTime * 1000).toISOString() : "?";
    console.log(`  ${s.signature.slice(0, 40)}... ${status} (${time})`);
  }

  // Also check the computation account if we have the offset
  try {
    const pos = await (program.account as any).position.fetch(posPda);
    if (pos.pendingComputationAccount && !PublicKey.default.equals(pos.pendingComputationAccount)) {
      const compAddr = pos.pendingComputationAccount;
      console.log(`\nComputation account: ${compAddr.toBase58()}`);
      const compInfo = await connection.getAccountInfo(compAddr);
      if (compInfo) {
        console.log(`  Exists: yes (${compInfo.data.length} bytes, owner: ${compInfo.owner.toBase58().slice(0, 12)}...)`);
      } else {
        console.log("  Exists: no (not created or already consumed)");
      }
      const compSigs = await connection.getSignaturesForAddress(compAddr, { limit: 5 });
      console.log("  Recent txs on computation account:");
      for (const s of compSigs) {
        const status = s.err ? `FAILED: ${JSON.stringify(s.err)}` : "OK";
        console.log(`    ${s.signature.slice(0, 40)}... ${status}`);
      }
    }
  } catch {}
}

main().catch((err) => {
  console.error("check-position failed:", err);
  process.exit(1);
});
