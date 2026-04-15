/**
 * POST /api/faucet-mock-usdc
 *
 * Sends 20,000 mUSDC directly to the requesting wallet (server-side transfer).
 * Creates the user's ATA if needed. Faucet pays all fees.
 * Rate-limited to once every 7 days per wallet.
 *
 * Body:   { wallet: string }
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
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CLAIM_AMOUNT = 20_000;
const CLAIM_DECIMALS = 6;
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const cooldowns = new Map<string, number>();

function getRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    "https://api.devnet.solana.com"
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
    const parsed = JSON.parse(secret) as number[];
    return Keypair.fromSecretKey(new Uint8Array(parsed));
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

  // Cooldown check
  const now = Date.now();
  const lastClaim = cooldowns.get(wallet);
  if (lastClaim !== undefined) {
    const elapsed = now - lastClaim;
    if (elapsed < COOLDOWN_MS) {
      const nextClaimAt = lastClaim + COOLDOWN_MS;
      return res.status(429).json({
        success: false,
        error: `You can claim again in ${Math.ceil((COOLDOWN_MS - elapsed) / (1000 * 60 * 60 * 24))} day(s).`,
        nextClaimAt,
      });
    }
  }

  try {
    const connection = new Connection(getRpcUrl(), "confirmed");
    const mintAddress = getMockUsdcMint();
    const faucet = getFaucetKeypair();

    const faucetAta = await getAssociatedTokenAddress(mintAddress, faucet.publicKey);
    const recipientAta = await getAssociatedTokenAddress(mintAddress, recipientPubkey);

    const tx = new Transaction();

    // Create recipient ATA if it doesn't exist (faucet pays rent)
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

    // Transfer mUSDC
    const transferAmount = BigInt(CLAIM_AMOUNT) * BigInt(10 ** CLAIM_DECIMALS);
    tx.add(
      createTransferInstruction(
        faucetAta,
        recipientAta,
        faucet.publicKey,
        transferAmount,
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

    return res.status(200).json({ success: true, signature, amount: CLAIM_AMOUNT });
  } catch (err: any) {
    console.error("[faucet-mock-usdc]", err);
    const message =
      typeof err?.message === "string" && err.message.trim()
        ? err.message.split("\n")[0]
        : "Faucet transfer failed";
    return res.status(500).json({ success: false, error: message });
  }
}
