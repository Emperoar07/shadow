/**
 * Force-upload a circuit to an existing (even completed) Arcium comp-def.
 * Use this when the on-chain comp-def binary is stale after a circuit fix.
 *
 * Usage:
 *   npx ts-node scripts/force-upload-circuit.ts --circuit close_position
 *   npx ts-node scripts/force-upload-circuit.ts --circuit open_position
 *   npx ts-node scripts/force-upload-circuit.ts --circuit check_liquidation
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import {
  uploadCircuit,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getArciumProgram,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const key = `--${name}`;
  const idx = args.indexOf(key);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function resolveWalletPath(): string {
  if (process.env.SOLANA_WALLET && fs.existsSync(process.env.SOLANA_WALLET)) {
    return process.env.SOLANA_WALLET;
  }
  const defaultPath = path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(defaultPath)) throw new Error(`Wallet not found: ${defaultPath}`);
  return defaultPath;
}

async function main() {
  const circuit = readArg("circuit");
  if (!circuit) {
    console.error("Usage: npx ts-node scripts/force-upload-circuit.ts --circuit <name>");
    console.error("  <name>: open_position | close_position | check_liquidation");
    process.exit(1);
  }

  const mxeProgramId = new PublicKey(
    readArg("mxe-program") ||
      process.env.NEXT_PUBLIC_ARCIUM_MXE_PROGRAM_ID ||
      process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ||
      "6JSACVRd4TxePjsfvy3d5sXP5ykS4m3wbtkYJjHK8SCA"
  );
  const rpcUrl =
    readArg("rpc") ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    clusterApiUrl("devnet");

  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(resolveWalletPath(), "utf8")))
  );
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Resolve circuit binary
  const buildDir = path.resolve(process.cwd(), "build");
  const idarcPath = path.join(buildDir, `${circuit}.idarc`);
  const arcisPath = path.join(buildDir, `${circuit}.arcis`);
  const circuitPath = fs.existsSync(idarcPath)
    ? idarcPath
    : fs.existsSync(arcisPath)
    ? arcisPath
    : null;

  if (!circuitPath) {
    console.error(
      `Circuit binary not found at ${idarcPath} or ${arcisPath}.\n` +
        `Run 'arcium build' first.`
    );
    process.exit(1);
  }

  const rawCircuit = new Uint8Array(fs.readFileSync(circuitPath));
  const offset = Buffer.from(getCompDefAccOffset(circuit)).readUInt32LE(0);
  const compDefAccount = getCompDefAccAddress(mxeProgramId, offset);

  const arciumProgram = getArciumProgram(provider);
  const existingCompDef = await (arciumProgram.account as any).computationDefinitionAccount.fetch(
    compDefAccount
  );
  const isCompleted =
    existingCompDef?.circuitSource?.onChain?.[0]?.isCompleted ??
    existingCompDef?.circuit_source?.on_chain?.[0]?.is_completed ??
    false;

  console.log(`Circuit: ${circuit}`);
  console.log(`Comp-def: ${compDefAccount.toBase58()}`);
  console.log(`Binary: ${path.basename(circuitPath)} (${rawCircuit.length} bytes)`);
  console.log(`Currently completed: ${isCompleted}`);
  console.log(`MXE Program: ${mxeProgramId.toBase58()}`);
  console.log("");

  console.log(`Uploading circuit to comp-def (force=true)...`);
  try {
    const sigs = await uploadCircuit(
      provider,
      circuit,
      mxeProgramId,
      rawCircuit,
      true // finalize
    );
    console.log(
      `Upload complete. ${sigs.length} transaction(s):\n` +
        sigs.map((s: string) => `  ${s}`).join("\n")
    );
  } catch (err: any) {
    console.error("Upload failed:", err?.message || err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("force-upload-circuit failed:", err);
  process.exit(1);
});
