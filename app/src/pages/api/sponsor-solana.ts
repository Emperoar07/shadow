import type { NextApiRequest, NextApiResponse } from "next";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { ComputeBudgetProgram, SystemProgram } from "@solana/web3.js";
import { checkRateLimit } from "../../lib/server/rate-limit";
import { extractBearerToken, getPrivyServerClient } from "../../lib/server/privy-auth";

type SponsorResponse =
  | { ok: true; signature: string }
  | { ok: false; error: string };

const MAX_BODY_BYTES = 64_000;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function normalizeFlag(raw?: string): boolean {
  if (!raw) return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function normalizeCluster(raw?: string): "devnet" | "mainnet-beta" | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (value === "devnet") return "devnet";
  if (value === "mainnet" || value === "mainnet-beta") return "mainnet-beta";
  return null;
}

function resolveCluster(): "devnet" | "mainnet-beta" | null {
  const explicit = normalizeCluster(process.env.NEXT_PUBLIC_SOLANA_CLUSTER);
  if (explicit) return explicit;
  const rpc = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "";
  const normalizedRpc = rpc.toLowerCase();
  if (normalizedRpc.includes("devnet")) return "devnet";
  if (normalizedRpc.includes("mainnet")) return "mainnet-beta";
  return null;
}

function resolveConnection(): Connection {
  const rpcUrl =
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    "https://api.devnet.solana.com";
  return new Connection(rpcUrl, "confirmed");
}

function resolveSponsorKeypair(): Keypair {
  const rawJson = process.env.SOLANA_GAS_SPONSOR_SECRET_KEY?.trim();
  if (rawJson) {
    const parsed = JSON.parse(rawJson) as number[];
    return Keypair.fromSecretKey(new Uint8Array(parsed));
  }

  throw new Error("Missing SOLANA_GAS_SPONSOR_SECRET_KEY");
}

function hasAllowedTopLevelInstructions(tx: Transaction, shadowProgramId: PublicKey): boolean {
  const allowed = new Set([
    shadowProgramId.toBase58(),
    TOKEN_PROGRAM_ID.toBase58(),
    ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    SystemProgram.programId.toBase58(),
    ComputeBudgetProgram.programId.toBase58(),
  ]);
  return tx.instructions.every((ix) => allowed.has(ix.programId.toBase58()));
}

async function authenticateSponsoredTransaction(
  req: NextApiRequest,
  tx: Transaction,
  sponsor: Keypair
): Promise<void> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    throw new Error("Missing Privy bearer token.");
  }

  const privy = getPrivyServerClient();
  const claims = await privy.verifyAuthToken(token);

  if (!checkRateLimit(`sponsor:${claims.userId}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    throw new Error("Rate limit exceeded. Try again later.");
  }

  const user = await privy.getUser(claims.userId);
  const linkedSolanaWallets = new Set<string>();
  for (const account of user.linkedAccounts) {
    if (account.type !== "wallet" || account.chainType !== "solana") continue;
    const address =
      "address" in account && typeof account.address === "string"
        ? account.address.toLowerCase()
        : null;
    if (address) linkedSolanaWallets.add(address);
  }

  if (linkedSolanaWallets.size === 0) {
    throw new Error("Authenticated user has no linked Solana wallet.");
  }

  const nonSponsorSigners = tx.signatures
    .filter((signature) => signature.signature !== null)
    .map((signature) => signature.publicKey)
    .filter((publicKey) => !publicKey.equals(sponsor.publicKey));

  if (nonSponsorSigners.length === 0) {
    throw new Error("Sponsored transaction is missing an authenticated wallet signature.");
  }

  const signerMismatch = nonSponsorSigners.some(
    (publicKey) => !linkedSolanaWallets.has(publicKey.toBase58().toLowerCase())
  );
  if (signerMismatch) {
    throw new Error("Sponsored transaction signer does not match the authenticated Privy user.");
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SponsorResponse>
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!normalizeFlag(process.env.SOLANA_GAS_SPONSOR_ENABLED)) {
    res.status(503).json({ ok: false, error: "Gas sponsorship is disabled." });
    return;
  }

  try {
    const cluster = resolveCluster();
    if (cluster !== "devnet" && cluster !== "mainnet-beta") {
      throw new Error("Gas sponsorship only supports Solana devnet and mainnet-beta.");
    }

    const body = req.body as { cluster?: string; transactionBase64?: string } | undefined;
    const requestedCluster = normalizeCluster(body?.cluster);
    if (requestedCluster && requestedCluster !== cluster) {
      throw new Error(`Cluster mismatch. Server is configured for ${cluster}.`);
    }

    const transactionBase64 = body?.transactionBase64?.trim();
    if (!transactionBase64 || transactionBase64.length > MAX_BODY_BYTES) {
      throw new Error("Missing or invalid sponsored transaction payload.");
    }

    const sponsor = resolveSponsorKeypair();
    const shadowProgramIdRaw = process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID?.trim();
    if (!shadowProgramIdRaw) {
      throw new Error("Missing NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID");
    }
    const shadowProgramId = new PublicKey(shadowProgramIdRaw);

    const tx = Transaction.from(Buffer.from(transactionBase64, "base64"));
    if (!tx.feePayer?.equals(sponsor.publicKey)) {
      throw new Error("Sponsored transaction fee payer does not match configured sponsor.");
    }
    if (!hasAllowedTopLevelInstructions(tx, shadowProgramId)) {
      throw new Error("Sponsored transaction contains unsupported top-level instructions.");
    }
    if (!tx.verifySignatures(false)) {
      throw new Error("Sponsored transaction is missing a valid user signature.");
    }
    await authenticateSponsoredTransaction(req, tx, sponsor);

    tx.partialSign(sponsor);

    const connection = resolveConnection();
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      preflightCommitment: "confirmed",
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction(signature, "confirmed");

    res.status(200).json({ ok: true, signature });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gas sponsorship failed.";
    res.status(400).json({ ok: false, error: message });
  }
}
