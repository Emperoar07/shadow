/**
 * POST /api/faucet-mock-usdc
 *
 * Returns a partially signed transaction that:
 *   1. Creates the user's mUSDC ATA if needed (faucet pays rent)
 *   2. Transfers the required top-up from faucet -> user ATA
 *   3. Calls depositCollateral to move mUSDC from user ATA -> Shadow vault
 *
 * Top-up logic:
 *   - Cap balance: 20,000 mUSDC in Shadow margin account
 *   - Trigger threshold: below 10,000 mUSDC
 *   - Sends exactly the amount needed to bring the margin back to 20,000
 *   - Cooldown: 7 days per wallet, enforced server-side on transaction issue
 *
 * Body:   { wallet: string; currentBalanceRaw?: string; marketAddress?: string }
 *   currentBalanceRaw — raw u64 margin balance (scaled by 1e6). If omitted the
 *   server fetches it directly.
 *
 * Response:
 *   { success: true; transaction: string; amount: number }
 *   { success: false; error: string; nextClaimAt?: number }
 */
import type { NextApiRequest, NextApiResponse } from "next";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { FAUCET_CAP_USDC, FAUCET_TRIGGER_USDC, MUSDC_DECIMALS } from "../../lib/faucet-constants";

const CAP_USDC      = FAUCET_CAP_USDC;
const TRIGGER_USDC  = FAUCET_TRIGGER_USDC;
const DECIMALS      = MUSDC_DECIMALS;
const COOLDOWN_MS   = 7 * 24 * 60 * 60 * 1000;

// In-memory cooldown — resets on cold start (Vercel serverless); client-side
// localStorage is the durable gate after confirmTransaction.
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

function getProgramId(): PublicKey {
  const id =
    process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ??
    "ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4";
  return new PublicKey(id);
}

function getDefaultMarketAddress(): PublicKey {
  const addr = process.env.NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT;
  if (!addr) {
    throw new Error("market address required");
  }
  return new PublicKey(addr);
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

/** Fetch the Shadow margin balance (in raw u64, scaled by 1e6) for a wallet. */
async function fetchMarginBalanceRaw(
  connection: Connection,
  owner: PublicKey
): Promise<bigint> {
  try {
    const [marginPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("margin"), owner.toBuffer()],
      getProgramId()
    );
    const info = await connection.getAccountInfo(marginPda);
    if (!info || info.data.length < 80) return BigInt(0);
    // u64 at byte offset 72 (8 discriminator + 32 owner + 32 market)
    return info.data.readBigUInt64LE(72);
  } catch {
    return BigInt(0);
  }
}

function getMarginAccountAddress(owner: PublicKey, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("margin"), owner.toBuffer()],
    programId
  );
  return pda;
}

async function buildDepositInstruction(
  connection: Connection,
  programId: PublicKey,
  marketAddress: PublicKey,
  owner: PublicKey,
  userTokenAccount: PublicKey,
  amount: BN
) {
  const idl = (await import("../../idl/shadowperp.json")).default;
  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey: owner,
      signTransaction: async (tx: Transaction) => tx,
      signAllTransactions: async (txs: Transaction[]) => txs,
    } as any,
    { commitment: "confirmed" }
  );
  const program = new anchor.Program(idl as anchor.Idl, provider);
  const marginAccount = getMarginAccountAddress(owner, programId);
  const marketAccount = await (program.account as any).market.fetch(marketAddress) as {
    vault: PublicKey;
  };

  return program.methods
    .depositCollateral(amount)
    .accounts({
      owner,
      market: marketAddress,
      marginAccount,
      userTokenAccount,
      vault: marketAccount.vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

type FaucetResponse =
  | { success: true; transaction: string; amount: number }
  | { success: false; error: string; nextClaimAt?: number };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<FaucetResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { wallet, marketAddress } = ((req.body as
    | { wallet?: string; marketAddress?: string }
    | undefined) ?? {}) as {
    wallet?: string;
    marketAddress?: string;
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

  // Cooldown check
  const now = Date.now();
  const lastClaim = cooldowns.get(wallet);
  if (lastClaim !== undefined) {
    const elapsed = now - lastClaim;
    if (elapsed < COOLDOWN_MS) {
      const nextClaimAt = lastClaim + COOLDOWN_MS;
      const daysLeft = Math.ceil((COOLDOWN_MS - elapsed) / (1000 * 60 * 60 * 24));
      return res.status(429).json({
        success: false,
        error: `You can top up again in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
        nextClaimAt,
      });
    }
  }

  try {
    const connection = new Connection(getRpcUrl(), "confirmed");
    const programId = getProgramId();
    const targetMarketAddress = marketAddress
      ? new PublicKey(marketAddress)
      : getDefaultMarketAddress();

    const balanceRaw = await fetchMarginBalanceRaw(connection, recipientPubkey);

    const balanceUsdc = Number(balanceRaw) / 10 ** DECIMALS;

    // Only top up if below the trigger threshold
    if (balanceUsdc >= TRIGGER_USDC) {
      return res.status(400).json({
        success: false,
        error: `Balance is ${Math.floor(balanceUsdc).toLocaleString()} mUSDC — no top-up needed until it falls below ${TRIGGER_USDC.toLocaleString()}.`,
      });
    }

    // Send exactly enough to reach the cap
    const topUpUsdc = CAP_USDC - Math.floor(balanceUsdc);
    const topUpRaw  = BigInt(topUpUsdc) * BigInt(10 ** DECIMALS);
    const amountBN = new BN(topUpRaw.toString());

    const mintAddress = getMockUsdcMint();
    const faucet = getFaucetKeypair();

    const faucetAta    = await getAssociatedTokenAddress(mintAddress, faucet.publicKey);
    const recipientAta = await getAssociatedTokenAddress(mintAddress, recipientPubkey);

    const tx = new Transaction();

    // Create recipient ATA if it does not exist (faucet pays rent)
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

    tx.add(
      await buildDepositInstruction(
        connection,
        programId,
        targetMarketAddress,
        recipientPubkey,
        recipientAta,
        amountBN
      )
    );

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = faucet.publicKey;
    tx.partialSign(faucet);

    const transaction = Buffer.from(
      tx.serialize({ requireAllSignatures: false, verifySignatures: false })
    ).toString("base64");

    return res.status(200).json({
      success: true,
      transaction,
      amount: topUpUsdc,
    });
  } catch (err: any) {
    console.error("[faucet-mock-usdc]", err);
    const message =
      typeof err?.message === "string" && err.message.trim()
        ? err.message.split("\n")[0]
        : "Faucet transfer failed";
    return res.status(500).json({ success: false, error: message });
  }
}
