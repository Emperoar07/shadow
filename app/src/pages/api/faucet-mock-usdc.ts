/**
 * POST /api/faucet-mock-usdc
 *
 * Top-up logic:
 *   - Cap balance: 20,000 mUSDC in Shadow margin account
 *   - Trigger threshold: below 10,000 mUSDC
 *   - Sends exactly the amount needed to bring the margin back to 20,000
 *   - Cooldown: 7 days per wallet, enforced server-side via signed JWT cookie
 *   - First-time wallets (no margin account) get the full 20,000
 *
 * Body:   { wallet: string }
 *
 * Response:
 *   { success: true; signature: string; amount: number }
 *   { success: false; error: string; nextClaimAt?: number }
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as crypto from "crypto";

import { FAUCET_CAP_USDC, FAUCET_TRIGGER_USDC, MUSDC_DECIMALS } from "../../lib/faucet-constants";

const CAP_USDC     = FAUCET_CAP_USDC;
const TRIGGER_USDC = FAUCET_TRIGGER_USDC;
const DECIMALS     = MUSDC_DECIMALS;
const COOLDOWN_MS  = 7 * 24 * 60 * 60 * 1000;

// Server-side rate limit: wallet → last claim timestamp (survives cookie clearing)
const serverSideClaims = new Map<string, number>();
function checkServerSideRateLimit(wallet: string, now: number): { blocked: true; nextClaimAt: number } | { blocked: false } {
  const lastClaim = serverSideClaims.get(wallet.toLowerCase());
  if (!lastClaim) return { blocked: false };
  const elapsed = now - lastClaim;
  if (elapsed >= COOLDOWN_MS) return { blocked: false };
  return { blocked: true, nextClaimAt: lastClaim + COOLDOWN_MS };
}

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ??
  "ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4"
);

// ── Cooldown via signed HMAC token stored in an HttpOnly cookie ───────────────

function getCooldownSecret(): string {
  const s = process.env.FAUCET_COOLDOWN_SECRET?.trim();
  if (!s) throw new Error("FAUCET_COOLDOWN_SECRET env var not set");
  return s;
}

function makeCooldownToken(wallet: string, claimedAt: number): string {
  const payload = `${wallet}:${claimedAt}`;
  const sig = crypto
    .createHmac("sha256", getCooldownSecret())
    .update(payload)
    .digest("hex");
  return Buffer.from(JSON.stringify({ wallet, claimedAt, sig })).toString("base64url");
}

function parseCooldownToken(token: string): { wallet: string; claimedAt: number } | null {
  try {
    const { wallet, claimedAt, sig } = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8")
    ) as { wallet: string; claimedAt: number; sig: string };
    const expected = crypto
      .createHmac("sha256", getCooldownSecret())
      .update(`${wallet}:${claimedAt}`)
      .digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
      return null;
    }
    return { wallet, claimedAt };
  } catch {
    return null;
  }
}

function checkCooldown(
  req: NextApiRequest,
  wallet: string,
  now: number
): { blocked: true; nextClaimAt: number; daysLeft: number } | { blocked: false } {
  const raw = req.cookies["faucet_cd"];
  if (!raw) return { blocked: false };
  const parsed = parseCooldownToken(raw);
  if (!parsed || parsed.wallet.toLowerCase() !== wallet.toLowerCase()) return { blocked: false };
  const elapsed = now - parsed.claimedAt;
  if (elapsed >= COOLDOWN_MS) return { blocked: false };
  return {
    blocked: true,
    nextClaimAt: parsed.claimedAt + COOLDOWN_MS,
    daysLeft: Math.ceil((COOLDOWN_MS - elapsed) / (1000 * 60 * 60 * 24)),
  };
}

function setCooldownCookie(
  res: NextApiResponse,
  wallet: string,
  now: number
): void {
  const token = makeCooldownToken(wallet, now);
  const maxAge = Math.ceil(COOLDOWN_MS / 1000);
  res.setHeader(
    "Set-Cookie",
    `faucet_cd=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/faucet-mock-usdc; Max-Age=${maxAge}`
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    "https://api.devnet.solana.com"
  );
}

function getMockUsdcMint(): PublicKey {
  const mint = process.env.NEXT_PUBLIC_MOCKUSDC_MINT;
  if (!mint) throw new Error("NEXT_PUBLIC_MOCKUSDC_MINT env var not set");
  return new PublicKey(mint);
}

function getFaucetKeypair(): Keypair {
  const secret = process.env.FAUCET_WALLET_SECRET_KEY?.trim();
  if (!secret) throw new Error("FAUCET_WALLET_SECRET_KEY env var not set");
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(secret) as number[]));
}

/**
 * Fetch the Shadow margin balance (raw u64, scaled by 1e6) for a wallet.
 * Throws if the RPC call fails — never silently returns 0 for an existing account.
 */
