/**
 * Pure JS program deployer — bypasses the Solana CLI entirely.
 *
 * Uses @solana/web3.js to write the program binary to a buffer account
 * and then issue a DeployWithMaxDataLen instruction via the BPF Upgradeable
 * Loader.  This works around CLI networking issues (WSL no internet,
 * Windows CLI "error sending request") because Node.js HTTP works fine.
 *
 * Usage:
 *   npx ts-node scripts/js-deploy.ts [--rpc <URL>]
 *
 * Env overrides:
 *   SOLANA_RPC_URL   — preferred RPC endpoint
 *   SOLANA_WALLET    — path to deployer keypair JSON
 */

import * as fs from "fs";
import * as path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { resolveRpcEndpoint } from "./rpc";

// BPF Upgradeable Loader program ID
const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

// Instruction discriminators for the upgradeable loader
const INITIALIZE_BUFFER_IX = 0;
const WRITE_IX = 1;
const DEPLOY_WITH_MAX_DATA_LEN_IX = 2;
const UPGRADE_IX = 3;

// ~1000 bytes per write tx (limited by transaction size)
const WRITE_CHUNK_SIZE = 1000;

function readKeypairFile(p: string): Keypair {
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(p, "utf-8")))
  );
}

function writeKeypairFile(p: string, kp: Keypair): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)));
}

type BufferProgress = {
  programId: string;
  bufferPubkey: string;
  totalChunks: number;
  nextChunkIndex: number;
};

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function parseFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? undefined : process.argv[idx + 1];
}

function initializeBufferIx(
  bufferPubkey: PublicKey,
  authority: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(4 + 4);
  data.writeUInt32LE(INITIALIZE_BUFFER_IX, 0);
  return new TransactionInstruction({
    keys: [
      { pubkey: bufferPubkey, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: false },
    ],
    programId: BPF_LOADER_UPGRADEABLE,
    data,
  });
}

