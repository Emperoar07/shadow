import fs from "fs";
import os from "os";
import path from "path";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import {
  ARCIUM_ADDR,
  getClusterAccAddress,
  getExecutingPoolAccAddress,
  getFeePoolAccAddress,
  getMempoolAccAddress,
} from "@arcium-hq/client";
import shadowperpIdl from "../../idl/shadowperp.json";
import { ShadowPerpClient } from "../client";
import { ShadowPerpConfig } from "../../types";
import { TRADING_PAIRS } from "../tokens";

const DEFAULT_CLUSTER_OFFSET = 456;
const DEFAULT_RPC_ENDPOINT = "https://api.devnet.solana.com";
const DEFAULT_COLLATERAL_MINT =
  process.env.NEXT_PUBLIC_MOCKUSDC_MINT ??
  "DbF1Z21WCTbcx5feBB9LNkhtqRE99DZt9ENJT79prHc6";
type RpcTransport = { rpcUrl: string; wsUrl: string };
export type RelayRuntimeSummary = {
  programId: string;
  marketAddress: string;
  clusterOffset: number;
  rpcHost: string;
  wsHost: string;
  rpcCandidates: string[];
};

function normalize(value?: string): string | undefined {
  if (!value) return undefined;
  let out = value.trim();
  if (!out) return undefined;
  if (out.startsWith("<") && out.endsWith(">")) out = out.slice(1, -1).trim();
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'"))
  ) {
    out = out.slice(1, -1).trim();
  }
  return out || undefined;
}

function parsePublicKey(name: string, fallback?: string): PublicKey {
  const raw = normalize(process.env[name]) || normalize(fallback);
  if (!raw) {
    throw new Error(`Missing required env var: ${name}`);
  }
  try {
    return new PublicKey(raw);
  } catch {
    throw new Error(`Invalid public key in env var: ${name}`);
  }
}

function parseRpcEndpoints(raw?: string): string[] {
  const normalized = normalize(raw);
  if (!normalized) return [];
  return normalized
    .split(/[\n,]+/)
    .map((entry) => normalize(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function deriveWsEndpoint(rpcEndpoint: string): string {
  try {
    const url = new URL(rpcEndpoint);
    if (url.protocol === "https:") url.protocol = "wss:";
    else if (url.protocol === "http:") url.protocol = "ws:";
    return url.toString();
  } catch {
    return rpcEndpoint.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  }
}

function summarizeEndpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

function collectRpcUrls(): string[] {
  const candidates = [
    ...parseRpcEndpoints(process.env.SOLANA_RPC_URL),
    ...parseRpcEndpoints(process.env.SOLANA_RPC_URLS),
    ...parseRpcEndpoints(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS),
    ...parseRpcEndpoints(process.env.NEXT_PUBLIC_SOLANA_RPC_URL),
  ];
  const deduped = Array.from(new Set(candidates));
  return deduped.length > 0 ? deduped : [DEFAULT_RPC_ENDPOINT];
}

function collectWsUrls(): string[] {
  return [
    ...parseRpcEndpoints(process.env.SOLANA_WSS_URLS),
    ...parseRpcEndpoints(process.env.SOLANA_WSS_URL),
    ...parseRpcEndpoints(process.env.NEXT_PUBLIC_SOLANA_WSS_URLS),
    ...parseRpcEndpoints(process.env.NEXT_PUBLIC_SOLANA_WSS_URL),
  ];
}

function collectRpcTransports(): RpcTransport[] {
  const rpcUrls = collectRpcUrls();
  const wsUrls = collectWsUrls();
  return rpcUrls.map((rpcUrl, index) => ({
    rpcUrl,
    wsUrl: wsUrls[index] ?? deriveWsEndpoint(rpcUrl),
  }));
}

async function probeRpcUrl(url: string): Promise<void> {
  const connection = new Connection(url, "confirmed");
  await Promise.race([
    connection.getLatestBlockhash("processed"),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`RPC probe timed out for ${url}`)), 6_000)
    ),
  ]);
}

async function resolveRpcTransport(): Promise<RpcTransport> {
  const candidates = collectRpcTransports();
  let lastError: string | null = null;

  for (const candidate of candidates) {
    try {
      await probeRpcUrl(candidate.rpcUrl);
      return candidate;
    } catch (error: any) {
      lastError = typeof error?.message === "string" ? error.message : String(error);
    }
  }

  throw new Error(
    `No healthy relay RPC endpoint found${lastError ? ` (${lastError})` : ""}`
  );
}