async function fetchMarginBalanceRaw(
  connection: Connection,
  owner: PublicKey
): Promise<bigint> {
  const [marginPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("margin"), owner.toBuffer()],
    PROGRAM_ID
  );
  const info = await connection.getAccountInfo(marginPda);
  // Account doesn't exist yet (first-time user) → 0 is correct
  if (!info) return BigInt(0);
  if (info.data.length < 80) return BigInt(0);
  return info.data.readBigUInt64LE(72);
}

// ── Handler ───────────────────────────────────────────────────────────────────

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

  const { wallet } = req.body as { wallet?: string };

  if (!wallet || typeof wallet !== "string") {
    return res.status(400).json({ success: false, error: "wallet address required" });
  }

  let recipientPubkey: PublicKey;
  try {
    recipientPubkey = new PublicKey(wallet);
  } catch {
    return res.status(400).json({ success: false, error: "Invalid wallet address" });
  }

  const now = Date.now();

  // Server-side check first — cannot be bypassed by clearing cookies
  const serverLimit = checkServerSideRateLimit(wallet, now);
  if (serverLimit.blocked) {
    const daysLeft = Math.ceil((serverLimit.nextClaimAt - now) / (1000 * 60 * 60 * 24));
    return res.status(429).json({
      success: false,
      error: `You can top up again in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
      nextClaimAt: serverLimit.nextClaimAt,
    });
  }

  const cooldown = checkCooldown(req, wallet, now);
  if (cooldown.blocked) {
    return res.status(429).json({
      success: false,
      error: `You can top up again in ${cooldown.daysLeft} day${cooldown.daysLeft === 1 ? "" : "s"}.`,
      nextClaimAt: cooldown.nextClaimAt,
    });
  }

  try {
    const connection = new Connection(getRpcUrl(), "confirmed");

    // Always fetch from chain — never trust client-supplied balance
    const balanceRaw = await fetchMarginBalanceRaw(connection, recipientPubkey);
    const balanceUsdc = Number(balanceRaw) / 10 ** DECIMALS;

    if (balanceUsdc >= TRIGGER_USDC) {
      return res.status(400).json({
        success: false,
        error: `Balance is ${Math.floor(balanceUsdc).toLocaleString()} mUSDC — no top-up needed until it falls below ${TRIGGER_USDC.toLocaleString()}.`,
      });
    }

    const topUpUsdc = CAP_USDC - Math.floor(balanceUsdc);
    const topUpRaw  = BigInt(topUpUsdc) * BigInt(10 ** DECIMALS);

    const mintAddress = getMockUsdcMint();
    const faucet = getFaucetKeypair();

    const faucetAta    = await getAssociatedTokenAddress(mintAddress, faucet.publicKey);
    const recipientAta = await getAssociatedTokenAddress(mintAddress, recipientPubkey);

    const tx = new Transaction();

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
        topUpRaw,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer        = faucet.publicKey;
    tx.sign(faucet);

    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(signature, "confirmed");

    serverSideClaims.set(wallet.toLowerCase(), now);
    setCooldownCookie(res, wallet, now);

    return res.status(200).json({ success: true, signature, amount: topUpUsdc });
  } catch (err: unknown) {
    console.error("[faucet-mock-usdc]", err);
    const message =
      err instanceof Error && err.message.trim()
        ? err.message.split("\n")[0]
        : "Faucet transfer failed";
    return res.status(500).json({ success: false, error: message });
  }
}
