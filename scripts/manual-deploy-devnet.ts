import { execFileSync, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { resolveRpcEndpoint } from "./rpc";

type Command = "status" | "deploy" | "finalize" | "full" | "close-buffer";

const WSL_SOLANA_BIN = "$HOME/.local/share/solana-2.3.13/active_release/bin";

function toWslPath(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!match) return normalized;
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

function quoteForBash(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function readKeypair(keypairPath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

function writeKeypair(keypairPath: string, keypair: Keypair): void {
  fs.mkdirSync(path.dirname(keypairPath), { recursive: true });
  fs.writeFileSync(keypairPath, JSON.stringify(Array.from(keypair.secretKey)));
}

function ensureBufferKeypair(bufferKeypairPath: string): Keypair {
  if (fs.existsSync(bufferKeypairPath)) {
    return readKeypair(bufferKeypairPath);
  }
  const keypair = Keypair.generate();
  writeKeypair(bufferKeypairPath, keypair);
  return keypair;
}

function deriveWsUrl(rpcUrl: string): string {
  try {
    const url = new URL(rpcUrl);
    if (url.protocol === "https:") url.protocol = "wss:";
    else if (url.protocol === "http:") url.protocol = "ws:";
    return url.toString();
  } catch {
    return rpcUrl.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  }
}

function runWsl(command: string, inherit = true): string {
  return execFileSync("wsl", ["bash", "-lc", command], {
    cwd: path.resolve(__dirname, ".."),
    stdio: inherit ? "inherit" : "pipe",
    env: process.env,
    encoding: "utf-8",
  });
}

async function waitForExecutable(connection: Connection, programId: PublicKey): Promise<boolean> {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const accountInfo = await connection.getAccountInfo(programId, "confirmed");
      if (accountInfo?.executable) return true;
    } catch {
      // Retry below.
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  return false;
}

function parseCommand(argv: string[]): Command {
  const candidate = (argv[2] ?? "status") as Command;
  if (
    candidate === "status" ||
    candidate === "deploy" ||
    candidate === "finalize" ||
    candidate === "full" ||
    candidate === "close-buffer"
  ) {
    return candidate;
  }
  throw new Error(`Unknown command: ${candidate}`);
}

function parseFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1];
}

async function main() {
  const command = parseCommand(process.argv);
  const rootDir = path.resolve(__dirname, "..");
  const soPath = path.resolve(rootDir, "target", "deploy", "shadowperp.so");
  const programKeypairPath = path.resolve(rootDir, "target", "deploy", "shadowperp-keypair.json");
  const bufferKeypairPath =
    parseFlag(process.argv, "--buffer-keypair") ??
    path.resolve(rootDir, "target", "deploy", "shadowperp-buffer-keypair.json");
  const walletPath =
    process.env.SOLANA_WALLET ||
    path.resolve(process.env.HOME || process.env.USERPROFILE || "~", ".config", "solana", "id.json");

  if (!fs.existsSync(soPath)) {
    throw new Error(`Missing program binary: ${soPath}`);
  }
  if (!fs.existsSync(programKeypairPath)) {
    throw new Error(`Missing program keypair: ${programKeypairPath}`);
  }
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Missing deploy wallet: ${walletPath}`);
  }

  const rpcOverride = parseFlag(process.argv, "--rpc") ?? process.env.SOLANA_RPC_URL;
  const rpcSelection = await resolveRpcEndpoint({
    preferred: rpcOverride,
    commitment: "confirmed",
    requireHealthy: !rpcOverride,
  });
  const rpcUrl = rpcSelection.rpcUrl;
  const wsUrl = deriveWsUrl(rpcUrl);

  const programKeypair = readKeypair(programKeypairPath);
  const walletKeypair = readKeypair(walletPath);
  const bufferKeypair = ensureBufferKeypair(bufferKeypairPath);
  const connection = new Connection(rpcUrl, "confirmed");

  const programId = programKeypair.publicKey;
  const bufferPubkey = bufferKeypair.publicKey;
  const walletPubkey = walletKeypair.publicKey;

  if (command === "status") {
    const [walletBalance, programInfo, bufferInfo] = await Promise.all([
      connection.getBalance(walletPubkey, "confirmed"),
      connection.getAccountInfo(programId, "confirmed").catch(() => null),
      connection.getAccountInfo(bufferPubkey, "confirmed").catch(() => null),
    ]);
    console.log("RPC URL:", rpcUrl);
    console.log("Wallet:", walletPubkey.toBase58());
    console.log("Wallet SOL:", walletBalance / LAMPORTS_PER_SOL);
    console.log("Program ID:", programId.toBase58());
    console.log("Program Visible:", Boolean(programInfo));
    console.log("Program Executable:", Boolean(programInfo?.executable));
    console.log("Buffer Keypair:", bufferKeypairPath);
    console.log("Buffer Pubkey:", bufferPubkey.toBase58());
    console.log("Buffer Exists:", Boolean(bufferInfo));
    return;
  }

  if (command === "close-buffer") {
    const closeCmdLine = [
      `${WSL_SOLANA_BIN}/solana program close ${bufferPubkey.toBase58()}`,
      `--keypair ${quoteForBash(toWslPath(walletPath))}`,
      `--url ${quoteForBash(rpcUrl)}`,
    ].join(" ");
    const closeCmd = [
      `export PATH="${WSL_SOLANA_BIN}:$PATH"`,
      closeCmdLine,
    ].join(" && ");
    try {
      runWsl(closeCmd);
    } catch (error: any) {
      const message = String(error?.message || error);
      if (message.includes("Unable to find the account")) {
        console.log(`Buffer ${bufferPubkey.toBase58()} is already absent.`);
        return;
      }
      throw error;
    }
    return;
  }

  if (command === "deploy" || command === "full") {
    console.log("RPC URL:", rpcUrl);
    console.log("Program ID:", programId.toBase58());
    console.log("Buffer Pubkey:", bufferPubkey.toBase58());
    const writeBufferCmdLine = [
      `${WSL_SOLANA_BIN}/solana program write-buffer ${quoteForBash(toWslPath(soPath))}`,
      `--buffer ${quoteForBash(toWslPath(bufferKeypairPath))}`,
      `--keypair ${quoteForBash(toWslPath(walletPath))}`,
      `--url ${quoteForBash(rpcUrl)}`,
      `--ws ${quoteForBash(wsUrl)}`,
      `--use-rpc`,
      `--with-compute-unit-price 10000`,
      `--max-sign-attempts 100`,
    ].join(" ");
    const deployFromBufferCmdLine = [
      `${WSL_SOLANA_BIN}/solana program deploy`,
      `--program-id ${quoteForBash(toWslPath(programKeypairPath))}`,
      `--buffer ${quoteForBash(toWslPath(bufferKeypairPath))}`,
      `--keypair ${quoteForBash(toWslPath(walletPath))}`,
      `--url ${quoteForBash(rpcUrl)}`,
      `--ws ${quoteForBash(wsUrl)}`,
      `--use-rpc`,
      `--with-compute-unit-price 10000`,
      `--max-sign-attempts 100`,
    ].join(" ");
    const deployCmd = [
      `export PATH="${WSL_SOLANA_BIN}:$PATH"`,
      `cd ${quoteForBash(toWslPath(rootDir))}`,
      writeBufferCmdLine,
      deployFromBufferCmdLine,
    ].join(" && ");

    try {
      runWsl(deployCmd);
    } catch {
      console.error("Manual deploy failed. Re-run the same command to resume with the persistent buffer.");
      console.error(`Persistent buffer: ${bufferPubkey.toBase58()}`);
      process.exit(1);
    }

    const visible = await waitForExecutable(connection, programId);
    if (!visible) {
      console.error(
        `Program ${programId.toBase58()} was not visible on ${rpcUrl} after deploy.`
      );
      process.exit(1);
    }
  }

  if (command === "finalize" || command === "full") {
    const env = {
      ...process.env,
      SOLANA_RPC_URL: rpcUrl,
      SKIP_ANCHOR_DEPLOY: "1",
    };
    execSync("npx ts-node scripts/deploy-devnet.ts --skip-deploy", {
      cwd: rootDir,
      stdio: "inherit",
      env,
    });
  }
}

main().catch((error) => {
  console.error("Manual deploy helper failed:", error);
  process.exit(1);
});
