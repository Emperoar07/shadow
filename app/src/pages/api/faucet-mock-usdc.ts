/**
 * POST /api/faucet-mock-usdc
 *
 * Returns a partially-signed transaction that:
 *   1. Creates the user's mUSDC ATA if needed (faucet pays rent)
 *   2. Transfers 20,000 mUSDC from faucet → user ATA
 *   3. Calls depositCollateral to move mUSDC from user ATA → Shadow vault
 *
 * The faucet pre-signs with its keypair. The frontend submits it after the
 * user co-signs with their wallet. One transaction, one confirmation.
 *
 * Rate-limited to once every 7 days per wallet.
 *
 * Body:   { wallet: string }
 * Response:
 *   { success: true; transaction: string; amount: number }   (base64 tx)
 *   { success: false; error: string; nextClaimAt?: number }
 */
import type { NextApiRequest, NextApiResponse } from "next";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";

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

function getProgramId(): PublicKey {
  const id = process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID;
  if (!id) throw new Error("NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID env var not set");
  return new PublicKey(id);
}

function getMarketAddress(): PublicKey {
  const addr = process.env.NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT;
  if (!addr) throw new Error("NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT env var not set");
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

function getMarginAccountAddress(owner: PublicKey, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("margin"), owner.toBuffer()],
    programId
  );
  return pda;
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
    const programId = getProgramId();
    const marketAddress = getMarketAddress();
    const faucet = getFaucetKeypair();

    const faucetAta = await getAssociatedTokenAddress(mintAddress, faucet.publicKey);
    const recipientAta = await getAssociatedTokenAddress(mintAddress, recipientPubkey);
    const marginAccount = getMarginAccountAddress(recipientPubkey, programId);

    const transferAmount = BigInt(CLAIM_AMOUNT) * BigInt(10 ** CLAIM_DECIMALS);
    const amountBN = new BN(CLAIM_AMOUNT * 10 ** CLAIM_DECIMALS);

    const tx = new Transaction();

    // 1. Create recipient ATA if it doesn't exist
    const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
    if (!recipientAtaInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          faucet.publicKey, // payer (faucet pays rent)
          recipientAta,
          recipientPubkey,
          mintAddress
        )
      );
    }

    // 2. Transfer mUSDC: faucet → user ATA (faucet signs this)
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

    // 3. depositCollateral: user ATA → Shadow vault (user signs this)
    // Fetch vault address from market account
    const idl = (await import("../../idl/shadowperp.json")).default;
    const provider = new anchor.AnchorProvider(
      connection,
      // Dummy wallet — we're only building the instruction, not submitting
      { publicKey: recipientPubkey, signTransaction: async (t) => t, signAllTransactions: async (ts) => ts },
      { commitment: "confirmed" }
    );
    const program = new anchor.Program(idl as anchor.Idl, provider);

    const marketAccount = await (program.account as any)["market"].fetch(marketAddress) as { vault: PublicKey; collateralMint: PublicKey };

    const depositIx = await program.methods
      .depositCollateral(amountBN)
      .accounts({
        owner: recipientPubkey,
        market: marketAddress,
        marginAccount,
        userTokenAccount: recipientAta,
        vault: marketAccount.vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    tx.add(depositIx);

    // Faucet pre-signs (covers the transfer instruction)
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = recipientPubkey; // user pays tx fee (they sign last)

    // Partial sign with faucet keypair
    tx.partialSign(faucet);

    // Serialize without requiring all signatures
    const serialized = tx.serialize({ requireAllSignatures: false }).toString("base64");

    // Record cooldown
    cooldowns.set(wallet, now);

    return res.status(200).json({
      success: true,
      transaction: serialized,
      amount: CLAIM_AMOUNT,
    });
  } catch (err: any) {
    console.error("[faucet-mock-usdc]", err);
    const message =
      typeof err?.message === "string" && err.message.trim()
        ? err.message.split("\n")[0]
        : "Faucet request failed";
    return res.status(500).json({ success: false, error: message });
  }
}
