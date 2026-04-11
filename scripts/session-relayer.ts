/**
 * Delegated session relayer flow for ShadowPerp.
 *
 * Commands:
 *   create  - owner approves a delegated session (default expiry: 5 hours)
 *   status  - inspect session account state
 *   revoke  - owner revokes a delegated session
 *   open    - relayer opens encrypted position under active session
 *   close   - relayer closes position under active session
 *   settle-close - permissionlessly settles a close after callback
 *   settle-liquidation - permissionlessly settles a liquidation after callback
 *   smoke   - create session, then try one delegated open
 *
 * Examples:
 *   npx ts-node scripts/session-relayer.ts create --max-actions 50 --max-margin-usdc 10
 *   npx ts-node scripts/session-relayer.ts status --session-id 123
 *   npx ts-node scripts/session-relayer.ts open --session-id 123 --owner <OWNER_PUBKEY>
 *   npx ts-node scripts/session-relayer.ts smoke
 */

import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import {
  getArciumProgramId,
  getClusterAccAddress,
  getExecutingPoolAccAddress,
  getFeePoolAccAddress,
  getMempoolAccAddress,
} from "@arcium-hq/client";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveRpcEndpoint } from "./rpc";
import {
  DEFAULT_TRADE_SESSION_DURATION_SECONDS,
  ShadowPerpClient,
} from "../app/src/lib/client";
import type { OpenPositionInput, ShadowPerpConfig } from "../app/src/types";

type ParsedArgs = {
  command: string;
  flags: Record<string, string>;
};

function normalizeValue(raw?: string): string | undefined {
  if (!raw) return undefined;
  let out = raw.trim();
  if (!out) return undefined;
  if (out.startsWith("<") && out.endsWith(">")) {
    out = out.slice(1, -1).trim();
  }
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'"))
  ) {
    out = out.slice(1, -1).trim();
  }
  return out || undefined;
}

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    const value = normalizeValue(line.slice(sep + 1));
    if (!value) continue;
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = "1";
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positional.push(token);
    }
  }

  return {
    command: positional[0] || "smoke",
    flags,
  };
}

function parsePublicKey(name: string, value?: string): PublicKey {
  const normalized = normalizeValue(value);
  if (!normalized) {
    throw new Error(`Missing required value: ${name}`);
  }
  return new PublicKey(normalized);
}

function parsePositiveInt(
  name: string,
  value: string | undefined,
  fallback: number,
  options?: { allowZero?: boolean }
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  const min = options?.allowZero ? 0 : 1;
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function parsePositiveNumber(
  name: string,
  value: string | undefined,
  fallback: number
): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function parseMarginMode(value: string | undefined): "cross" | "isolated" {
  if (!value) return "cross";
  const normalized = value.trim().toLowerCase();
  if (normalized === "cross" || normalized === "isolated") {
    return normalized;
  }
  throw new Error(`Invalid margin-mode: ${value}`);
}

function resolveWalletPath(value?: string): string {
  const normalized = normalizeValue(value);
  if (normalized && fs.existsSync(normalized)) return normalized;

  if (process.env.SOLANA_WALLET && fs.existsSync(process.env.SOLANA_WALLET)) {
    return process.env.SOLANA_WALLET;
  }

  const fallback = path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(fallback)) {
    throw new Error(`Wallet keypair not found: ${fallback}`);
  }
  return fallback;
}

function loadKeypair(keypairPath: string): Keypair {
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, "utf8")))
  );
}

function resolveIdlPath(): string {
  const candidates = [
    path.resolve(__dirname, "..", "target", "idl", "shadowperp.json"),
    path.resolve(__dirname, "..", "app", "src", "idl", "shadowperp.json"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      "IDL not found at target/idl/shadowperp.json or app/src/idl/shadowperp.json."
    );
  }
  return found;
}

function buildClientConfig(
  idl: any,
  programId: PublicKey,
  marketAddress: PublicKey,
  arciumProgramId: PublicKey,
  mxeProgramId: PublicKey,
  clusterOffset: number
): ShadowPerpConfig {
  const clusterAddress = getClusterAccAddress(clusterOffset);
  const [signPdaAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("ArciumSignerAccount")],
    programId
  );

  return {
    idl,
    programId,
    arciumProgramId,
    mxeProgramId,
    clusterOffset,
    clusterAddress,
    marketAddress,
    marketRegistry: {
      "SOL-USD": marketAddress,
    },
    mempoolAccount: getMempoolAccAddress(clusterOffset),
    executingPool: getExecutingPoolAccAddress(clusterOffset),
    poolAccount: getFeePoolAccAddress(),
    signPdaAccount,
  };
}

