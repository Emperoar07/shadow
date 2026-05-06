/**
 * Upload Arcium circuit binaries and finalize comp-defs.
 *
 * Replaces manual `arcium upload-circuit` CLI calls with a pure JS approach
 * using @arcium-hq/client's uploadCircuit + buildFinalizeCompDefTx.
 *
 * Usage:
 *   npx ts-node scripts/upload-circuits.ts [--rpc <url>] [--circuit <name>] [--finalize-only]
 *
 * Without --circuit, uploads all 4 circuits. With --circuit, uploads only that one.
 * --finalize-only skips upload and only finalizes comp-defs.
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  uploadCircuit,
  buildFinalizeCompDefTx,
  getCompDefAccAddress,
  getCompDefAccOffset,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolveRpcEndpoint } from "./rpc";

const PROGRAM_ID = new PublicKey("34wszdEvGvyAVADY7ozpbdAvAB9zHRBTaT1YsNcpRJdo");

const CIRCUITS = [
  { name: "open_position_probe_b", file: "build/open_position_probe_b.arcis" },
  { name: "open_position_tuple_probe_v1", file: "build/open_position_tuple_probe_v1.arcis" },
  { name: "open_position_margin_probe_v1", file: "build/open_position_margin_probe_v1.arcis" },
  { name: "open_position_full_probe_v1", file: "build/open_position_full_probe_v1.arcis" },
  { name: "close_position_v3", file: "build/close_position_v3.arcis" },
  { name: "check_liquidation_v2", file: "build/check_liquidation_v2.arcis" },
  { name: "seed_open_interest_state_v3", file: "build/seed_open_interest_state_v3.arcis" },
];

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
  const rpcOverride = readArg("rpc");
  const circuitFilter = readArg("circuit");
  const finalizeOnly = hasFlag("finalize-only");
  const { rpcUrl } = await resolveRpcEndpoint({ preferred: rpcOverride });

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

  const circuits = circuitFilter
    ? CIRCUITS.filter((c) => c.name === circuitFilter)
    : CIRCUITS;

  if (circuits.length === 0) {
    console.error(`Unknown circuit: ${circuitFilter}`);
    console.error(`Available: ${CIRCUITS.map((c) => c.name).join(", ")}`);
    process.exit(1);
  }

  console.log("=== Arcium Circuit Upload ===");
  console.log(`  Program:  ${PROGRAM_ID.toBase58()}`);
  console.log(`  Wallet:   ${wallet.publicKey.toBase58()}`);
  console.log(`  RPC:      ${rpcUrl.replace(/\/[a-f0-9]{20,}/, "/***")}`);
  console.log(`  Circuits: ${circuits.map((c) => c.name).join(", ")}`);
  console.log("");

  for (const circuit of circuits) {
    const circuitPath = path.resolve(__dirname, "..", circuit.file);

    if (!finalizeOnly) {
      // Upload
      if (!fs.existsSync(circuitPath)) {
        console.log(`  [SKIP] ${circuit.name}: file not found at ${circuit.file}`);
        continue;
      }

      const rawCircuit = new Uint8Array(fs.readFileSync(circuitPath));
      console.log(`  [UPLOAD] ${circuit.name} (${rawCircuit.length} bytes)...`);

      try {
        const txSigs = await uploadCircuit(
          provider,
          circuit.name,
          PROGRAM_ID,
          rawCircuit,
          true // logging
        );
        console.log(`  [OK] Uploaded in ${txSigs.length} tx(s)`);
      } catch (e: any) {
        if (e.message?.includes("already been initialized")) {
          console.log(`  [OK] Already uploaded (comp-def exists)`);
        } else {
          console.error(`  [FAIL] Upload failed: ${e.message?.slice(0, 150)}`);
          continue;
        }
      }
    }

    // Finalize
    console.log(`  [FINALIZE] ${circuit.name}...`);
    try {
      const offset = Buffer.from(getCompDefAccOffset(circuit.name)).readUInt32LE(0);
      const compDefAddr = getCompDefAccAddress(PROGRAM_ID, offset);

      // Check if already finalized
      const compDefInfo = await connection.getAccountInfo(compDefAddr);
      if (compDefInfo && compDefInfo.data.length > 0) {
        console.log(`  [OK] Already finalized: ${compDefAddr.toBase58().slice(0, 16)}...`);
      } else {
        const finalizeTx = await buildFinalizeCompDefTx(provider, offset, PROGRAM_ID);
        const sig = await provider.sendAndConfirm(finalizeTx);
        console.log(`  [OK] Finalized: ${sig.slice(0, 16)}...`);
      }
    } catch (e: any) {
      if (e.message?.includes("already finalized") || e.message?.includes("already been initialized")) {
        console.log(`  [OK] Already finalized`);
      } else {
        console.error(`  [FAIL] Finalize failed: ${e.message?.slice(0, 150)}`);
      }
    }

    console.log("");
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error("Circuit upload failed:", e.message);
  process.exit(1);
});
