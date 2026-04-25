/**
 * POST /api/faucet-mock-usdc
 *
 * Transfers mUSDC from the faucet wallet directly to the authenticated user's token account.
 * No user signature required; faucet signs and broadcasts the tx itself.
 * User deposits to margin separately via the Collateral modal.
 * Availability is based on wallet mUSDC, not Shadow margin balance.
 *
 * Body:   { wallet: string }
 * Response:
 *   { success: true; signature: string; amount: number }
 *   { success: false; error: string; nextClaimAt?: number }
 */
import type { NextApiRequest, NextApiResponse } from "next";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { FAUCET_FIRST_CLAIM_USDC, FAUCET_CAP_USDC, FAUCET_TRIGGER_USDC, MUSDC_DECIMALS } from "../../lib/faucet-constants";
import { checkRateLimit } from "../../lib/server/rate-limit";
import { getRequestIp, requirePrivySolanaWallet } from "../../lib/server/privy-auth";

const CAP_USDC     = FAUCET_CAP_USDC;
const TRIGGER_USDC = FAUCET_TRIGGER_USDC;
const DECIMALS     = MUSDC_DECIMALS;
const COOLDOWN_MS  = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_RPC = "https://api.devnet.solana.com";
const USER_RATE_LIMIT = 3;
const IP_RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;

// In-memory cooldown resets on cold start; Privy auth + rate limits provide the server-side abuse gate.
const cooldowns = new Map<string, number>();

function normalizeRpcUrl(raw?: string): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;
  if (value.startsWith("<") && value.endsWith(">")) {
    value = value.slice(1, -1).trim();
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value || null;
}

function parseRpcList(raw?: string): string[] {
  const normalized = normalizeRpcUrl(raw);
  if (!normalized) return [];
  return normalized
    .split(/[\n,]+/)
    .map((entry) => normalizeRpcUrl(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function getRpcCandidates(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string | null) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  };

  for (const url of parseRpcList(process.env.SOLANA_RPC_URLS)) push(url);
  for (const url of parseRpcList(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS)) push(url);
  push(normalizeRpcUrl(process.env.SOLANA_RPC_URL));
  push(normalizeRpcUrl(process.env.NEXT_PUBLIC_SOLANA_RPC_URL));
  push(DEFAULT_RPC);

  return out;
}

async function getHealthyConnection(): Promise<Connection> {
  const attempts: string[] = [];

  for (const url of getRpcCandidates()) {
    const connection = new Connection(url, "confirmed");
    try {
      await Promise.race([
        connection.getLatestBlockhash("processed"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("rpc probe timeout")), 4_500)
        ),
      ]);
      return connection;
    } catch (error: any) {
      attempts.push(`${url} :: ${String(error?.message || error).split("\n")[0]}`);
    }
  }

  throw new Error(
    `No healthy RPC endpoint found. ${attempts.join(" | ")}`
  );
}

function getMockUsdcMint(): PublicKey {
  const mint = process.env.NEXT_PUBLIC_MOCKUSDC_MINT;
  if (!mint) throw new Error("NEXT_PUBLIC_MOCKUSDC_MINT env var not set");
  return new PublicKey(mint);
}

function getFaucetKeypair(): Keypair {
  const secret = process.env.FAUCET_WALLET_SECRET_KEY;
  if (secret) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(secret) as number[]));
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Faucet wallet not configured. Set FAUCET_WALLET_SECRET_KEY env var.");
  }
  const walletPath =
    process.env.SOLANA_WALLET ||
    path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(walletPath)) {
    throw new Error("Faucet wallet not configured. Set FAUCET_WALLET_SECRET_KEY env var.");
  }
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
}

async function fetchWalletTokenBalanceRaw(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey
): Promise<bigint> {
  try {
    const tokenAccount = await getAssociatedTokenAddress(mint, owner);
    const balance = await connection.getTokenAccountBalance(tokenAccount);
    return BigInt(balance.value.amount);
  } catch {
    return BigInt(0);
  }
}

