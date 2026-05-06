import type { NextApiRequest, NextApiResponse } from "next";
import { BN, Program, AnchorProvider, type Idl, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import shadowperpIdl from "../../idl/shadowperp.json";
import { getOrderedReferenceProviders, type ReferenceProviderConfig } from "../../lib/market-feeds";
import { TRADING_PAIRS } from "../../lib/tokens";
import { checkRateLimitAsync } from "../../lib/server/rate-limit";
import { getRequestIp, requirePrivyUser } from "../../lib/server/privy-auth";

type OracleRefreshResponse =
  | {
      success: true;
      refreshed: boolean;
      price: number;
      ageSeconds: number;
      signature?: string;
      providers: string[];
    }
  | { success: false; error: string; stale?: boolean };

const DEFAULT_RPC = "https://api.devnet.solana.com";
const DEFAULT_PROGRAM_ID = "34wszdEvGvyAVADY7ozpbdAvAB9zHRBTaT1YsNcpRJdo";
const DEFAULT_MARKET = "BLvULbGNEKFXYgVGjE6yXWfShAevzKCwqxV1EJS29Pn4";
const DEFAULT_COLLATERAL_MINT = "DbF1Z21WCTbcx5feBB9LNkhtqRE99DZt9ENJT79prHc6";
const DEFAULT_MAX_AGE_SECONDS = 240;
const DEFAULT_MIN_SOURCES = 2;
const USER_RATE_LIMIT = 12;
const IP_RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

let inFlightRefresh: Promise<OracleRefreshResponse> | null = null;

function isOracleAdmin(userId: string): boolean {
  const raw = process.env.ORACLE_ADMIN_USER_IDS?.trim();
  if (!raw) return false;
  return raw.split(",").map((s) => s.trim()).filter(Boolean).includes(userId);
}

function normalizeValue(raw?: string): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value || null;
}

function parseRpcList(raw?: string): string[] {
  const normalized = normalizeValue(raw);
  if (!normalized) return [];
  return normalized
    .split(/[\n,]+/)
    .map((entry) => normalizeValue(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function getRpcCandidates(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string | null) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  };

  for (const url of parseRpcList(process.env.SOLANA_RPC_URLS)) push(url);
  for (const url of parseRpcList(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS)) push(url);
  push(normalizeValue(process.env.SOLANA_RPC_URL));
  push(normalizeValue(process.env.NEXT_PUBLIC_SOLANA_RPC_URL));
  push(DEFAULT_RPC);

  return out;
}

async function getHealthyConnection(): Promise<Connection> {
  const errors: string[] = [];
  for (const rpcUrl of getRpcCandidates()) {
    const connection = new Connection(rpcUrl, "confirmed");
    try {
      await Promise.race([
        connection.getLatestBlockhash("processed"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("rpc probe timeout")), 4_500)
        ),
      ]);
      return connection;
    } catch (error: any) {
      errors.push(`${rpcUrl}: ${String(error?.message || error).split("\n")[0]}`);
    }
  }
  throw new Error(`No healthy RPC endpoint found. ${errors.join(" | ")}`);
}

function parsePublicKey(name: string, fallback: string): PublicKey {
  const raw = normalizeValue(process.env[name]) ?? fallback;
  return new PublicKey(raw);
}

function getAllowedMarkets(programId: PublicKey): Map<string, string> {
  const collateralMint = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_COLLATERAL_MINT",
    normalizeValue(process.env.NEXT_PUBLIC_MOCKUSDC_MINT) ?? DEFAULT_COLLATERAL_MINT
  );
  const allowed = new Map<string, string>();

  for (const pair of TRADING_PAIRS) {
    const [market] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), collateralMint.toBuffer(), pair.base.mint.toBuffer()],
      programId
    );
    allowed.set(market.toBase58(), pair.label);
  }

  const configuredMarket =
    normalizeValue(process.env.NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT) ?? DEFAULT_MARKET;
  allowed.set(configuredMarket, allowed.get(configuredMarket) ?? "SOL-USD");
  return allowed;
}

