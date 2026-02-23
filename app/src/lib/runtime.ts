import { PublicKey } from "@solana/web3.js";
import shadowperpIdl from "../idl/shadowperp.json";
import {
  ARCIUM_ADDR,
  getClusterAccAddress,
  getFeePoolAccAddress,
  getExecutingPoolAccAddress,
  getMempoolAccAddress,
} from "@arcium-hq/client";
import { ShadowPerpConfig } from "../types";

const DEFAULT_CLUSTER_OFFSET = 456;
const DEFAULT_RPC_ENDPOINT = "https://api.devnet.solana.com";
const DEFAULT_COLLATERAL_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"; // canonical devnet USDC
const RPC_PREF_STORAGE_KEY = "shadowperp.rpc.index";
export const RPC_CHANGED_EVENT = "shadowperp:rpc-changed";
const DEFAULT_IDL_PROGRAM_ID =
  typeof shadowperpIdl.address === "string" && shadowperpIdl.address.length > 0
    ? shadowperpIdl.address
    : undefined;

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

function parsePublicKey(name: string, fallback?: string): PublicKey {
  const normalize = (value?: string): string | undefined => {
    if (!value) return undefined;
    let out = value.trim();
    if (!out) return undefined;
    if (out.startsWith("<") && out.endsWith(">")) {
      out = out.slice(1, -1).trim();
    }
    if (
      (out.startsWith('"') && out.endsWith('"')) ||
      (out.startsWith("'") && out.endsWith("'"))
    ) {
      out = out.slice(1, -1).trim();
    }
    return out || undefined;
  };

  const envValue = normalize(process.env[name]);
  const raw = envValue && envValue.length > 0 ? envValue : normalize(fallback);
  if (!raw) {
    throw new Error(
      `Missing required env var: ${name}. ` +
        "Set it in app/.env.local and restart the Next.js dev server."
    );
  }
  try {
    return new PublicKey(raw);
  } catch (error: any) {
    throw new Error(`Invalid public key in env var: ${name}. Set a valid base58 address in app/.env.local`);
  }
}

export function getRuntimeConfig(): ShadowPerpConfig {
  const programId = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID",
    DEFAULT_IDL_PROGRAM_ID
  );
  const collateralMint = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_COLLATERAL_MINT",
    DEFAULT_COLLATERAL_MINT
  );
  const [derivedMarketAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), collateralMint.toBuffer()],
    programId
  );

  // Parse Arcium runtime program ID first (queue/execution program).
  const arciumProgramId = parsePublicKey(
    "NEXT_PUBLIC_ARCIUM_PROGRAM_ID",
    ARCIUM_ADDR
  );

  const clusterOffsetRaw = process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET?.trim();
  const clusterOffset = clusterOffsetRaw
    ? Number.parseInt(clusterOffsetRaw, 10)
    : DEFAULT_CLUSTER_OFFSET;
  if (!Number.isFinite(clusterOffset) || clusterOffset < 0) {
    throw new Error(
      "Invalid NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET. Set a non-negative integer (e.g. 456)."
    );
  }

  // MXE PDA namespace defaults to the ShadowPerp program ID.
  // This matches Arcium SDK examples where getMXEAccAddress() is derived from app program id.
  const mxeProgramId = parsePublicKey(
    "NEXT_PUBLIC_ARCIUM_MXE_PROGRAM_ID",
    programId.toBase58()
  );
  const signPdaAccount = PublicKey.findProgramAddressSync(
    [Buffer.from("ArciumSignerAccount")],
    mxeProgramId
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
    marketAddress: parsePublicKey(
      "NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT",
      derivedMarketAddress.toBase58()
    ),
    mempoolAccount: getMempoolAccAddress(clusterOffset),
    executingPool: getExecutingPoolAccAddress(clusterOffset),
    poolAccount: getFeePoolAccAddress(),
    signPdaAccount,
    idl: shadowperpIdl,
  };
}

export function getRpcEndpoints(): string[] {
  const all = [
    ...parseRpcList(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS),
    ...parseRpcList(process.env.NEXT_PUBLIC_SOLANA_RPC_URL),
  ];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const endpoint of all) {
    if (seen.has(endpoint)) continue;
    seen.add(endpoint);
    deduped.push(endpoint);
  }
  if (deduped.length === 0) deduped.push(DEFAULT_RPC_ENDPOINT);
  return deduped;
}

export function getPreferredRpcIndex(): number {
  const browserWindow = typeof globalThis !== "undefined" ? (globalThis as any).window : undefined;
  if (!browserWindow) return 0;
  const raw = browserWindow.localStorage.getItem(RPC_PREF_STORAGE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function setPreferredRpcIndex(index: number): void {
  const browserWindow = typeof globalThis !== "undefined" ? (globalThis as any).window : undefined;
  if (!browserWindow) return;
  const safe = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
  browserWindow.localStorage.setItem(RPC_PREF_STORAGE_KEY, String(safe));
  browserWindow.dispatchEvent(new CustomEvent(RPC_CHANGED_EVENT, { detail: { index: safe } }));
}

export function getRpcEndpoint(): string {
  const endpoints = getRpcEndpoints();
  const index = getPreferredRpcIndex() % endpoints.length;
  return endpoints[index];
}
