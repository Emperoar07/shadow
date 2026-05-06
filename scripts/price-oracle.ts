/**
 * ShadowPerp Oracle Price Feeder (hardened)
 *
 * Safety features:
 * - Multi-source median pricing
 * - Delta + heartbeat write gating
 * - Deviation circuit breaker
 * - Source-disagreement freeze mode
 * - RPC write failover/retry across endpoint candidates
 * - Post-write on-chain verification
 * - Structured metrics + alert hooks
 * - Polling jitter to reduce burst/rate-limit collisions
 *
 * Usage:
 *   npx ts-node scripts/price-oracle.ts
 *   npx ts-node scripts/price-oracle.ts --once
 *   npx ts-node scripts/price-oracle.ts --once --force
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import { collectRpcCandidates, resolveRpcEndpoint, sendAndConfirmWithPolling } from "./rpc";

type SourceQuote = {
  source: string;
  price: number;
};

type MarketSnapshot = {
  oraclePriceRaw: number;
  oraclePriceUi: number;
  lastPriceUpdateSec: number;
};

type OracleMetrics = {
  event: "published" | "skipped" | "frozen" | "error";
  medianPrice: number | null;
  sourcePrices: Record<string, number>;
  sourceDisagreementBps: number | null;
  ageSeconds: number | null;
  moveBps: number | null;
  txSig: string | null;
  txLatencyMs: number | null;
  rpcUrl: string | null;
  consecutiveFailures: number;
  note?: string;
};

type ProgramCtx = {
  rpcUrl: string;
  connection: Connection;
  provider: anchor.AnchorProvider;
  program: anchor.Program;
};

type PublishResult = {
  signature: string;
  latencyMs: number;
  rpcUrl: string;
  verified: MarketSnapshot;
};

const DEFAULT_PROGRAM_ID = "34wszdEvGvyAVADY7ozpbdAvAB9zHRBTaT1YsNcpRJdo";
const DEFAULT_MARKET = "BLvULbGNEKFXYgVGjE6yXWfShAevzKCwqxV1EJS29Pn4";

function ts(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof (value as any).toString === "function") {
    return Number((value as any).toString());
  }
  return Number.NaN;
}

function pickField<T>(value: any, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (value != null && value[key] !== undefined && value[key] !== null) {
      return value[key] as T;
    }
  }
  return undefined;
}

function toRawPrice(ui: number): number {
  return Math.round(ui * 1_000_000);
}

function toUiPrice(raw: number): number {
  return raw / 1_000_000;
}

function fmt(value: number, digits = 4): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "NaN";
}

function deviationBps(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return Number.POSITIVE_INFINITY;
  return (Math.abs(a - b) / b) * 10_000;
}

function sourceDisagreementBps(quotes: SourceQuote[], medianPrice: number): number {
  if (!Number.isFinite(medianPrice) || medianPrice <= 0 || quotes.length < 2) return 0;
  const prices = quotes.map((q) => q.price).filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length < 2) return 0;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return ((max - min) / medianPrice) * 10_000;
}

function median(values: number[]): number {
  if (values.length === 0) throw new Error("Cannot compute median of empty values");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return value;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number, name: string): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return value;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function normalizeValue(raw?: string): string | undefined {
  if (!raw) return undefined;
  let out = raw.trim();
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
}

function parsePublicKey(name: string, value?: string): PublicKey {
  const normalized = normalizeValue(value);
  if (!normalized) {
    throw new Error(`Missing required value: ${name}`);
  }
  return new PublicKey(normalized);
}

function logMetrics(metrics: OracleMetrics): void {
  console.log(`[${ts()}] METRIC ${JSON.stringify(metrics)}`);
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const attempts = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await new Promise((resolve, reject) => {
        const req = https.get(
          url,
          {
            headers: {
              "User-Agent": "shadowperp-oracle/3.0",
              Accept: "application/json",
              ...(headers ?? {}),
            },
          },
          (res) => {
            let body = "";
            res.on("data", (chunk: Buffer) => {
              body += chunk.toString();
            });
            res.on("end", () => {
              if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
                return;
              }
              try {
                resolve(JSON.parse(body));
              } catch (error) {
                reject(new Error(`Failed to parse JSON: ${(error as Error).message}`));
              }
            });
          }
        );
        req.on("error", (error) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
        req.setTimeout(10_000, () => {
          req.destroy(new Error("Request timed out after 10s"));
        });
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < attempts) {
        await sleep(300 * attempt);
      }
    }
  }

  throw new Error(lastError?.message || `Request failed after ${attempts} attempts`);
}

async function postJson(url: string, payload: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify(payload);
  const parsed = new URL(url);

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "shadowperp-oracle-alert/1.0",
        },
      },
      (res) => {
        let response = "";
        res.on("data", (chunk) => {
          response += chunk.toString();
        });
        res.on("end", () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`Alert webhook HTTP ${res.statusCode}: ${response.slice(0, 200)}`));
            return;
          }
          resolve();
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(8_000, () => req.destroy(new Error("Alert webhook timed out")));
    req.write(body);
    req.end();
  });
}

async function fetchCoinGeckoSolUsd(): Promise<number> {
  const data = (await fetchJson(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
  )) as { solana?: { usd?: number } };
  const price = data?.solana?.usd;
  if (typeof price !== "number" || price <= 0) {
    throw new Error(`Unexpected CoinGecko response: ${JSON.stringify(data)}`);
  }
  return price;
}

async function fetchBinanceSolUsd(): Promise<number> {
  const data = (await fetchJson(
    "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT"
  )) as { price?: string };
  const price = Number(data?.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Unexpected Binance response: ${JSON.stringify(data)}`);
  }
  return price;
}

async function fetchCoinbaseSolUsd(): Promise<number> {
  const data = (await fetchJson(
    "https://api.coinbase.com/v2/prices/SOL-USD/spot"
  )) as { data?: { amount?: string } };
  const price = Number(data?.data?.amount);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Unexpected Coinbase response: ${JSON.stringify(data)}`);
  }
  return price;
}

async function fetchKrakenSolUsd(): Promise<number> {
  const data = (await fetchJson(
    "https://api.kraken.com/0/public/Ticker?pair=SOLUSD"
  )) as {
    error?: string[];
    result?: Record<string, { c?: [string, string] }>;
  };

  if (Array.isArray(data?.error) && data.error.length > 0) {
    throw new Error(`Kraken error: ${data.error.join(", ")}`);
  }

  const ticker = data?.result ? Object.values(data.result)[0] : undefined;
  const price = Number(ticker?.c?.[0]);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Unexpected Kraken response: ${JSON.stringify(data)}`);
  }
  return price;
}

async function fetchCoinMarketCapSolUsd(apiKey: string): Promise<number> {
  const data = (await fetchJson(
    "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=SOL&convert=USD",
    { "X-CMC_PRO_API_KEY": apiKey }
  )) as { data?: { SOL?: { quote?: { USD?: { price?: number } } } } };
  const price = data?.data?.SOL?.quote?.USD?.price;
  if (typeof price !== "number" || price <= 0) {
    throw new Error(`Unexpected CoinMarketCap response: ${JSON.stringify(data)}`);
  }
  return price;
}

async function fetchCompositePrice(
  minSourcesRequired: number
): Promise<{ medianPrice: number; quotes: SourceQuote[]; warnings: string[] }> {
  const cmcApiKey = process.env.COINMARKETCAP_API_KEY?.trim();
  const sources: Array<{ name: string; fetcher: () => Promise<number> }> = [
    { name: "coingecko", fetcher: fetchCoinGeckoSolUsd },
    { name: "binance", fetcher: fetchBinanceSolUsd },
    { name: "coinbase", fetcher: fetchCoinbaseSolUsd },
    { name: "kraken", fetcher: fetchKrakenSolUsd },
  ];
  if (cmcApiKey) {
    sources.push({ name: "coinmarketcap", fetcher: () => fetchCoinMarketCapSolUsd(cmcApiKey) });
  }

  const settled = await Promise.allSettled(
    sources.map(async (src) => ({ source: src.name, price: await src.fetcher() }))
  );

  const quotes: SourceQuote[] = [];
  const warnings: string[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      const { source, price } = result.value;
      if (Number.isFinite(price) && price > 0) {
        quotes.push({ source, price });
      } else {
        warnings.push(`${source}: invalid price ${String(price)}`);
      }
    } else {
      warnings.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  // Strict source-count policy is handled by the caller so we can support
  // guarded single-source failsafe when freshness is at risk.
  if (quotes.length === 0) {
    throw new Error(`No healthy oracle sources. ${warnings.join(" | ")}`);
  }

  return {
    medianPrice: median(quotes.map((q) => q.price)),
    quotes,
    warnings,
  };
}

async function main(): Promise<void> {
  const onceMode = readFlag("once");
  const forceMode = readFlag("force");
  const manualPriceArg = readArg("manual-price");
  const manualPriceUsd = manualPriceArg ? parseFloat(manualPriceArg) : null;
  if (manualPriceUsd !== null && (!Number.isFinite(manualPriceUsd) || manualPriceUsd <= 0)) {
    throw new Error(`Invalid --manual-price value: ${manualPriceArg}`);
  }
  loadEnvFile(path.resolve(__dirname, "..", "app", ".env.local"));

  const rpcSelection = await resolveRpcEndpoint({
    preferred: process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    commitment: "confirmed",
  });
  let activeRpcUrl = rpcSelection.rpcUrl;

  const programIdRaw =
    process.env.SHADOWPERP_PROGRAM_ID ||
    process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ||
    DEFAULT_PROGRAM_ID;
  if (!normalizeValue(programIdRaw)) {
    throw new Error("Missing SHADOWPERP_PROGRAM_ID / NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID");
  }
  const marketRaw =
    process.env.SHADOWPERP_MARKET ||
    process.env.NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT ||
    DEFAULT_MARKET;
  if (!normalizeValue(marketRaw)) {
    throw new Error("Missing SHADOWPERP_MARKET / NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT");
  }
  const walletPath =
    process.env.SOLANA_WALLET ||
    path.resolve(process.env.HOME || process.env.USERPROFILE || "~", ".config", "solana", "id.json");
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet keypair not found at ${walletPath}`);
  }

  const intervalMs = parsePositiveInt(process.env.UPDATE_INTERVAL_MS, 30_000, "UPDATE_INTERVAL_MS");
  const jitterMs = parseNonNegativeInt(process.env.ORACLE_JITTER_MS, 3_000, "ORACLE_JITTER_MS");
  const heartbeatSeconds = parsePositiveInt(
    process.env.ORACLE_HEARTBEAT_SECONDS,
    120,
    "ORACLE_HEARTBEAT_SECONDS"
  );
  const minMoveBps = parsePositiveInt(process.env.ORACLE_MIN_MOVE_BPS, 10, "ORACLE_MIN_MOVE_BPS");
  const maxDeviationBps = parsePositiveInt(
    process.env.ORACLE_MAX_DEVIATION_BPS,
    500,
    "ORACLE_MAX_DEVIATION_BPS"
  );
  const staleRecoverySeconds = parsePositiveInt(
    process.env.ORACLE_STALE_RECOVERY_SECONDS,
    900,
    "ORACLE_STALE_RECOVERY_SECONDS"
  );
  const staleRecoveryMaxMoveBps = parsePositiveInt(
    process.env.ORACLE_STALE_RECOVERY_MAX_MOVE_BPS,
    2500,
    "ORACLE_STALE_RECOVERY_MAX_MOVE_BPS"
  );
  const minSourcesRequired = parsePositiveInt(
    process.env.ORACLE_MIN_SOURCES_REQUIRED,
    2,
    "ORACLE_MIN_SOURCES_REQUIRED"
  );
  const failsafeAllowSingleSource = parseBoolean(
    process.env.ORACLE_FAILSAFE_ALLOW_SINGLE_SOURCE,
    true
  );
  const failsafeMaxMoveBps = parsePositiveInt(
    process.env.ORACLE_FAILSAFE_MAX_MOVE_BPS,
    150,
    "ORACLE_FAILSAFE_MAX_MOVE_BPS"
  );
  const safetyModeEnabled = parseBoolean(process.env.ORACLE_SAFETY_MODE, true);
  const sourceDisagreeLimitBps = parsePositiveInt(
    process.env.ORACLE_SOURCE_DISAGREE_BPS,
    120,
    "ORACLE_SOURCE_DISAGREE_BPS"
  );
  const staleAlertSeconds = parsePositiveInt(
    process.env.ORACLE_STALE_ALERT_SECONDS,
    240,
    "ORACLE_STALE_ALERT_SECONDS"
  );
  const alertCooldownSeconds = parsePositiveInt(
    process.env.ORACLE_ALERT_COOLDOWN_SECONDS,
    300,
    "ORACLE_ALERT_COOLDOWN_SECONDS"
  );
  const alertWebhookUrl = process.env.ORACLE_ALERT_WEBHOOK_URL?.trim();

  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  const programId = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID",
    programIdRaw
  );
  const marketPda = parsePublicKey(
    "NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT",
    marketRaw
  );

  const idlPathCandidates = [
    path.resolve(__dirname, "..", "target", "idl", "shadowperp.json"),
    path.resolve(__dirname, "..", "app", "src", "idl", "shadowperp.json"),
  ];
  const idlPath = idlPathCandidates.find((p) => fs.existsSync(p));
  if (!idlPath) {
    throw new Error("shadowperp.json IDL not found. Run anchor build first.");
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8")) as anchor.Idl & { address?: string };
  idl.address = programId.toBase58();

  const programCache = new Map<string, ProgramCtx>();
  const getProgramCtx = (rpcUrl: string): ProgramCtx => {
    const cached = programCache.get(rpcUrl);
    if (cached) return cached;
    const connection = new Connection(rpcUrl, "confirmed");
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(walletKeypair), {
      commitment: "confirmed",
    });
    const program = new anchor.Program(idl as anchor.Idl, provider);
    const ctx: ProgramCtx = { rpcUrl, connection, provider, program };
    programCache.set(rpcUrl, ctx);
    return ctx;
  };

  const fetchSnapshot = async (ctx: ProgramCtx): Promise<MarketSnapshot> => {
    const market = await (ctx.program.account as any).market.fetch(marketPda);
    const oracleRaw = toNumber(pickField<any>(market, "oraclePrice", "oracle_price"));
    const lastUpdate = toNumber(pickField<any>(market, "lastPriceUpdate", "last_price_update"));
    return {
      oraclePriceRaw: oracleRaw,
      oraclePriceUi: Number.isFinite(oracleRaw) ? toUiPrice(oracleRaw) : Number.NaN,
      lastPriceUpdateSec: lastUpdate,
    };
  };

  const fetchSnapshotWithFailover = async (): Promise<MarketSnapshot> => {
    const candidates = collectRpcCandidates(activeRpcUrl);
    const errors: string[] = [];
    for (const rpcUrl of candidates) {
      try {
        const snapshot = await fetchSnapshot(getProgramCtx(rpcUrl));
        activeRpcUrl = rpcUrl;
        return snapshot;
      } catch (error) {
        errors.push(`${rpcUrl}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`Unable to fetch market snapshot from all RPCs. ${errors.join(" | ")}`);
  };

  const alertLastSent = new Map<string, number>();
  const emitAlert = async (
    key: string,
    message: string,
    context: Record<string, unknown>
  ): Promise<void> => {
    const now = Date.now();
    const last = alertLastSent.get(key) ?? 0;
    if (now - last < alertCooldownSeconds * 1000) return;
    alertLastSent.set(key, now);

    const payload = {
      time: ts(),
      level: "critical",
      component: "shadowperp-oracle",
      key,
      message,
      context,
    };
    console.error(`[${payload.time}] ALERT ${message} | ${JSON.stringify(context)}`);
    if (!alertWebhookUrl) return;
    try {
      await postJson(alertWebhookUrl, payload);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[${ts()}] ALERT delivery failed: ${errMsg}`);
    }
  };

  const publishWithRpcFailover = async (priceRaw: number): Promise<PublishResult> => {
    const candidates = collectRpcCandidates(activeRpcUrl);
    const errors: string[] = [];

    for (const rpcUrl of candidates) {
      const ctx = getProgramCtx(rpcUrl);
      try {
        const started = Date.now();
        const tx = await (ctx.program.methods as any)
          .updatePrice(new anchor.BN(priceRaw))
          .accounts({ priceFeeder: walletKeypair.publicKey, market: marketPda })
          .transaction();

        const signature = await sendAndConfirmWithPolling(ctx.connection, walletKeypair, tx, {
          commitment: "confirmed",
          timeoutMs: 90_000,
          pollMs: 1_500,
        });

        // Read-after-write verification.
        const verified = await fetchSnapshot(ctx);
        if (verified.oraclePriceRaw !== priceRaw) {
          throw new Error(
            `Post-write verification mismatch: expected=${priceRaw}, got=${verified.oraclePriceRaw}`
          );
        }

        const latencyMs = Date.now() - started;
        activeRpcUrl = rpcUrl;
        return {
          signature,
          latencyMs,
          rpcUrl,
          verified,
        };
      } catch (error) {
        errors.push(`${rpcUrl}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(`All RPC write attempts failed. ${errors.join(" | ")}`);
  };

  let snapshot = await fetchSnapshotWithFailover();
  let lastAcceptedPriceUi =
    Number.isFinite(snapshot.oraclePriceUi) && snapshot.oraclePriceUi > 0
      ? snapshot.oraclePriceUi
      : null;
  let lastAcceptedUpdateSec =
    Number.isFinite(snapshot.lastPriceUpdateSec) && snapshot.lastPriceUpdateSec > 0
      ? snapshot.lastPriceUpdateSec
      : 0;
  let consecutiveFailures = 0;

  console.log(`[${ts()}] ShadowPerp Oracle Price Feeder started (${onceMode ? "one-shot" : "daemon"})`);
  console.log(`  Program:            ${programId.toBase58()}`);
  console.log(`  Market:             ${marketPda.toBase58()}`);
  console.log(`  Feeder:             ${walletKeypair.publicKey.toBase58()}`);
  console.log(`  Active RPC:         ${activeRpcUrl}`);
  console.log(`  RPC candidates:     ${collectRpcCandidates(activeRpcUrl).length}`);
  console.log(`  Heartbeat:          ${heartbeatSeconds}s`);
  console.log(`  Move threshold:     ${minMoveBps} bps`);
  console.log(`  Max deviation:      ${maxDeviationBps} bps`);
  console.log(`  Stale recovery:     ${staleRecoverySeconds}s <= ${staleRecoveryMaxMoveBps} bps`);
  console.log(`  Safety mode:        ${safetyModeEnabled ? "enabled" : "disabled"}`);
  console.log(`  Source disagree:    ${sourceDisagreeLimitBps} bps`);
  console.log(`  Min sources:        ${minSourcesRequired}`);
  console.log(
    `  Failsafe mode:      ${
      failsafeAllowSingleSource ? `single-source <= ${failsafeMaxMoveBps} bps` : "disabled"
    }`
  );
  console.log(`  Stale alert:        ${staleAlertSeconds}s`);
  console.log(`  Alert cooldown:     ${alertCooldownSeconds}s`);
  console.log(`  Alert webhook:      ${alertWebhookUrl ? "configured" : "not configured (console alerts only)"}`);
  console.log(`  Last on-chain:      ${lastAcceptedPriceUi ? `$${fmt(lastAcceptedPriceUi)}` : "unset"}`);
  if (manualPriceUsd !== null) {
    console.log(`  MANUAL OVERRIDE:    $${fmt(manualPriceUsd)} (bypassing all source fetching)`);
  }
  console.log("");

  const runTick = async (): Promise<void> => {
    let effectiveMedianPrice: number;
    let quotes: SourceQuote[];
    let warnings: string[];
    let reducedSourceMode = false;
    const nowSec = Math.floor(Date.now() / 1000);
    const ageSeconds =
      lastAcceptedUpdateSec > 0
        ? Math.max(0, nowSec - lastAcceptedUpdateSec)
        : Number.POSITIVE_INFINITY;

    if (manualPriceUsd !== null) {
      // Manual override — skip all external source fetching and safety checks
      effectiveMedianPrice = manualPriceUsd;
      quotes = [{ source: "manual", price: manualPriceUsd }];
      warnings = [];
      console.log(`[${ts()}] Using manual price override: $${fmt(manualPriceUsd)}`);
    } else {
      const composite = await fetchCompositePrice(minSourcesRequired);
      effectiveMedianPrice = composite.medianPrice;
      quotes = composite.quotes;
      warnings = composite.warnings;

      if (quotes.length < minSourcesRequired) {
        const note = `Insufficient oracle sources (${quotes.length}/${minSourcesRequired})`;
        const moveFromLast =
          lastAcceptedPriceUi !== null
            ? deviationBps(effectiveMedianPrice, lastAcceptedPriceUi)
            : Number.POSITIVE_INFINITY;
        const canUseFailsafe =
          failsafeAllowSingleSource &&
          quotes.length >= 1 &&
          ageSeconds >= heartbeatSeconds &&
          (lastAcceptedPriceUi === null || moveFromLast <= failsafeMaxMoveBps);

        if (!canUseFailsafe) {
          throw new Error(`${note}. ${warnings.join(" | ")}`);
        }

        reducedSourceMode = true;
        await emitAlert("oracle-failsafe-single-source", `${note}; using guarded failsafe`, {
          quotes: quotes.map((q) => q.source),
          ageSeconds,
          medianPrice: effectiveMedianPrice,
          moveBps: Number.isFinite(moveFromLast) ? moveFromLast : null,
          failsafeMaxMoveBps,
        });
      }
    }

    const moveBps =
      lastAcceptedPriceUi !== null
        ? deviationBps(effectiveMedianPrice, lastAcceptedPriceUi)
        : Number.POSITIVE_INFINITY;
    const disagreeBps = manualPriceUsd !== null ? 0 : sourceDisagreementBps(quotes, effectiveMedianPrice);
    const sourcePrices = Object.fromEntries(quotes.map((q) => [q.source, Number(q.price.toFixed(8))]));

    if (ageSeconds >= staleAlertSeconds) {
      await emitAlert("oracle-stale-warning", "Oracle freshness approaching stale threshold", {
        ageSeconds,
        staleAlertSeconds,
        heartbeatSeconds,
        activeRpcUrl,
      });
    }

    if (manualPriceUsd === null && safetyModeEnabled && disagreeBps > sourceDisagreeLimitBps) {
      const note = `Safety freeze: source disagreement ${fmt(disagreeBps, 2)} bps > ${sourceDisagreeLimitBps} bps`;
      consecutiveFailures += 1;
      await emitAlert("oracle-source-disagreement", note, {
        medianPrice: effectiveMedianPrice,
        sourcePrices,
        disagreeBps,
        limitBps: sourceDisagreeLimitBps,
      });
      logMetrics({
        event: "frozen",
        medianPrice: effectiveMedianPrice,
        sourcePrices,
        sourceDisagreementBps: disagreeBps,
        ageSeconds,
        moveBps,
        txSig: null,
        txLatencyMs: null,
        rpcUrl: activeRpcUrl,
        consecutiveFailures,
        note,
      });
      if (onceMode) throw new Error(note);
      return;
    }

    if (manualPriceUsd === null && lastAcceptedPriceUi !== null && maxDeviationBps > 0 && moveBps > maxDeviationBps) {
      const staleRecoveryActive =
        ageSeconds >= staleRecoverySeconds &&
        quotes.length >= minSourcesRequired &&
        disagreeBps <= sourceDisagreeLimitBps &&
        moveBps <= staleRecoveryMaxMoveBps;

      if (staleRecoveryActive) {
        console.warn(
          `[${ts()}] Stale-recovery override active: age=${ageSeconds}s move=${fmt(
            moveBps,
            2
          )}bps disagreement=${fmt(disagreeBps, 2)}bps`
        );
      } else {
      const note = `Circuit breaker: move ${fmt(moveBps, 2)} bps > ${maxDeviationBps} bps`;
      consecutiveFailures += 1;
      await emitAlert("oracle-circuit-breaker", note, {
        medianPrice: effectiveMedianPrice,
        lastAcceptedPriceUi,
        moveBps,
        maxDeviationBps,
      });
      logMetrics({
        event: "frozen",
        medianPrice: effectiveMedianPrice,
        sourcePrices,
        sourceDisagreementBps: disagreeBps,
        ageSeconds,
        moveBps,
        txSig: null,
        txLatencyMs: null,
        rpcUrl: activeRpcUrl,
        consecutiveFailures,
        note,
      });
      if (onceMode) throw new Error(note);
      return;
      }
    }

    const shouldPublish =
      manualPriceUsd !== null ||
      forceMode ||
      lastAcceptedPriceUi === null ||
      ageSeconds >= heartbeatSeconds ||
      moveBps >= minMoveBps;

    if (!shouldPublish) {
      consecutiveFailures = 0;
      logMetrics({
        event: "skipped",
        medianPrice: effectiveMedianPrice,
        sourcePrices,
        sourceDisagreementBps: disagreeBps,
        ageSeconds,
        moveBps,
        txSig: null,
        txLatencyMs: null,
        rpcUrl: activeRpcUrl,
        consecutiveFailures,
        note: "Thresholds not met",
      });
      if (warnings.length > 0) {
        console.warn(`[${ts()}] Source warnings: ${warnings.join(" | ")}`);
      }
      return;
    }

    const priceRaw = toRawPrice(effectiveMedianPrice);
    const result = await publishWithRpcFailover(priceRaw);
    lastAcceptedPriceUi = result.verified.oraclePriceUi;
    lastAcceptedUpdateSec = result.verified.lastPriceUpdateSec;
    consecutiveFailures = 0;

    logMetrics({
      event: "published",
      medianPrice: effectiveMedianPrice,
      sourcePrices,
      sourceDisagreementBps: disagreeBps,
      ageSeconds,
      moveBps,
      txSig: result.signature,
      txLatencyMs: result.latencyMs,
      rpcUrl: result.rpcUrl,
      consecutiveFailures,
    });

    console.log(
      `[${ts()}] Price updated: median=$${fmt(effectiveMedianPrice)} raw=${priceRaw} | sig=${result.signature.slice(
        0,
        8
      )}... | rpc=${result.rpcUrl} | txLatency=${result.latencyMs}ms${reducedSourceMode ? " | mode=failsafe-single-source" : ""}`
    );
    if (warnings.length > 0) {
      console.warn(`[${ts()}] Source warnings: ${warnings.join(" | ")}`);
    }
  };

  if (onceMode) {
    await runTick();
    return;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runTick();
    } catch (error) {
      consecutiveFailures += 1;
      const message = error instanceof Error ? error.message : String(error);
      logMetrics({
        event: "error",
        medianPrice: null,
        sourcePrices: {},
        sourceDisagreementBps: null,
        ageSeconds:
          lastAcceptedUpdateSec > 0 ? Math.max(0, Math.floor(Date.now() / 1000) - lastAcceptedUpdateSec) : null,
        moveBps: null,
        txSig: null,
        txLatencyMs: null,
        rpcUrl: activeRpcUrl,
        consecutiveFailures,
        note: message,
      });
      await emitAlert("oracle-runtime-error", message, {
        consecutiveFailures,
        activeRpcUrl,
      });
    }

    const jitter = jitterMs > 0 ? Math.floor((Math.random() * 2 - 1) * jitterMs) : 0;
    const delayMs = Math.max(1_000, intervalMs + jitter);
    await sleep(delayMs);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${ts()}] Fatal: ${message}`);
  process.exit(1);
});