function getFeederKeypair(): Keypair {
  const secret =
    normalizeValue(process.env.ORACLE_FEEDER_SECRET_KEY) ??
    normalizeValue(process.env.PRICE_FEEDER_SECRET_KEY) ??
    normalizeValue(process.env.SHADOWPERP_ORACLE_KEYPAIR_JSON);

  if (secret) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(secret) as number[]));
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Oracle feeder keypair is not configured.");
  }

  const walletPath =
    normalizeValue(process.env.SOLANA_WALLET) ??
    path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(walletPath)) {
    throw new Error("Oracle feeder keypair is not configured.");
  }
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")) as number[])
  );
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof (value as any).toString === "function") {
    return Number((value as any).toString());
  }
  return Number.NaN;
}

function toRawPrice(ui: number): number {
  return Math.round(ui * 1_000_000);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

async function fetchProviderPrice(config: ReferenceProviderConfig): Promise<number | null> {
  const signal = AbortSignal.timeout(8_000);

  try {
    if (config.provider === "binance") {
      const response = await fetch(
        `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(config.symbol)}`,
        { signal }
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as { price?: string };
      const price = Number.parseFloat(payload.price ?? "");
      return Number.isFinite(price) && price > 0 ? price : null;
    }

    if (config.provider === "coinbase") {
      const response = await fetch(
        `https://api.exchange.coinbase.com/products/${encodeURIComponent(config.symbol)}/ticker`,
        { signal }
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as { price?: string };
      const price = Number.parseFloat(payload.price ?? "");
      return Number.isFinite(price) && price > 0 ? price : null;
    }

    if (config.provider === "bybit") {
      const response = await fetch(
        `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${encodeURIComponent(config.symbol)}`,
        { signal }
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as { result?: { list?: Array<{ lastPrice?: string }> } };
      const price = Number.parseFloat(payload.result?.list?.[0]?.lastPrice ?? "");
      return Number.isFinite(price) && price > 0 ? price : null;
    }

    if (config.provider === "mexc") {
      const response = await fetch(
        `https://api.mexc.com/api/v3/ticker/price?symbol=${encodeURIComponent(config.symbol)}`,
        { signal }
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as { price?: string };
      const price = Number.parseFloat(payload.price ?? "");
      return Number.isFinite(price) && price > 0 ? price : null;
    }

    if (config.provider === "gateio") {
      const response = await fetch(
        `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${encodeURIComponent(config.symbol)}`,
        { signal }
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as Array<{ last?: string }>;
      const price = Number.parseFloat(payload[0]?.last ?? "");
      return Number.isFinite(price) && price > 0 ? price : null;
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchReferencePrice(pairLabel: string): Promise<{ price: number; providers: string[] }> {
  const pair = TRADING_PAIRS.find((candidate) => candidate.label === pairLabel) ?? TRADING_PAIRS[0];
  const providers = getOrderedReferenceProviders(pair);
  const results = await Promise.all(
    providers.map(async (provider) => ({
      key: `${provider.provider}:${provider.symbol}`,
      price: await fetchProviderPrice(provider),
    }))
  );
  const live = results.filter(
    (result): result is { key: string; price: number } =>
      Number.isFinite(result.price) && (result.price as number) > 0
  );
  const minSources = Number.parseInt(
    process.env.ORACLE_REFRESH_MIN_SOURCES ?? `${DEFAULT_MIN_SOURCES}`,
    10
  );
  if (live.length < Math.max(1, minSources)) {
    throw new Error(`Insufficient oracle sources (${live.length}/${minSources}).`);
  }
  return {
    price: median(live.map((result) => result.price)),
    providers: live.map((result) => result.key),
  };
}

async function sendWithPolling(
  connection: Connection,
  signer: Keypair,
  transaction: Transaction
): Promise<string> {
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = signer.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  transaction.sign(signer);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const status = await connection.getSignatureStatuses([signature]);
    const value = status.value[0];
    if (value?.err) throw new Error(`Oracle refresh failed: ${JSON.stringify(value.err)}`);
    if (
      value?.confirmationStatus === "confirmed" ||
      value?.confirmationStatus === "finalized"
    ) {
      return signature;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }

  throw new Error("Oracle refresh confirmation timed out.");
}

async function refreshOracle(req: NextApiRequest, userId: string): Promise<OracleRefreshResponse> {
  const body = (req.body ?? {}) as {
    market?: string;
    pairLabel?: string;
    maxAgeSeconds?: number;
    force?: boolean;
  };
  const programId = parsePublicKey("NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID", DEFAULT_PROGRAM_ID);
  const allowedMarkets = getAllowedMarkets(programId);
  const market = new PublicKey(
    body.market || process.env.NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT || DEFAULT_MARKET
  );
  const marketLabel = allowedMarkets.get(market.toBase58());
  if (!marketLabel) {
    throw new Error("Oracle refresh rejected an unsupported market.");
  }
  const pairLabel = typeof body.pairLabel === "string" ? body.pairLabel : marketLabel;
  if (!TRADING_PAIRS.some((pair) => pair.label === pairLabel)) {
    throw new Error("Oracle refresh rejected an unsupported trading pair.");
  }
  if (pairLabel !== marketLabel) {
    throw new Error("Oracle refresh market and trading pair do not match.");
  }
  const maxAgeSeconds =
    Number.isFinite(body.maxAgeSeconds) && Number(body.maxAgeSeconds) > 0
      ? Number(body.maxAgeSeconds)
      : DEFAULT_MAX_AGE_SECONDS;

  const connection = await getHealthyConnection();
  const readOnlyWallet = Keypair.generate();
  const provider = new AnchorProvider(connection, new Wallet(readOnlyWallet), {
    commitment: "confirmed",
  });
  const idl = { ...(shadowperpIdl as Idl), address: programId.toBase58() };
  const program = new Program(idl, provider);
  const marketAccount = await (program.account as any).market.fetch(market);
  const oracleRaw = toNumber(marketAccount.oraclePrice ?? marketAccount.oracle_price);
  const lastUpdate = toNumber(marketAccount.lastPriceUpdate ?? marketAccount.last_price_update);
  const slot = await connection.getSlot("confirmed");
  const chainTime = await connection.getBlockTime(slot);
  const nowSeconds = Number.isFinite(chainTime)
    ? (chainTime as number)
    : Math.floor(Date.now() / 1000);
  const ageSeconds = nowSeconds - lastUpdate;

  const forceRefresh = body.force === true && isOracleAdmin(userId);
  if (!forceRefresh && Number.isFinite(ageSeconds) && ageSeconds >= 0 && ageSeconds <= maxAgeSeconds) {
    return {
      success: true,
      refreshed: false,
      price: Number.isFinite(oracleRaw) ? oracleRaw / 1_000_000 : 0,
      ageSeconds,
      providers: [],
    };
  }

  const feeder = getFeederKeypair();
  const writeProvider = new AnchorProvider(connection, new Wallet(feeder), {
    commitment: "confirmed",
  });
  const writeProgram = new Program(idl, writeProvider);
  const { price, providers } = await fetchReferencePrice(pairLabel);
  const priceRaw = toRawPrice(price);
  const tx = await (writeProgram.methods as any)
    .updatePrice(new BN(priceRaw))
    .accounts({ priceFeeder: feeder.publicKey, market })
    .transaction();
  const signature = await sendWithPolling(connection, feeder, tx);

  return {
    success: true,
    refreshed: true,
    price,
    ageSeconds: 0,
    signature,
    providers,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OracleRefreshResponse>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  let userId: string;
  try {
    ({ userId } = await requirePrivyUser(req));
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: error instanceof Error ? error.message : "Authentication required.",
    });
  }

  if (
    !(await checkRateLimitAsync(`oracle-refresh:user:${userId}`, USER_RATE_LIMIT, RATE_WINDOW_MS)) ||
    !(await checkRateLimitAsync(`oracle-refresh:ip:${getRequestIp(req)}`, IP_RATE_LIMIT, RATE_WINDOW_MS))
  ) {
    return res.status(429).json({ success: false, error: "Rate limit exceeded." });
  }

  if (inFlightRefresh) {
    const result = await inFlightRefresh;
    return res.status(result.success ? 200 : 500).json(result);
  }

  inFlightRefresh = refreshOracle(req, userId)
    .catch((error) => ({
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
      stale: true,
    }))
    .finally(() => {
      inFlightRefresh = null;
    });

  const result = await inFlightRefresh;
  return res.status(result.success ? 200 : 503).json(result);
}