function parseKeypairFromJson(name: string, value?: string): Keypair | null {
  const normalized = normalize(value);
  if (!normalized) return null;
  try {
    const parsed = JSON.parse(normalized);
    if (!Array.isArray(parsed)) {
      throw new Error("keypair JSON must be an array");
    }
    return Keypair.fromSecretKey(new Uint8Array(parsed));
  } catch (error: any) {
    throw new Error(`Invalid ${name}: ${error?.message || "failed to parse keypair JSON"}`);
  }
}

function parseKeypairFromPath(filePath: string): Keypair | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  return parseKeypairFromJson(filePath, raw);
}

function allowLocalRelayerFallback(): boolean {
  return process.env.NODE_ENV !== "production";
}

function resolveRelayerKeypair(): Keypair {
  const fromEnvJson =
    parseKeypairFromJson(
      "SHADOWPERP_RELAYER_KEYPAIR_JSON",
      process.env.SHADOWPERP_RELAYER_KEYPAIR_JSON
    ) ||
    parseKeypairFromJson(
      "SOLANA_WALLET_KEYPAIR_JSON",
      process.env.SOLANA_WALLET_KEYPAIR_JSON
    );
  if (fromEnvJson) return fromEnvJson;

  const customPath = normalize(process.env.SHADOWPERP_RELAYER_KEYPAIR_PATH);
  if (customPath) {
    const parsed = parseKeypairFromPath(customPath);
    if (!parsed) {
      throw new Error(`Relayer keypair file not found: ${customPath}`);
    }
    return parsed;
  }

  if (!allowLocalRelayerFallback()) {
    throw new Error(
      "Missing relayer keypair. Set SHADOWPERP_RELAYER_KEYPAIR_JSON or SHADOWPERP_RELAYER_KEYPAIR_PATH."
    );
  }

  const defaultPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const parsedDefault = parseKeypairFromPath(defaultPath);
  if (parsedDefault) return parsedDefault;

  throw new Error(
    "Missing relayer keypair. Set SHADOWPERP_RELAYER_KEYPAIR_JSON or SHADOWPERP_RELAYER_KEYPAIR_PATH."
  );
}

function buildRelayConfig(programId: PublicKey): ShadowPerpConfig {
  const collateralMint = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_COLLATERAL_MINT",
    DEFAULT_COLLATERAL_MINT
  );

  // Derive market PDA for each trading pair
  const marketRegistry: Record<string, PublicKey> = {};
  for (const pair of TRADING_PAIRS) {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), collateralMint.toBuffer(), pair.base.mint.toBuffer()],
      programId
    );
    marketRegistry[pair.label] = pda;
  }
  const derivedMarketAddress = marketRegistry["SOL-USD"]!;
  const clusterOffsetRaw = normalize(process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET);
  const clusterOffset = clusterOffsetRaw
    ? Number.parseInt(clusterOffsetRaw, 10)
    : DEFAULT_CLUSTER_OFFSET;
  if (!Number.isFinite(clusterOffset) || clusterOffset < 0) {
    throw new Error("Invalid NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET");
  }

  const arciumProgramId = parsePublicKey("NEXT_PUBLIC_ARCIUM_PROGRAM_ID", ARCIUM_ADDR);
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
    marketRegistry,
    mempoolAccount: getMempoolAccAddress(clusterOffset),
    executingPool: getExecutingPoolAccAddress(clusterOffset),
    poolAccount: getFeePoolAccAddress(),
    signPdaAccount,
    idl: shadowperpIdl,
  };
}

export type RelayRuntimeContext = {
  client: ShadowPerpClient;
  config: ShadowPerpConfig;
  relayer: Keypair;
  rpcUrl: string;
  wsUrl: string;
};

export function summarizeRelayRuntime(context: RelayRuntimeContext): RelayRuntimeSummary {
  return {
    programId: context.config.programId.toBase58(),
    marketAddress: context.config.marketAddress.toBase58(),
    clusterOffset: context.config.clusterOffset,
    rpcHost: summarizeEndpointHost(context.rpcUrl),
    wsHost: summarizeEndpointHost(context.wsUrl),
    rpcCandidates: collectRpcUrls().map(summarizeEndpointHost),
  };
}

export async function createRelayRuntimeContext(): Promise<RelayRuntimeContext> {
  const programId = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID",
    typeof shadowperpIdl.address === "string" ? shadowperpIdl.address : undefined
  );
  const config = buildRelayConfig(programId);
  const { rpcUrl, wsUrl } = await resolveRpcTransport();
  const relayer = resolveRelayerKeypair();
  const provider = new AnchorProvider(
    new Connection(rpcUrl, { commitment: "confirmed", wsEndpoint: wsUrl }),
    new Wallet(relayer),
    { commitment: "confirmed" }
  );

  return {
    client: new ShadowPerpClient(provider, config),
    config,
    relayer,
    rpcUrl,
    wsUrl,
  };
}