function toIsoUnix(unixTs: number): string {
  return new Date(unixTs * 1000).toISOString();
}

function toUsdcRaw(usdc: number): BN {
  return new BN(Math.round(usdc * 1_000_000));
}

async function makeProvider(
  keypairPath: string,
  rpcUrl: string
): Promise<anchor.AnchorProvider> {
  const signer = loadKeypair(keypairPath);
  const connection = new Connection(rpcUrl, "confirmed");
  return new anchor.AnchorProvider(connection, new anchor.Wallet(signer), {
    commitment: "confirmed",
  });
}

async function createSessionFlow(params: {
  ownerProvider: anchor.AnchorProvider;
  idl: any;
  programId: PublicKey;
  marketAddress: PublicKey;
  arciumProgramId: PublicKey;
  mxeProgramId: PublicKey;
  clusterOffset: number;
  relayer: PublicKey;
  sessionId: BN;
  maxActions: number;
  maxMarginPerAction: BN;
  hours: number;
}): Promise<{ txSignature: string; sessionAddress: PublicKey; expiresAt: BN }> {
  const client = new ShadowPerpClient(
    params.ownerProvider,
    buildClientConfig(
      params.idl,
      params.programId,
      params.marketAddress,
      params.arciumProgramId,
      params.mxeProgramId,
      params.clusterOffset
    )
  );

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = new BN(nowSeconds + Math.floor(params.hours * 3600));
  const result = await client.createTradeSession(
    params.marketAddress,
    params.sessionId,
    params.relayer,
    params.maxActions,
    params.maxMarginPerAction,
    expiresAt
  );
  return { ...result, expiresAt };
}

