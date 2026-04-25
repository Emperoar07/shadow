/**
 * POST /api/faucet-sol
 *
 * One-time SOL drip (0.2 SOL) to fund tx fees and rent for new account creation.
 * Eligibility:
 *   - Privy auth required, wallet must be linked to authenticated user
 *   - Wallet's current SOL balance must be < 0.05 SOL
 *   - Wallet must have no prior SOL transfer from the sponsor (one-time, ever)
 *
 * Body:   { wallet: string }
 * Response:
 *   { success: true; signature: string; amount: number }
 *   { success: false; error: string }
 */
import type { NextApiRequest, NextApiResponse } from "next";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import { checkRateLimit } from "../../lib/server/rate-limit";
import { getRequestIp, requirePrivySolanaWallet } from "../../lib/server/privy-auth";

const DRIP_LAMPORTS = Math.floor(0.2 * LAMPORTS_PER_SOL);
const ELIGIBILITY_LAMPORTS = Math.floor(0.05 * LAMPORTS_PER_SOL);
const SPONSOR_RESERVE_LAMPORTS = Math.floor(0.25 * LAMPORTS_PER_SOL);
const HISTORY_LOOKUP_LIMIT = 1000;
const DEFAULT_RPC = "https://api.devnet.solana.com";
const USER_RATE_LIMIT = 3;
const IP_RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function normalizeRpcUrl(raw?: string): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  return value || null;
}

function parseRpcList(raw?: string): string[] {
  const normalized = normalizeRpcUrl(raw);
  if (!normalized) return [];
  return normalized.split(/[\n,]+/).map((s) => normalizeRpcUrl(s)).filter((s): s is string => Boolean(s));
}

function getRpcCandidates(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (v: string | null) => {
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  for (const url of parseRpcList(process.env.SOLANA_RPC_URLS)) push(url);
  for (const url of parseRpcList(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS)) push(url);
  push(normalizeRpcUrl(process.env.SOLANA_RPC_URL));
  push(normalizeRpcUrl(process.env.NEXT_PUBLIC_SOLANA_RPC_URL));
  push(DEFAULT_RPC);
  return out;
}

async function getHealthyConnection(): Promise<Connection> {
  for (const url of getRpcCandidates()) {
    const connection = new Connection(url, "confirmed");
    try {
      await Promise.race([
        connection.getLatestBlockhash("processed"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("rpc probe timeout")), 4_500)),
      ]);
      return connection;
    } catch {
      // try next
    }
  }
  throw new Error("No healthy RPC endpoint found.");
}

function getSponsorKeypair(): Keypair {
  const secret = process.env.SOLANA_GAS_SPONSOR_SECRET_KEY ?? process.env.FAUCET_WALLET_SECRET_KEY;
  if (!secret) throw new Error("Sponsor wallet not configured.");
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(secret) as number[]));
}

/**
 * One-time eligibility: returns true if the recipient has never received a SOL
 * transfer from the sponsor wallet. Uses sponsor's outgoing tx history.
 */
async function hasReceivedSolFromSponsor(
  connection: Connection,
  sponsor: PublicKey,
  recipient: PublicKey
): Promise<boolean> {
  const sigs = await connection.getSignaturesForAddress(sponsor, { limit: HISTORY_LOOKUP_LIMIT });
  if (sigs.length === 0) return false;

  const recipientStr = recipient.toBase58();
  const sponsorStr = sponsor.toBase58();

  for (const sigInfo of sigs) {
    if (sigInfo.err) continue;
    const tx = await connection.getParsedTransaction(sigInfo.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx) continue;
    for (const ix of tx.transaction.message.instructions) {
      const parsed = (ix as { parsed?: { type?: string; info?: { source?: string; destination?: string } } }).parsed;
      if (!parsed) continue;
      if (parsed.type !== "transfer") continue;
      if (parsed.info?.source === sponsorStr && parsed.info?.destination === recipientStr) {
        return true;
      }
    }
  }
  return false;
}

type FaucetResponse =
  | { success: true; signature: string; amount: number }
  | { success: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<FaucetResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { wallet } = ((req.body as { wallet?: string } | undefined) ?? {}) as { wallet?: string };
  if (!wallet || typeof wallet !== "string") {
    return res.status(400).json({ success: false, error: "wallet address required" });
  }

  let recipient: PublicKey;
  try {
    recipient = new PublicKey(wallet);
  } catch {
    return res.status(400).json({ success: false, error: "Invalid wallet address" });
  }

  let userId: string;
  try {
    ({ userId } = await requirePrivySolanaWallet(req, recipient.toBase58()));
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: error instanceof Error ? error.message : "Authentication required.",
    });
  }

  if (
    !checkRateLimit(`faucet-sol:user:${userId}`, USER_RATE_LIMIT, RATE_WINDOW_MS) ||
    !checkRateLimit(`faucet-sol:ip:${getRequestIp(req)}`, IP_RATE_LIMIT, RATE_WINDOW_MS)
  ) {
    return res.status(429).json({ success: false, error: "Too many faucet attempts. Try again later." });
  }

  try {
    const connection = await getHealthyConnection();
    const sponsor = getSponsorKeypair();

    const recipientBalance = await connection.getBalance(recipient);
    if (recipientBalance >= ELIGIBILITY_LAMPORTS) {
      return res.status(400).json({
        success: false,
        error: `Wallet already has ${(recipientBalance / LAMPORTS_PER_SOL).toFixed(3)} SOL. Drip only available for wallets below ${ELIGIBILITY_LAMPORTS / LAMPORTS_PER_SOL} SOL.`,
      });
    }

    const sponsorBalance = await connection.getBalance(sponsor.publicKey);
    if (sponsorBalance < DRIP_LAMPORTS + SPONSOR_RESERVE_LAMPORTS) {
      return res.status(503).json({
        success: false,
        error: "SOL faucet temporarily empty. Please try again later or use https://faucet.solana.com/",
      });
    }

    const alreadyClaimed = await hasReceivedSolFromSponsor(connection, sponsor.publicKey, recipient);
    if (alreadyClaimed) {
      return res.status(400).json({
        success: false,
        error: "This wallet has already claimed its one-time SOL drip. Use https://faucet.solana.com/ for more.",
      });
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sponsor.publicKey,
        toPubkey: recipient,
        lamports: DRIP_LAMPORTS,
      })
    );
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = sponsor.publicKey;
    tx.sign(sponsor);

    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(signature, "confirmed");

    return res.status(200).json({
      success: true,
      signature,
      amount: DRIP_LAMPORTS / LAMPORTS_PER_SOL,
    });
  } catch (err: any) {
    console.error("[faucet-sol]", err);
    const message =
      typeof err?.message === "string" && err.message.trim()
        ? err.message.split("\n")[0]
        : "SOL drip failed";
    return res.status(500).json({ success: false, error: message });
  }
}
