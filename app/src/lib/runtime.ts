import { PublicKey } from "@solana/web3.js";
import shadowperpIdl from "../idl/shadowperp.json";
import { ShadowPerpConfig } from "../types";

function readRequired(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function parsePublicKey(name: string): PublicKey {
  const raw = readRequired(name);
  try {
    return new PublicKey(raw);
  } catch (error: any) {
    throw new Error(`Invalid public key in env var: ${name}. Set a valid base58 address in app/.env.local`);
  }
}

export function getRuntimeConfig(): ShadowPerpConfig {
  return {
    programId: parsePublicKey("NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID"),
    mxeProgramId: parsePublicKey("NEXT_PUBLIC_ARCIUM_PROGRAM_ID"),
    clusterAddress: parsePublicKey("NEXT_PUBLIC_ARCIUM_CLUSTER_ACCOUNT"),
    marketAddress: parsePublicKey("NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT"),
    mempoolAccount: parsePublicKey("NEXT_PUBLIC_ARCIUM_MEMPOOL_ACCOUNT"),
    executingPool: parsePublicKey("NEXT_PUBLIC_ARCIUM_EXECUTING_POOL"),
    computationAccount: parsePublicKey("NEXT_PUBLIC_ARCIUM_COMPUTATION_ACCOUNT"),
    poolAccount: parsePublicKey("NEXT_PUBLIC_ARCIUM_POOL_ACCOUNT"),
    signPdaAccount: parsePublicKey("NEXT_PUBLIC_ARCIUM_SIGN_PDA_ACCOUNT"),
    idl: shadowperpIdl,
  };
}

export function getRpcEndpoint(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
}
