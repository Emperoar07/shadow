import { PublicKey } from "@solana/web3.js";
import shadowperpIdl from "../idl/shadowperp.json";
import {
  getExecutingPoolAccAddress,
  getMempoolAccAddress,
  getStakingPoolAccAddress,
} from "@arcium-hq/client";
import { ShadowPerpConfig } from "../types";

const DEFAULT_SHADOWPERP_PROGRAM_ID = "11111111111111111111111111111111";

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
  const mxeProgramId = parsePublicKey("NEXT_PUBLIC_ARCIUM_MXE_PROGRAM_ID");
  const signPdaAccount = PublicKey.findProgramAddressSync(
    [Buffer.from("SignerAccount")],
    mxeProgramId
  )[0];

  return {
    programId: parsePublicKey("NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID", DEFAULT_SHADOWPERP_PROGRAM_ID),
    arciumProgramId: parsePublicKey("NEXT_PUBLIC_ARCIUM_PROGRAM_ID"),
    mxeProgramId,
    clusterAddress: parsePublicKey("NEXT_PUBLIC_ARCIUM_CLUSTER_ACCOUNT"),
    marketAddress: parsePublicKey("NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT"),
    mempoolAccount: getMempoolAccAddress(mxeProgramId),
    executingPool: getExecutingPoolAccAddress(mxeProgramId),
    poolAccount: getStakingPoolAccAddress(),
    signPdaAccount,
    idl: shadowperpIdl,
  };
}

export function getRpcEndpoint(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
}