function writeIx(
  bufferPubkey: PublicKey,
  authority: PublicKey,
  offset: number,
  chunk: Buffer
): TransactionInstruction {
  // Write instruction layout (bincode): u32 discriminator (1) + u32 offset + u64 vec_len + data
  const data = Buffer.alloc(4 + 4 + 8 + chunk.length);
  data.writeUInt32LE(WRITE_IX, 0);
  data.writeUInt32LE(offset, 4);
  data.writeBigUInt64LE(BigInt(chunk.length), 8);
  chunk.copy(data, 16);
  return new TransactionInstruction({
    keys: [
      { pubkey: bufferPubkey, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    programId: BPF_LOADER_UPGRADEABLE,
    data,
  });
}

function upgradeIx(
  programDataPubkey: PublicKey,
  programPubkey: PublicKey,
  bufferPubkey: PublicKey,
  spillAccount: PublicKey,
  authority: PublicKey,
): TransactionInstruction {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(UPGRADE_IX, 0);
  return new TransactionInstruction({
    keys: [
      { pubkey: programDataPubkey, isSigner: false, isWritable: true },
      { pubkey: programPubkey, isSigner: false, isWritable: true },
      { pubkey: bufferPubkey, isSigner: false, isWritable: true },
      { pubkey: spillAccount, isSigner: true, isWritable: true },
      { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: new PublicKey("SysvarC1ock11111111111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    programId: BPF_LOADER_UPGRADEABLE,
    data,
  });
}

function deployIx(
  payerPubkey: PublicKey,
  programDataPubkey: PublicKey,
  programPubkey: PublicKey,
  bufferPubkey: PublicKey,
  authority: PublicKey,
  maxDataLen: number
): TransactionInstruction {
  const data = Buffer.alloc(4 + 8);
  data.writeUInt32LE(DEPLOY_WITH_MAX_DATA_LEN_IX, 0);
  // maxDataLen as u64 LE
  data.writeBigUInt64LE(BigInt(maxDataLen), 4);
  return new TransactionInstruction({
    keys: [
      { pubkey: payerPubkey, isSigner: true, isWritable: true },
      { pubkey: programDataPubkey, isSigner: false, isWritable: true },
      { pubkey: programPubkey, isSigner: false, isWritable: true },
      { pubkey: bufferPubkey, isSigner: false, isWritable: true },
      { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: new PublicKey("SysvarC1ock11111111111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    programId: BPF_LOADER_UPGRADEABLE,
    data,
  });
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getLatestBlockhashWithRetry(
  connection: Connection,
  maxRetries = 5
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await connection.getLatestBlockhash("confirmed");
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await sleep(Math.min(2000 * attempt, 10000));
    }
  }

  throw new Error("unreachable");
}

async function confirmSignatureByPolling(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
  timeoutMs = 90000
): Promise<string> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const [status] = (
      await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      })
    ).value;

    if (status?.err) {
      throw new Error(
        `Signature ${signature} failed: ${JSON.stringify(status.err)}`
      );
    }

    if (
      status &&
      (status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized" ||
        status.confirmations === null)
    ) {
      return signature;
    }

    const currentBlockHeight = await connection.getBlockHeight("confirmed");
    if (currentBlockHeight > lastValidBlockHeight) {
      throw new Error(
        `Signature ${signature} has expired: block height exceeded.`
      );
    }

    await sleep(1000);
  }

  throw new Error(
    `Signature ${signature} was not confirmed within ${timeoutMs}ms.`
  );
}

async function sendWithRetry(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  label: string,
  maxRetries = 5
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { blockhash, lastValidBlockHeight } =
        await getLatestBlockhashWithRetry(connection);
      tx.recentBlockhash = blockhash;
      tx.sign(...signers);

      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 0,
        preflightCommitment: "confirmed",
      });
      return await confirmSignatureByPolling(
        connection,
        sig,
        lastValidBlockHeight
      );
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (
        msg.includes("already been processed") ||
        msg.includes("already processed")
      ) {
        // Transaction already landed — that's fine
        console.log(`  ${label}: already processed (ok)`);
        return "already-processed";
      }
      if (attempt === maxRetries) throw err;
      const delay = Math.min(1000 * 2 ** attempt, 10000);
      console.warn(`  ${label}: attempt ${attempt} failed (${msg.split("\n")[0]}), retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  throw new Error("unreachable");
}

async function main() {
  const rootDir = path.resolve(__dirname, "..");
  const soPath = path.resolve(rootDir, "target", "deploy", "shadowperp.so");
  const programKeypairPath = path.resolve(rootDir, "target", "deploy", "shadowperp-keypair.json");
  const bufferKeypairPath = path.resolve(rootDir, "target", "deploy", "shadowperp-buffer-keypair.json");
  const progressPath = path.resolve(
    rootDir,
    "target",
    "deploy",
    "shadowperp-buffer-progress.json"
  );
  const walletPath =
    process.env.SOLANA_WALLET ||
    path.resolve(process.env.HOME || process.env.USERPROFILE || "~", ".config", "solana", "id.json");

  if (!fs.existsSync(soPath)) throw new Error(`Missing: ${soPath}`);
  if (!fs.existsSync(programKeypairPath)) throw new Error(`Missing: ${programKeypairPath}`);
  if (!fs.existsSync(walletPath)) throw new Error(`Missing: ${walletPath}`);

  const rpcOverride = parseFlag("--rpc") || process.env.SOLANA_RPC_URL;
  const rpcSelection = await resolveRpcEndpoint({ preferred: rpcOverride, commitment: "confirmed" });
  const rpcUrl = rpcSelection.rpcUrl;

  const programKeypair = readKeypairFile(programKeypairPath);
  const walletKeypair = readKeypairFile(walletPath);
  const programId = programKeypair.publicKey;
  const connection = new Connection(rpcUrl, "confirmed");

  console.log("=== JS Program Deploy ===");
  console.log("RPC:", rpcUrl);
  console.log("Program ID:", programId.toBase58());
  console.log("Deployer:", walletKeypair.publicKey.toBase58());

  // Check if program already exists — if so, we'll upgrade instead of fresh deploy
  const existingInfo = await connection.getAccountInfo(programId);
  const isUpgrade = existingInfo?.executable === true;
  if (isUpgrade) {
    console.log("Program already deployed — will UPGRADE with new binary.");
  }

  // Read program binary
  const programData = fs.readFileSync(soPath);
  const programLen = programData.length;
  console.log(`Program binary: ${(programLen / 1024).toFixed(1)} KB`);

  // Buffer account needs: 4 (UpgradeableLoaderState::Buffer header) + programLen
  const BUFFER_HEADER_SIZE = 37; // UpgradeableLoaderState::Buffer serialized size
  const bufferSize = BUFFER_HEADER_SIZE + programLen;
  const bufferRent = await connection.getMinimumBalanceForRentExemption(bufferSize);

  // Check wallet balance
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log(`Wallet balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`Buffer rent: ${(bufferRent / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  if (balance < bufferRent + 0.5 * LAMPORTS_PER_SOL) {
    console.log("Insufficient balance, requesting airdrop...");
    try {
      const sig = await connection.requestAirdrop(walletKeypair.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
      console.log("Airdropped 2 SOL");
    } catch (e: any) {
      console.error("Airdrop failed:", e.message);
    }
  }

  // Check for existing buffer or create new one
  let bufferKeypair: Keypair;
  let bufferNeedsInit = true;

  if (fs.existsSync(bufferKeypairPath)) {
    bufferKeypair = readKeypairFile(bufferKeypairPath);
    const bufferInfo = await connection.getAccountInfo(bufferKeypair.publicKey);
    if (bufferInfo) {
      console.log(`Resuming with existing buffer: ${bufferKeypair.publicKey.toBase58()}`);
      bufferNeedsInit = false;
    } else {
      console.log(`Buffer keypair exists but no on-chain account. Will re-create.`);
    }
  } else {
    bufferKeypair = Keypair.generate();
    writeKeypairFile(bufferKeypairPath, bufferKeypair);
  }

  console.log("Buffer:", bufferKeypair.publicKey.toBase58());

  // Step 1: Create + initialize buffer account
  if (bufferNeedsInit) {
    console.log("\nStep 1: Creating buffer account...");
    const createAccountIx = SystemProgram.createAccount({
      fromPubkey: walletKeypair.publicKey,
      newAccountPubkey: bufferKeypair.publicKey,
      lamports: bufferRent,
      space: bufferSize,
      programId: BPF_LOADER_UPGRADEABLE,
    });
    const initIx = initializeBufferIx(bufferKeypair.publicKey, walletKeypair.publicKey);

    const tx = new Transaction().add(createAccountIx, initIx);
    tx.feePayer = walletKeypair.publicKey;

    await sendWithRetry(connection, tx, [walletKeypair, bufferKeypair], "create-buffer");
    console.log("Buffer created.");
  }

  // Step 2: Write program data in chunks
  const skipWrite = process.argv.includes("--finalize-only");
  const totalChunks = Math.ceil(programLen / WRITE_CHUNK_SIZE);
  const progress = readJsonFile<BufferProgress>(progressPath);
  let startChunkIndex = 0;

  if (
    progress &&
    progress.programId === programId.toBase58() &&
    progress.bufferPubkey === bufferKeypair.publicKey.toBase58() &&
    progress.totalChunks === totalChunks
  ) {
    startChunkIndex = Math.max(0, Math.min(progress.nextChunkIndex, totalChunks));
  } else if (progress) {
    // Old or mismatched progress should not block a fresh pass on the current buffer.
    try {
      fs.unlinkSync(progressPath);
    } catch {}
  }

  if (skipWrite) {
    console.log(`\nStep 2: Skipping write (--finalize-only), buffer already has ${totalChunks} chunks.`);
  } else {
    console.log(`\nStep 2: Writing ${programLen} bytes in ${totalChunks} chunks...`);
    if (startChunkIndex > 0) {
      console.log(
        `Resuming chunk writes at ${startChunkIndex + 1}/${totalChunks}.`
      );
    }
  }

  let successCount = 0;
  let skipCount = 0;

  for (let i = startChunkIndex; !skipWrite && i < totalChunks; i++) {
    const offset = i * WRITE_CHUNK_SIZE;
    const end = Math.min(offset + WRITE_CHUNK_SIZE, programLen);
    const chunk = programData.subarray(offset, end);

    const ix = writeIx(bufferKeypair.publicKey, walletKeypair.publicKey, offset, Buffer.from(chunk));

    try {
      const tx = new Transaction().add(ix);
      tx.feePayer = walletKeypair.publicKey;

      const sig = await sendWithRetry(
        connection,
        tx,
        [walletKeypair],
        `write ${i + 1}/${totalChunks} (offset ${offset})`
      );
      if (sig === "already-processed") {
        skipCount++;
      } else {
        successCount++;
      }
      writeJsonFile(progressPath, {
        programId: programId.toBase58(),
        bufferPubkey: bufferKeypair.publicKey.toBase58(),
        totalChunks,
        nextChunkIndex: i + 1,
      } satisfies BufferProgress);
    } catch (err: any) {
      console.error(`\nFailed at chunk ${i + 1}/${totalChunks} (offset ${offset}): ${err.message}`);
      console.error("Re-run to resume from this point.");
      process.exit(1);
    }

    // Progress every 50 chunks
    if ((i + 1) % 50 === 0 || i + 1 === totalChunks) {
      console.log(`  Progress: ${i + 1}/${totalChunks} chunks (${((i + 1) / totalChunks * 100).toFixed(1)}%)`);
    }
  }

  console.log(`Write complete: ${successCount} sent, ${skipCount} already processed.`);

  // programdata PDA
  const [programDataPubkey] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE
  );

  if (isUpgrade) {
    // Step 3: Upgrade existing program
    console.log("\nStep 3: Upgrading program from buffer...");
    const uix = upgradeIx(
      programDataPubkey,
      programId,
      bufferKeypair.publicKey,
      walletKeypair.publicKey,
      walletKeypair.publicKey,
    );
    const utx = new Transaction().add(uix);
    utx.feePayer = walletKeypair.publicKey;

    await sendWithRetry(connection, utx, [walletKeypair], "upgrade", 10);
  } else {
    // Step 3: Fresh deploy — must create the program account first
    console.log("\nStep 3: Deploying program from buffer...");

    // Check if program account already exists (from a prior partial deploy)
    const existingProgramAcct = await connection.getAccountInfo(programId);
    if (!existingProgramAcct) {
      console.log("  Creating program account...");
      const PROGRAM_ACCOUNT_SIZE = 36; // UpgradeableLoaderState::Program
      const programRent = await connection.getMinimumBalanceForRentExemption(PROGRAM_ACCOUNT_SIZE);
      const createProgramIx = SystemProgram.createAccount({
        fromPubkey: walletKeypair.publicKey,
        newAccountPubkey: programId,
        lamports: programRent,
        space: PROGRAM_ACCOUNT_SIZE,
        programId: BPF_LOADER_UPGRADEABLE,
      });
      const cpTx = new Transaction().add(createProgramIx);
      cpTx.feePayer = walletKeypair.publicKey;
      await sendWithRetry(connection, cpTx, [walletKeypair, programKeypair], "create-program-account", 5);
      console.log("  Program account created.");
    }

    const maxDataLen = programLen * 2;
    const PROGRAMDATA_HEADER = 45; // UpgradeableLoaderState::ProgramData header
    const programdataLen = PROGRAMDATA_HEADER + maxDataLen;
    const programdataRent = await connection.getMinimumBalanceForRentExemption(programdataLen);
    const walletBal = await connection.getBalance(walletKeypair.publicKey);
    console.log(`  ProgramData rent: ${(programdataRent / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    console.log(`  Wallet balance: ${(walletBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

    if (walletBal < programdataRent) {
      console.error(`Insufficient balance for programdata rent. Need ${(programdataRent / LAMPORTS_PER_SOL).toFixed(4)} SOL.`);
      process.exit(1);
    }

    const dix = deployIx(
      walletKeypair.publicKey,
      programDataPubkey,
      programId,
      bufferKeypair.publicKey,
      walletKeypair.publicKey,
      maxDataLen
    );
    const dtx = new Transaction().add(dix);
    dtx.feePayer = walletKeypair.publicKey;

    await sendWithRetry(connection, dtx, [walletKeypair, programKeypair], "deploy-finalize", 10);
  }

  // Verify
  console.log("\nStep 4: Verifying deployment...");
  for (let attempt = 1; attempt <= 10; attempt++) {
    const info = await connection.getAccountInfo(programId);
    if (info?.executable) {
      console.log(`\n=== Deploy Success ===`);
      console.log(`Program ID: ${programId.toBase58()}`);
      console.log(`Program Data: ${programDataPubkey.toBase58()}`);

      // Clean up buffer keypair
      try { fs.unlinkSync(bufferKeypairPath); } catch {}
      try { fs.unlinkSync(progressPath); } catch {}
      return;
    }
    await sleep(3000);
  }

  console.error("Program not visible after deploy. Check manually.");
  process.exit(1);
}

main().catch((err) => {
  console.error("JS deploy failed:", err);
  process.exit(1);
});
