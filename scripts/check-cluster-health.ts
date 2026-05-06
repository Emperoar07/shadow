/**
 * Comprehensive Arcium cluster health diagnostic.
 *
 * Checks cluster 456 on devnet: node status, mempool, execution pool,
 * recent computation accounts, and transaction logs for computation events.
 *
 * Usage:
 *   npx ts-node scripts/check-cluster-health.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import {
  getArciumProgram,
  getClusterAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getMXEAccAddress,
  getMXEPublicKey,
  getMempoolAccInfo,
  getExecutingPoolAccInfo,
  getCompDefAccAddress,
  getCompDefAccOffset,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ── Configuration ───────────────────────────────────────────────────
const RPC_URL =
  "https://cool-boldest-yard.solana-devnet.quiknode.pro/3513dd000b0bf11aae344e55c52d9281969d0808";
const PROGRAM_ID = new PublicKey("34wszdEvGvyAVADY7ozpbdAvAB9zHRBTaT1YsNcpRJdo");
const MARKET = new PublicKey("BLvULbGNEKFXYgVGjE6yXWfShAevzKCwqxV1EJS29Pn4");
const ARCIUM_PROGRAM_ID = new PublicKey("Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ");
const CLUSTER_OFFSET = 456;

// ── Helpers ─────────────────────────────────────────────────────────
function hr(label: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${"=".repeat(60)}`);
}

function indent(text: string, level = 1): string {
  return text
    .split("\n")
    .map((l) => "  ".repeat(level) + l)
    .join("\n");
}

function safeJson(value: any, maxLen = 200): string {
  if (value instanceof PublicKey) return value.toBase58();
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    const hex = Buffer.from(value).toString("hex");
    return hex.length > maxLen ? hex.slice(0, maxLen) + "..." : hex;
  }
  if (typeof value === "bigint") return value.toString();
  try {
    const s = JSON.stringify(value, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v
    );
    return s.length > maxLen ? s.slice(0, maxLen) + "..." : s;
  } catch {
    return String(value);
  }
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const walletPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );

  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const arciumProgram = getArciumProgram(provider);

  console.log("Arcium Cluster Health Diagnostic");
  console.log(`  RPC:             ${RPC_URL.replace(/\/[^/]{20,}$/, "/...")}`);
  console.log(`  Program:         ${PROGRAM_ID.toBase58()}`);
  console.log(`  Market:          ${MARKET.toBase58()}`);
  console.log(`  Cluster Offset:  ${CLUSTER_OFFSET}`);
  console.log(`  Wallet:          ${wallet.publicKey.toBase58()}`);
  console.log(`  Timestamp:       ${new Date().toISOString()}`);

  // ── 1. Cluster account ────────────────────────────────────────────
  hr("1. CLUSTER ACCOUNT");
  const clusterAddr = getClusterAccAddress(CLUSTER_OFFSET);
  console.log(`  Address: ${clusterAddr.toBase58()}`);

  try {
    const cluster = await (arciumProgram.account as any).cluster.fetch(clusterAddr);

    // Dump all top-level fields
    for (const [key, value] of Object.entries(cluster)) {
      if (key === "nodes" || key === "blsKeys" || key === "bls_keys") continue;
      console.log(`  ${key}: ${safeJson(value)}`);
    }

    // Nodes
    const nodes = (cluster.nodes || []) as any[];
    console.log(`\n  Nodes (${nodes.length} total):`);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const offset =
        typeof node === "object"
          ? Number(node.offset?.toString?.() || node.nodeOffset?.toString?.() || "0")
          : Number(node);
      const isActive = offset > 0;
      console.log(
        `    [${i}] offset=${offset} ${isActive ? "ACTIVE" : "INACTIVE"}`
      );
      if (typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "offset" || k === "nodeOffset") continue;
          console.log(`         ${k}: ${safeJson(v, 80)}`);
        }
      }
    }

    // BLS key aggregation
    const blsKeys = cluster.blsKeys || cluster.bls_keys;
    if (blsKeys) {
      const isAllZero =
        Array.isArray(blsKeys)
          ? blsKeys.every((b: number) => b === 0)
          : blsKeys instanceof Uint8Array
          ? Array.from(blsKeys).every((b) => b === 0)
          : false;
      console.log(
        `\n  BLS Key Aggregation: ${isAllZero ? "ALL ZEROS (NOT AGGREGATED)" : "SET"}`
      );
      if (!isAllZero) {
        console.log(`    Value: ${safeJson(blsKeys, 80)}`);
      }
    }

    // Minimum nodes check
    const activeCount = nodes.filter((n: any) => {
      const o = Number(n?.offset?.toString?.() || n?.nodeOffset?.toString?.() || "0");
      return o > 0;
    }).length;
    console.log(
      `\n  Active nodes: ${activeCount} / ${nodes.length}`
    );
    if (activeCount < 2) {
      console.log("  ** WARNING: Fewer than 2 active nodes — MPC requires at least 2 **");
    }
  } catch (e: any) {
    console.error(`  FAILED: ${e.message}`);
  }

  // ── 2. MXE Account ───────────────────────────────────────────────
  hr("2. MXE ACCOUNT");
  const mxeAddr = getMXEAccAddress(PROGRAM_ID);
  console.log(`  Address: ${mxeAddr.toBase58()}`);

  try {
    const mxe = await (arciumProgram.account as any).mxeAccount.fetch(mxeAddr);
    for (const [key, value] of Object.entries(mxe)) {
      if (key === "utilityPubkeys" || key === "utility_pubkeys" || key === "recoveryPeers" || key === "recovery_peers") continue;
      console.log(`  ${key}: ${safeJson(value)}`);
    }
  } catch (e: any) {
    console.error(`  FAILED: ${e.message}`);
  }

  // MXE Public Key (BLS key from keygen)
  console.log("\n  MXE Public Key (keygen result):");
  try {
    const pk = await getMXEPublicKey(provider, PROGRAM_ID);
    if (pk) {
      const isZero = pk.every((b) => b === 0);
      console.log(`    Length: ${pk.length} bytes`);
      console.log(`    All zeros: ${isZero}`);
      if (!isZero) {
        console.log(`    Value: ${Buffer.from(pk).toString("hex")}`);
      } else {
        console.log("    ** WARNING: MXE public key is all zeros — keygen may not have completed **");
      }
    } else {
      console.log("    NULL — keygen not complete");
    }
  } catch (e: any) {
    console.error(`    FAILED: ${e.message}`);
  }

  // ── 3. Mempool ────────────────────────────────────────────────────
  hr("3. MEMPOOL");
  const mempoolAddr = getMempoolAccAddress(CLUSTER_OFFSET);
  console.log(`  Address: ${mempoolAddr.toBase58()}`);

  try {
    const mempool = await getMempoolAccInfo(provider, mempoolAddr);
    console.log(`  Mempool decoded successfully.`);
    for (const [key, value] of Object.entries(mempool as any)) {
      if (key === "computations" || key === "computation_refs") {
        const arr = value as any[];
        const nonEmpty = arr.filter((c: any) => {
          if (!c) return false;
          if (typeof c === "object" && c.computationOffset) {
            return c.computationOffset.toString() !== "0";
          }
          return true;
        });
        console.log(`  ${key}: ${arr.length} slots, ${nonEmpty.length} non-empty`);
        for (const comp of nonEmpty.slice(0, 10)) {
          console.log(`    ${safeJson(comp, 150)}`);
        }
      } else {
        console.log(`  ${key}: ${safeJson(value)}`);
      }
    }
  } catch (e: any) {
    console.error(`  FAILED to decode mempool: ${e.message}`);

    // Fallback: raw account info
    try {
      const info = await connection.getAccountInfo(mempoolAddr);
      if (info) {
        console.log(`  Raw size: ${info.data.length} bytes`);
        console.log(`  Owner: ${info.owner.toBase58()}`);
      } else {
        console.log("  Account does not exist on-chain.");
      }
    } catch {}
  }

  // ── 4. Executing Pool ─────────────────────────────────────────────
  hr("4. EXECUTING POOL");
  const execPoolAddr = getExecutingPoolAccAddress(CLUSTER_OFFSET);
  console.log(`  Address: ${execPoolAddr.toBase58()}`);

  try {
    const execPool = await getExecutingPoolAccInfo(provider, execPoolAddr);
    console.log(`  Executing pool decoded successfully.`);
    for (const [key, value] of Object.entries(execPool as any)) {
      if (key === "computations" || key === "computation_refs") {
        const arr = value as any[];
        const nonEmpty = arr.filter((c: any) => {
          if (!c) return false;
          if (typeof c === "object" && c.computationOffset) {
            return c.computationOffset.toString() !== "0";
          }
          return true;
        });
        console.log(`  ${key}: ${arr.length} slots, ${nonEmpty.length} non-empty`);
        for (const comp of nonEmpty.slice(0, 10)) {
          console.log(`    ${safeJson(comp, 150)}`);
        }
      } else {
        console.log(`  ${key}: ${safeJson(value)}`);
      }
    }
  } catch (e: any) {
    console.error(`  FAILED to decode executing pool: ${e.message}`);

    try {
      const info = await connection.getAccountInfo(execPoolAddr);
      if (info) {
        console.log(`  Raw size: ${info.data.length} bytes`);
        console.log(`  Owner: ${info.owner.toBase58()}`);
      } else {
        console.log("  Account does not exist on-chain.");
      }
    } catch {}
  }

  // ── 5. Computation Accounts for positions #0, #1, #2 ─────────────
  hr("5. COMPUTATION ACCOUNTS (positions #0, #1, #2)");

  // We look for recent computations by scanning tx logs on the program.
  // First, try fixed offsets 0, 1, 2 as BN values.
  for (const offsetNum of [0, 1, 2]) {
    const offset = new anchor.BN(offsetNum);
    const compAddr = getComputationAccAddress(CLUSTER_OFFSET, offset);
    console.log(`\n  Position #${offsetNum} — computation offset ${offsetNum}:`);
    console.log(`    Address: ${compAddr.toBase58()}`);

    try {
      const info = await connection.getAccountInfo(compAddr);
      if (!info) {
        console.log("    NOT FOUND on-chain");
        continue;
      }
      console.log(`    Size: ${info.data.length} bytes, Owner: ${info.owner.toBase58()}`);

      try {
        const comp = await (arciumProgram.account as any).computation.fetch(compAddr);
        console.log("    Decoded computation:");
        for (const [key, value] of Object.entries(comp)) {
          console.log(`      ${key}: ${safeJson(value, 120)}`);
        }
      } catch (e: any) {
        console.log(`    Could not decode: ${e.message?.slice(0, 120)}`);
      }

      // Recent transactions touching this computation
      const sigs = await connection.getSignaturesForAddress(compAddr, { limit: 5 });
      if (sigs.length > 0) {
        console.log(`    Recent transactions (${sigs.length}):`);
        for (const s of sigs) {
          const time = s.blockTime
            ? new Date(s.blockTime * 1000).toISOString()
            : "?";
          const status = s.err ? `FAILED: ${JSON.stringify(s.err)}` : "OK";
          console.log(`      ${status} | ${time} | ${s.signature.slice(0, 50)}...`);
        }
      }
    } catch (e: any) {
      console.error(`    ERROR: ${e.message}`);
    }
  }

  // ── 5b. Search for recent computations via program tx logs ────────
  hr("5b. RECENT PROGRAM COMPUTATIONS (from program tx logs)");
  try {
    const programSigs = await connection.getSignaturesForAddress(PROGRAM_ID, {
      limit: 20,
    });
    console.log(`  Found ${programSigs.length} recent program transactions.\n`);

    let queueEvents = 0;
    let initEvents = 0;
    let callbackEvents = 0;

    for (const s of programSigs) {
      const time = s.blockTime
        ? new Date(s.blockTime * 1000).toISOString()
        : "?";
      const status = s.err ? "FAILED" : "OK";

      try {
        const tx = await connection.getTransaction(s.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        });
        const logs = tx?.meta?.logMessages || [];

        const hasQueue = logs.some((l) => l.includes("QueueComputation") || l.includes("queue_computation"));
        const hasInit = logs.some((l) => l.includes("InitComputation") || l.includes("init_computation"));
        const hasCallback = logs.some((l) =>
          l.includes("callback") || l.includes("Callback") || l.includes("finalize_computation")
        );
        const hasOpen = logs.some((l) => l.includes("open_position") || l.includes("OpenPosition"));
        const hasClose = logs.some((l) => l.includes("close_position") || l.includes("ClosePosition"));
        const hasLiq = logs.some((l) => l.includes("liquidat") || l.includes("Liquidat"));

        if (hasQueue) queueEvents++;
        if (hasInit) initEvents++;
        if (hasCallback) callbackEvents++;

        const tags: string[] = [];
        if (hasQueue) tags.push("QUEUE");
        if (hasInit) tags.push("INIT");
        if (hasCallback) tags.push("CALLBACK");
        if (hasOpen) tags.push("open_pos");
        if (hasClose) tags.push("close_pos");
        if (hasLiq) tags.push("liquidation");

        if (tags.length > 0 || s.err) {
          console.log(
            `  ${status} | ${time} | [${tags.join(",")}] | ${s.signature.slice(0, 50)}...`
          );
          if (s.err) {
            console.log(`    Error: ${JSON.stringify(s.err)}`);
          }
          // Show relevant logs
          const relevantLogs = logs.filter(
            (l) =>
              l.includes("Instruction:") ||
              l.includes("computation") ||
              l.includes("Computation") ||
              l.includes("queue") ||
              l.includes("callback") ||
              l.includes("error") ||
              l.includes("Error") ||
              l.includes("failed")
          );
          for (const log of relevantLogs.slice(0, 5)) {
            console.log(`    ${log}`);
          }
        }
      } catch {
        console.log(`  ${status} | ${time} | ${s.signature.slice(0, 50)}... (could not fetch logs)`);
      }
    }

    console.log(`\n  Event summary:`);
    console.log(`    QueueComputation events:  ${queueEvents}`);
    console.log(`    InitComputation events:   ${initEvents}`);
    console.log(`    Callback events:          ${callbackEvents}`);
  } catch (e: any) {
    console.error(`  FAILED: ${e.message}`);
  }

  // ── 6. Cluster recent transactions ────────────────────────────────
  hr("6. CLUSTER RECENT TRANSACTIONS");
  const clusterSigs = await connection.getSignaturesForAddress(clusterAddr, {
    limit: 15,
  });
  console.log(`  ${clusterSigs.length} recent transactions on cluster account.\n`);

  for (const s of clusterSigs) {
    const time = s.blockTime
      ? new Date(s.blockTime * 1000).toISOString()
      : "?";
    const status = s.err ? "FAILED" : "OK";
    console.log(
      `  ${status} | ${time} | ${s.signature.slice(0, 60)}...`
    );
    if (s.err) {
      console.log(`    Error: ${JSON.stringify(s.err)}`);
    }
    try {
      const tx = await connection.getTransaction(s.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      const logs = tx?.meta?.logMessages || [];
      const relevant = logs.filter(
        (l) =>
          l.includes("Instruction:") ||
          l.includes("computation") ||
          l.includes("callback") ||
          l.includes("Callback") ||
          l.includes("error") ||
          l.includes("Error") ||
          l.includes("Aborted")
      );
      for (const log of relevant.slice(0, 4)) {
        console.log(`    ${log}`);
      }
    } catch {}
  }

  // ── 7. Comp-def health ────────────────────────────────────────────
  hr("7. COMP-DEF STATUS");
  const circuits = [
    "open_position_probe_b",
    "close_position_v2",
    "check_liquidation_v2",
    "seed_open_interest_state_v3",
  ];
  for (const circuit of circuits) {
    try {
      const offset = Buffer.from(getCompDefAccOffset(circuit)).readUInt32LE(0);
      const compDefAddr = getCompDefAccAddress(PROGRAM_ID, offset);
      const compDef = await (arciumProgram.account as any).computationDefinitionAccount.fetch(compDefAddr);
      const isCompleted =
        compDef?.circuitSource?.onChain?.[0]?.isCompleted ??
        compDef?.circuit_source?.on_chain?.[0]?.is_completed ??
        false;
      console.log(
        `  ${circuit}: ${isCompleted ? "FINALIZED" : "NOT FINALIZED"} (${compDefAddr.toBase58()})`
      );
    } catch (e: any) {
      console.log(`  ${circuit}: ERROR — ${e.message?.slice(0, 80)}`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────
  hr("DIAGNOSTIC SUMMARY");
  console.log(
    "  Review the sections above to identify why computations are stuck.\n" +
      "  Common causes:\n" +
      "    - MXE keygen not completed (public key all zeros)\n" +
      "    - Cluster has too few active nodes\n" +
      "    - BLS key aggregation not done\n" +
      "    - Mempool is full / stuck\n" +
      "    - Comp-defs not finalized\n" +
      "    - Computations queued but never picked up (MPC nodes offline)\n"
  );
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
