import { PublicKey } from "@solana/web3.js";
import shadowperpIdl from "../idl/shadowperp.json";
import {
  getClusterAccAddress,
  getFeePoolAccAddress,
  getExecutingPoolAccAddress,
  getMempoolAccAddress,
} from "@arcium-hq/client";
import { ShadowPerpConfig } from "../types";

const DEFAULT_CLUSTER_OFFSET = 456;

function readRequired(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function parsePublicKey(name: string, fallback?: string): PublicKey {
  const envValue = process.env[name]?.trim();
  const raw = envValue && envValue.length > 0 ? envValue : fallback;
  if (!raw) {
    throw new Error(`Missing required env var: ${name}`);
  }
  try {
    return new PublicKey(raw);
  } catch (error: any) {
    throw new Error(`Invalid public key in env var: ${name}. Set a valid base58 address in app/.env.local`);
  }
}

export function getRuntimeConfig(): ShadowPerpConfig {
  const programId = parsePublicKey("NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID");

  // Parse Arcium program ID first so it can be used as the MXE fallback.
  // NEXT_PUBLIC_ARCIUM_MXE_PROGRAM_ID is the Arcium program (not ShadowPerp's).
  // getMXEAccAddress / getArciumMXEPublicKey both derive the MXE PDA from it.
  const arciumProgramId = parsePublicKey("NEXT_PUBLIC_ARCIUM_PROGRAM_ID");

  const clusterOffsetRaw = process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET?.trim();
  const clusterOffset = clusterOffsetRaw
    ? Number.parseInt(clusterOffsetRaw, 10)
    : DEFAULT_CLUSTER_OFFSET;
  if (!Number.isFinite(clusterOffset) || clusterOffset < 0) {
    throw new Error(
      "Invalid NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET. Set a non-negative integer (e.g. 456)."
    );
  }

  // MXE program ID defaults to the Arcium program ID when not explicitly set.
  const mxeProgramId = parsePublicKey(
    "NEXT_PUBLIC_ARCIUM_MXE_PROGRAM_ID",
    arciumProgramId.toBase58()
  );
  const signPdaAccount = PublicKey.findProgramAddressSync(
    [Buffer.from("ArciumSignerAccount")],
    programId
  )[0];

  return {
    programId,
    arciumProgramId,
    mxeProgramId,
    clusterOffset,
    clusterAddress: parsePublicKey(
      "NEXT_PUBLIC_ARCIUM_CLUSTER_ACCOUNT",
      getClusterAccAddress(clusterOffset).toBase58()
    ),
    marketAddress: parsePublicKey("NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT"),
    mempoolAccount: getMempoolAccAddress(clusterOffset),
    executingPool: getExecutingPoolAccAddress(clusterOffset),
    poolAccount: getFeePoolAccAddress(),
    signPdaAccount,
    idl: shadowperpIdl,
  };
}

export function getRpcEndpoint(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
}
