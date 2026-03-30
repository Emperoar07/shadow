/**
 * Debug MXE keygen status and check if key recovery is needed.
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import {
  getArciumProgram,
  getMXEAccAddress,
  getMXEPublicKey,
  getComputationAccAddress,
  getClusterAccAddress,
  queueKeyRecoveryInit,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const PROGRAM_ID = new PublicKey("ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4");
const CLUSTER_OFFSET = 456;

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

async function main() {
  const rpcUrl = readArg("rpc") || "https://cool-boldest-yard.solana-devnet.quiknode.pro/3513dd000b0bf11aae344e55c52d9281969d0808";
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

  const mxeAddr = getMXEAccAddress(PROGRAM_ID);
  const arciumProgram = getArciumProgram(provider);

  console.log("=== MXE Keygen Debug ===\n");

  // 1. Fetch MXE account raw data
  const mxeInfo = await connection.getAccountInfo(mxeAddr);
  if (!mxeInfo) {
    console.error("MXE account not found!");
    return;
  }
  console.log(`MXE account: ${mxeAddr.toBase58()}`);
  console.log(`  Size: ${mxeInfo.data.length} bytes`);
  console.log(`  Owner: ${mxeInfo.owner.toBase58()}`);

  // 2. Fetch MXE account via Arcium program
  const mxe = await (arciumProgram.account as any).mxeAccount.fetch(mxeAddr);
  console.log(`  Status: ${JSON.stringify(mxe.status)}`);
  console.log(`  Cluster offset: ${mxe.clusterOffset?.toString()}`);
  console.log(`  Keygen offset: ${mxe.keygenOffset?.toString()}`);
  console.log(`  Key recovery init offset: ${mxe.keyRecoveryInitOffset?.toString()}`);

  // 3. Check all utility pubkeys
  console.log("\n  Utility pubkeys:");
  if (mxe.utilityPubkeys && Array.isArray(mxe.utilityPubkeys)) {
    for (let i = 0; i < mxe.utilityPubkeys.length; i++) {
      const pk = mxe.utilityPubkeys[i];
      const hex = Buffer.from(pk).toString("hex");
      const isZero = hex === "0".repeat(hex.length);
      console.log(`    [${i}] ${isZero ? "ZERO" : hex.slice(0, 40) + "..."} (${isZero ? "NOT SET" : "SET"})`);
    }
  } else {
    console.log("    No utility pubkeys array found");
    // Try direct field names
    const keys = Object.keys(mxe).filter(k => k.toLowerCase().includes('key') || k.toLowerCase().includes('pubkey'));
    console.log("    Key-related fields:", keys);
  }

  // 4. Check keygen computation account
  if (mxe.keygenOffset) {
    const keygenBN = new anchor.BN(mxe.keygenOffset.toString());
    const compAddr = getComputationAccAddress(CLUSTER_OFFSET, keygenBN);
    console.log(`\n  Keygen computation: ${compAddr.toBase58()}`);
    const compInfo = await connection.getAccountInfo(compAddr);
    if (compInfo) {
      console.log(`    Size: ${compInfo.data.length} bytes`);
      // Try reading signatures on this account
      const sigs = await connection.getSignaturesForAddress(compAddr, { limit: 5 });
      console.log(`    Transactions: ${sigs.length}`);
      for (const s of sigs) {
        console.log(`      ${s.signature.slice(0, 40)}... ${s.err ? `FAILED: ${JSON.stringify(s.err)}` : "OK"}`);
      }
    } else {
      console.log("    NOT FOUND (may have been cleaned up)");
    }
  }

  // 5. Check key recovery init computation
  if (mxe.keyRecoveryInitOffset) {
    const recoveryBN = new anchor.BN(mxe.keyRecoveryInitOffset.toString());
    const compAddr = getComputationAccAddress(CLUSTER_OFFSET, recoveryBN);
    console.log(`\n  Key recovery init computation: ${compAddr.toBase58()}`);
    const compInfo = await connection.getAccountInfo(compAddr);
    if (compInfo) {
      console.log(`    Size: ${compInfo.data.length} bytes`);
    } else {
      console.log("    NOT FOUND");
    }
  }

  // 6. Get MXE public key and verify
  console.log("\n  MXE Public Key:");
  try {
    const pk = await getMXEPublicKey(provider, PROGRAM_ID);
    if (pk) {
      const hex = Buffer.from(pk).toString("hex");
      const isZero = hex === "0".repeat(hex.length);
      console.log(`    ${hex}`);
      console.log(`    Zero: ${isZero}`);
    } else {
      console.log("    NULL");
    }
  } catch (e: any) {
    console.log(`    ERROR: ${e.message}`);
  }

  // 7. Check cluster nodes
  const clusterAddr = getClusterAccAddress(CLUSTER_OFFSET);
  const cluster = await (arciumProgram.account as any).cluster.fetch(clusterAddr);
  console.log(`\n  Cluster: ${clusterAddr.toBase58()}`);
  console.log(`    Nodes: ${cluster.nodes?.length}`);
  if (cluster.nodes) {
    for (const node of cluster.nodes) {
      const offset = node.offset?.toString() || "0";
      if (parseInt(offset) > 0) {
        console.log(`    Node offset: ${offset}`);
      }
    }
  }

  // 8. Print all MXE fields for debugging
  console.log("\n  All MXE fields:");
  for (const [key, value] of Object.entries(mxe)) {
    if (key === "utilityPubkeys" || key === "recoveryPeers") continue; // too long
    const valStr = value instanceof PublicKey ? value.toBase58() :
      typeof value === 'object' ? JSON.stringify(value) : String(value);
    console.log(`    ${key}: ${valStr.slice(0, 80)}`);
  }

  // 9. Optionally requeue key recovery
  if (hasFlag("requeue-keygen")) {
    console.log("\n\nRequeuing key recovery init...");
    try {
      const sigs = await queueKeyRecoveryInit(
        provider,
        CLUSTER_OFFSET,
        PROGRAM_ID
      );
      console.log(`Key recovery init queued. Signatures: ${sigs.join(", ")}`);
    } catch (e: any) {
      console.error(`Failed to requeue: ${e.message}`);
    }
  }
}

main().catch((err) => {
  console.error("Debug failed:", err);
  process.exit(1);
});