async function main(): Promise<void> {
  loadEnvFile(path.resolve(__dirname, "..", "app", ".env.local"));

  const parsed = parseArgs(process.argv);
  const flags = parsed.flags;

  const rpcSelection = await resolveRpcEndpoint({
    preferred:
      normalizeValue(flags.rpc) ||
      process.env.SOLANA_RPC_URL ||
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    commitment: "confirmed",
  });
  const rpcUrl = rpcSelection.rpcUrl;

  const programId = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID",
    process.env.SHADOWPERP_PROGRAM_ID || process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID
  );
  const marketAddress = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT",
    process.env.SHADOWPERP_MARKET || process.env.NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT
  );
  const arciumProgramId = parsePublicKey(
    "NEXT_PUBLIC_ARCIUM_PROGRAM_ID",
    process.env.NEXT_PUBLIC_ARCIUM_PROGRAM_ID || getArciumProgramId().toBase58()
  );
  const mxeProgramId = parsePublicKey(
    "NEXT_PUBLIC_ARCIUM_MXE_PROGRAM_ID",
    process.env.NEXT_PUBLIC_ARCIUM_MXE_PROGRAM_ID ||
      process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID
  );
  const clusterOffset = parsePositiveInt(
    "NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET",
    process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET,
    456
  );

  const ownerWalletPath = resolveWalletPath(flags["owner-wallet"]);
  const relayerWalletPath = resolveWalletPath(flags["relayer-wallet"]);
  const ownerProvider = await makeProvider(ownerWalletPath, rpcUrl);
  const relayerProvider = await makeProvider(relayerWalletPath, rpcUrl);
  const ownerPubkey = ownerProvider.wallet.publicKey;
  const relayerFromWallet = relayerProvider.wallet.publicKey;
  const relayerPubkey = flags.relayer
    ? parsePublicKey("relayer", flags.relayer)
    : relayerFromWallet;

  const idlPath = resolveIdlPath();
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  (idl as { address?: string }).address = programId.toBase58();

  const sessionId = new BN(
    parsePositiveInt("session-id", flags["session-id"], Math.floor(Date.now() / 1000))
  );
  const maxActions = parsePositiveInt("max-actions", flags["max-actions"], 50);
  const maxMarginUsdc = parsePositiveNumber(
    "max-margin-usdc",
    flags["max-margin-usdc"],
    25
  );
  const sessionHours = parsePositiveNumber(
    "hours",
    flags.hours,
    DEFAULT_TRADE_SESSION_DURATION_SECONDS / 3600
  );

  const ownerForDelegated = flags.owner
    ? parsePublicKey("owner", flags.owner)
    : ownerPubkey;

  const relayerClient = new ShadowPerpClient(
    relayerProvider,
    buildClientConfig(
      idl,
      programId,
      marketAddress,
      arciumProgramId,
      mxeProgramId,
      clusterOffset
    )
  );

  switch (parsed.command) {
    case "create": {
      const created = await createSessionFlow({
        ownerProvider,
        idl,
        programId,
        marketAddress,
        arciumProgramId,
        mxeProgramId,
        clusterOffset,
        relayer: relayerPubkey,
        sessionId,
        maxActions,
        maxMarginPerAction: toUsdcRaw(maxMarginUsdc),
        hours: sessionHours,
      });
      console.log("Trade session created");
      console.log(`  Session ID:      ${sessionId.toString()}`);
      console.log(`  Session Address: ${created.sessionAddress.toBase58()}`);
      console.log(`  Relayer:         ${relayerPubkey.toBase58()}`);
      console.log(`  Max actions:     ${maxActions}`);
      console.log(`  Max margin:      ${maxMarginUsdc} USDC`);
      console.log(`  Expires at:      ${toIsoUnix(created.expiresAt.toNumber())}`);
      console.log(`  Tx:              ${created.txSignature}`);
      console.log(
        `  Explorer:        https://explorer.solana.com/tx/${created.txSignature}?cluster=devnet`
      );
      break;
    }

    case "status": {
      const sessionAddress = relayerClient.getTradeSessionAddress(
        marketAddress,
        ownerForDelegated,
        sessionId
      );
      const session = await relayerClient.getTradeSession(sessionAddress);
      console.log("Trade session status");
      console.log(`  Session ID:      ${session.sessionId.toString()}`);
      console.log(`  Session Address: ${sessionAddress.toBase58()}`);
      console.log(`  Owner:           ${session.owner.toBase58()}`);
      console.log(`  Relayer:         ${session.relayer.toBase58()}`);
      console.log(`  Used actions:    ${session.usedActions}/${session.maxActions}`);
      console.log(
        `  Max margin:      ${(Number(session.maxMarginPerAction.toString()) / 1_000_000).toFixed(6)} USDC`
      );
      console.log(`  Expires at:      ${toIsoUnix(Number(session.expiresAt.toString()))}`);
      console.log(`  Revoked:         ${session.revoked}`);
      break;
    }

    case "revoke": {
      const ownerClient = new ShadowPerpClient(
        ownerProvider,
        buildClientConfig(
          idl,
          programId,
          marketAddress,
          arciumProgramId,
          mxeProgramId,
          clusterOffset
        )
      );
      const tx = await ownerClient.revokeTradeSession(marketAddress, sessionId);
      console.log("Trade session revoked");
      console.log(`  Session ID: ${sessionId.toString()}`);
      console.log(`  Tx:         ${tx}`);
      console.log(`  Explorer:   https://explorer.solana.com/tx/${tx}?cluster=devnet`);
      break;
    }

    case "open": {
      const market = await relayerClient.getMarket(marketAddress);
      const direction =
        (flags.direction || "long").toLowerCase() === "short" ? "short" : "long";
      const leverage = parsePositiveInt("leverage", flags.leverage, 2);
      const marginMode = parseMarginMode(flags["margin-mode"]);
      const marginUsdc = parsePositiveNumber("margin-usdc", flags["margin-usdc"], 1);
      const sizeUsdc = parsePositiveNumber("size-usdc", flags["size-usdc"], marginUsdc * leverage);
      const entryPrice = new BN(market.oraclePrice.toString());
      const input: OpenPositionInput = {
        size: toUsdcRaw(sizeUsdc),
        entryPrice,
        leverage,
        direction,
        margin: toUsdcRaw(marginUsdc),
        marginMode,
      };

      const result = await relayerClient.openPositionWithSessionAndFinalize(
        marketAddress,
        ownerForDelegated,
        sessionId,
        input
      );
      console.log("Delegated open finalized");
      console.log(`  Session ID: ${sessionId.toString()}`);
      console.log(`  Owner:      ${ownerForDelegated.toBase58()}`);
      console.log(`  Relayer:    ${relayerProvider.wallet.publicKey.toBase58()}`);
      console.log(`  Position:   ${result.positionAddress.toBase58()}`);
      console.log(`  Tx:         ${result.txSignature}`);
      console.log("  Status:     Open");
      console.log(
        `  Explorer:   https://explorer.solana.com/tx/${result.txSignature}?cluster=devnet`
      );
      break;
    }

    case "close": {
      const index = parsePositiveInt("position-index", flags["position-index"], -1, {
        allowZero: true,
      });
      if (index < 0) {
        throw new Error("close requires --position-index <u64>");
      }
      const market = await relayerClient.getMarket(marketAddress);
      const ownerTokenAccount = await getAssociatedTokenAddress(
        market.collateralMint,
        ownerForDelegated
      );
      const tx = await relayerClient.closePositionWithSession(
        marketAddress,
        ownerForDelegated,
        sessionId,
        new BN(index)
      );
      console.log("Delegated close queued");
      console.log(`  Session ID: ${sessionId.toString()}`);
      console.log(`  Position:   ${index}`);
      console.log(`  Tx:         ${tx}`);
      console.log(`  Explorer:   https://explorer.solana.com/tx/${tx}?cluster=devnet`);
      const finalized = await relayerClient.finalizeClosePosition(
        marketAddress,
        ownerForDelegated,
        new BN(index),
        ownerTokenAccount
      );
      if (finalized.settleTxSignature) {
        console.log("Close settlement submitted");
        console.log(`  Settle tx:   ${finalized.settleTxSignature}`);
        console.log(
          `  Explorer:    https://explorer.solana.com/tx/${finalized.settleTxSignature}?cluster=devnet`
        );
      } else {
        console.log("Close was already settled on-chain");
      }
      console.log(`  Final status: ${finalized.status}`);
      break;
    }

    case "settle-close": {
      const index = parsePositiveInt("position-index", flags["position-index"], -1, {
        allowZero: true,
      });
      if (index < 0) {
        throw new Error("settle-close requires --position-index <u64>");
      }
      const market = await relayerClient.getMarket(marketAddress);
      const ownerTokenAccount = await getAssociatedTokenAddress(
        market.collateralMint,
        ownerForDelegated
      );
      const tx = await relayerClient.settleClosePosition(
        marketAddress,
        ownerForDelegated,
        new BN(index),
        ownerTokenAccount
      );
      console.log("Close settlement submitted");
      console.log(`  Position: ${index}`);
      console.log(`  Tx:       ${tx}`);
      console.log(`  Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`);
      break;
    }

    case "settle-liquidation": {
      const index = parsePositiveInt("position-index", flags["position-index"], -1, {
        allowZero: true,
      });
      if (index < 0) {
        throw new Error("settle-liquidation requires --position-index <u64>");
      }
      const market = await relayerClient.getMarket(marketAddress);
      const liquidatorTokenAccount = await getAssociatedTokenAddress(
        market.collateralMint,
        relayerProvider.wallet.publicKey
      );
      const tx = await relayerClient.settleLiquidation(
        marketAddress,
        ownerForDelegated,
        new BN(index),
        liquidatorTokenAccount
      );
      console.log("Liquidation settlement submitted");
      console.log(`  Position:   ${index}`);
      console.log(`  Liquidator: ${relayerProvider.wallet.publicKey.toBase58()}`);
      console.log(`  Tx:         ${tx}`);
      console.log(`  Explorer:   https://explorer.solana.com/tx/${tx}?cluster=devnet`);
      break;
    }

    case "smoke": {
      const created = await createSessionFlow({
        ownerProvider,
        idl,
        programId,
        marketAddress,
        arciumProgramId,
        mxeProgramId,
        clusterOffset,
        relayer: relayerPubkey,
        sessionId,
        maxActions: Math.max(2, maxActions),
        maxMarginPerAction: toUsdcRaw(maxMarginUsdc),
        hours: sessionHours,
      });
      console.log("Smoke step 1/2: session created");
      console.log(`  Session ID:      ${sessionId.toString()}`);
      console.log(`  Session Address: ${created.sessionAddress.toBase58()}`);
      console.log(`  Expires at:      ${toIsoUnix(created.expiresAt.toNumber())}`);
      console.log(`  Create tx:       ${created.txSignature}`);

      try {
        const market = await relayerClient.getMarket(marketAddress);
        const input: OpenPositionInput = {
          size: toUsdcRaw(2),
          entryPrice: new BN(market.oraclePrice.toString()),
          leverage: 2,
          direction: "long",
          margin: toUsdcRaw(1),
          marginMode: "cross",
        };

        const opened = await relayerClient.openPositionWithSessionAndFinalize(
          marketAddress,
          ownerForDelegated,
          sessionId,
          input
        );
        console.log("Smoke step 2/2: delegated open finalized");
        console.log(`  Position: ${opened.positionAddress.toBase58()}`);
        console.log(`  Open tx:  ${opened.txSignature}`);
      } catch (error: any) {
        const message = String(error?.message || error).split("\n")[0];
        console.error("Smoke step 2/2 failed during delegated open.");
        console.error(`  Error: ${message}`);
        throw error;
      }
      break;
    }

    default:
      throw new Error(
        `Unknown command: ${parsed.command}. Use create|status|revoke|open|close|settle-close|settle-liquidation|smoke`
      );
  }
}

main().catch((error) => {
  console.error(
    "session-relayer failed:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
