/**
 * Check MXE account status and keygen completion.
 * Usage: npx ts-node scripts/check-mxe-status.ts --rpc <url>
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import {
  getArciumProgram,
  getMXEAccAddress,
  getMXEPublicKey,
  getClusterAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const PROGRAM_ID = new PublicKey("ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4");
const ARCIUM_PROGRAM_ID = new PublicKey("Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ");
const CLUSTER_OFFSET = 456;

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
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
  console.log("MXE Address:", mxeAddr.toBase58());

  // Fetch raw MXE account
  const arciumProgram = getArciumProgram(provider);
  try {
    const mxe = await (arciumProgram.account as any).mxeAccount.fetch(mxeAddr);
    console.log("\nMXE Account fields:");
    console.log("  status:", JSON.stringify(mxe.status));
    console.log("  clusterOffset:", mxe.clusterOffset?.toString());
    console.log("  keygenOffset:", mxe.keygenOffset?.toString());
    console.log("  lutOffsetSlot:", mxe.lutOffsetSlot?.toString());

    // Check utility pubkeys
    if (mxe.utilityPubkeys) {
      console.log("\n  Utility Pubkeys:");
      for (let i = 0; i < mxe.utilityPubkeys.length; i++) {
        const pk = mxe.utilityPubkeys[i];
        const bytes = Array.isArray(pk) ? pk : (pk instanceof Uint8Array ? Array.from(pk) : []);
        const isZero = bytes.every((b: number) => b === 0);
        console.log(`    [${i}]: ${isZero ? "ALL ZEROS (NOT SET)" : Buffer.from(bytes).toString("hex").slice(0, 32) + "..."}`);
      }
    } else {
      console.log("  utilityPubkeys: NOT PRESENT");
    }

    // Check authority
    if (mxe.authority) {
      console.log("\n  Authority:", mxe.authority.toBase58());
    }

    // Check recovery peers
    if (mxe.recoveryPeers) {
      const nonZero = (mxe.recoveryPeers as number[]).filter((p: number) => p > 0);
      console.log(`\n  Recovery peers: ${nonZero.length} non-zero entries`);
    }
  } catch (e: any) {
    console.error("Failed to fetch MXE account:", e.message);
  }

  // Check MXE public key
  console.log("\nMXE Public Key check:");
  try {
    const pk = await getMXEPublicKey(provider, PROGRAM_ID);
    if (pk) {
      const isZero = pk.every((b) => b === 0);
      console.log(`  Length: ${pk.length} bytes`);
      console.log(`  All zeros: ${isZero}`);
      console.log(`  Value: ${Buffer.from(pk).toString("hex")}`);
    } else {
      console.log("  NULL (keygen not complete)");
    }
  } catch (e: any) {
    console.error("  Failed:", e.message);
  }

  // Check cluster
  console.log("\nCluster check:");
  try {
    const clusterAddr = getClusterAccAddress(CLUSTER_OFFSET);
    const cluster = await (arciumProgram.account as any).cluster.fetch(clusterAddr);
    console.log(`  Address: ${clusterAddr.toBase58()}`);
    console.log(`  Nodes: ${cluster.nodes?.length || 0}`);
    const activeNodes = (cluster.nodes || []).filter((n: any) => {
      const offset = typeof n.offset === 'number' ? n.offset : Number(n.offset?.toString() || '0');
      return offset > 0;
    });
    console.log(`  Active nodes: ${activeNodes.length}`);
  } catch (e: any) {
    console.error("  Cluster fetch failed:", e.message);
  }

  // Check keygen computation if we have the offset
  try {
    const mxe = await (arciumProgram.account as any).mxeAccount.fetch(mxeAddr);
    if (mxe.keygenOffset) {
      console.log("\nKeygen computation check:");
      const keygenOffset = mxe.keygenOffset;
      // Derive the computation PDA
      const { getComputationAccAddress } = require("@arcium-hq/client");
      const compAddr = getComputationAccAddress(CLUSTER_OFFSET, keygenOffset);
      console.log(`  Computation address: ${compAddr.toBase58()}`);
      const compInfo = await connection.getAccountInfo(compAddr);
      if (compInfo) {
        console.log(`  Exists: yes (${compInfo.data.length} bytes)`);
        // Try to fetch as computation account
        try {
          const comp = await (arciumProgram.account as any).computation.fetch(compAddr);
          console.log(`  Status: ${JSON.stringify(comp.status)}`);
        } catch {
          console.log("  Could not decode computation account");
        }
      } else {
        console.log("  Exists: no (keygen computation not found)");
      }
    }
  } catch (e: any) {
    console.error("Keygen check failed:", e.message);
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