type FaucetResponse =
  | { success: true; signature: string; amount: number }
  | { success: false; error: string; nextClaimAt?: number };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<FaucetResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { wallet } = ((req.body as { wallet?: string } | undefined) ?? {}) as {
    wallet?: string;
  };

  if (!wallet || typeof wallet !== "string") {
    return res.status(400).json({ success: false, error: "wallet address required" });
  }

  let recipientPubkey: PublicKey;
  try {
    recipientPubkey = new PublicKey(wallet);
  } catch {
    return res.status(400).json({ success: false, error: "Invalid wallet address" });
  }

  let userId: string;
  try {
    ({ userId } = await requirePrivySolanaWallet(req, recipientPubkey.toBase58()));
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: error instanceof Error ? error.message : "Authentication required.",
    });
  }

  if (
    !checkRateLimit(`faucet:user:${userId}`, USER_RATE_LIMIT, RATE_WINDOW_MS) ||
    !checkRateLimit(`faucet:ip:${getRequestIp(req)}`, IP_RATE_LIMIT, RATE_WINDOW_MS)
  ) {
    return res.status(429).json({
      success: false,
      error: "Too many faucet attempts. Try again later.",
    });
  }

  // Cooldown check (in-memory, best-effort)
  const now = Date.now();
  const lastClaim = cooldowns.get(wallet);
  if (lastClaim !== undefined) {
    const elapsed = now - lastClaim;
    if (elapsed < COOLDOWN_MS) {
      const nextClaimAt = lastClaim + COOLDOWN_MS;
      const daysLeft = Math.ceil((COOLDOWN_MS - elapsed) / (1000 * 60 * 60 * 24));
      return res.status(429).json({
        success: false,
        error: `You can claim again in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
        nextClaimAt,
      });
    }
  }

  try {
    const connection = await getHealthyConnection();
    const mintAddress = getMockUsdcMint();
    const balanceRaw = await fetchWalletTokenBalanceRaw(
      connection,
      recipientPubkey,
      mintAddress
    );
    const balanceUsdc = Number(balanceRaw) / 10 ** DECIMALS;

    if (balanceUsdc >= TRIGGER_USDC) {
      return res.status(400).json({
        success: false,
        error: `Wallet balance is ${Math.floor(balanceUsdc).toLocaleString()} mUSDC - no top-up needed until it falls below ${TRIGGER_USDC.toLocaleString()}.`,
      });
    }

    // First-time: send FAUCET_FIRST_CLAIM_USDC. Top-up: send delta to reach cap.
    const isFirstTime = balanceUsdc === 0;
    const sendUsdc = isFirstTime
      ? FAUCET_FIRST_CLAIM_USDC
      : Math.max(1, CAP_USDC - Math.floor(balanceUsdc));
    const sendRaw = BigInt(sendUsdc) * BigInt(10 ** DECIMALS);

    const faucet = getFaucetKeypair();
    const faucetAta    = await getAssociatedTokenAddress(mintAddress, faucet.publicKey);
    const recipientAta = await getAssociatedTokenAddress(mintAddress, recipientPubkey);

    const tx = new Transaction();

    // Create recipient ATA if needed — faucet pays rent
    const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
    if (!recipientAtaInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          faucet.publicKey,
          recipientAta,
          recipientPubkey,
          mintAddress
        )
      );
    }

    tx.add(
      createTransferInstruction(
        faucetAta,
        recipientAta,
        faucet.publicKey,
        sendRaw,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = faucet.publicKey;
    tx.sign(faucet);

    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(signature, "confirmed");

    cooldowns.set(wallet, now);

    return res.status(200).json({ success: true, signature, amount: sendUsdc });
  } catch (err: any) {
    console.error("[faucet-mock-usdc]", err);
    const message =
      typeof err?.message === "string" && err.message.trim()
        ? err.message.split("\n")[0]
        : "Faucet transfer failed";
    return res.status(500).json({ success: false, error: message });
  }
}
