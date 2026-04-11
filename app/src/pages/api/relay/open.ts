import type { NextApiRequest, NextApiResponse } from "next";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import {
  base64ToUint8,
  buildRelaySessionAuthMessage,
} from "../../../lib/relay-session-auth";
import {
  createRelayRuntimeContext,
  RelayRuntimeContext,
  RelayRuntimeSummary,
  summarizeRelayRuntime,
} from "../../../lib/server/relay-client";
import { extractErrorMessage, isMissingAccountError } from "../../../lib/account-errors";
import { checkRateLimit } from "../../../lib/server/rate-limit";

const OPEN_RATE_LIMIT = 10; // max 10 open requests per owner per minute
const RATE_WINDOW_MS = 60_000;
const ORACLE_MAX_AGE_SECONDS = 270; // refresh if older than this (contract requires < 300; 30s margin)
const ALL_MARKETS_SESSION_KEY = "__all_markets__";

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const ORACLE_MIN_SOURCES = parsePositiveIntEnv("ORACLE_MIN_SOURCES_REQUIRED", 1);
const ORACLE_FAILSAFE_ALLOW_SINGLE_SOURCE = parseBooleanEnv(
  "ORACLE_FAILSAFE_ALLOW_SINGLE_SOURCE",
  true
);
const ORACLE_FAILSAFE_MAX_MOVE_BPS = parsePositiveIntEnv(
  "ORACLE_FAILSAFE_MAX_MOVE_BPS",
  150
);

const PAIR_PRICE_SOURCES: Record<string, { coingeckoId: string; binanceSymbol: string; coinbaseSymbol: string }> = {
  "SOL-USD": { coingeckoId: "solana", binanceSymbol: "SOLUSDT", coinbaseSymbol: "SOL-USD" },
  "BTC-USD": { coingeckoId: "bitcoin", binanceSymbol: "BTCUSDT", coinbaseSymbol: "BTC-USD" },
  "ETH-USD": { coingeckoId: "ethereum", binanceSymbol: "ETHUSDT", coinbaseSymbol: "ETH-USD" },
  "JUP-USD": { coingeckoId: "jupiter-exchange-solana", binanceSymbol: "JUPUSDT", coinbaseSymbol: "JUP-USD" },
  "PYTH-USD": { coingeckoId: "pyth-network", binanceSymbol: "PYTHUSDT", coinbaseSymbol: "PYTH-USD" },
  "ORCA-USD": { coingeckoId: "orca", binanceSymbol: "ORCAUSDT", coinbaseSymbol: "ORCA-USD" },
};

type OracleQuote = {
  source: string;
  price: number;
};

type OracleSnapshot = {
  ageSeconds: number;
  priceUi: number;
};

type OpenRequestBody = {
  owner?: string;
  sessionId?: string;
  side?: "long" | "short";
  marginMode?: "cross" | "isolated";
  leverage?: number;
  sizeRaw?: string;
  entryPriceRaw?: string;
  marginRaw?: string;
  pairLabel?: string;
  auth?: {
    action?: "open" | "deposit" | "withdraw";
    expiresAt?: number;
    signature?: string;
  };
};

type OpenResponse =
  | {
      ok: true;
      txSignature: string;
      positionAddress: string;
      relayMode: "session";
    }
  | {
      ok: false;
      error: string;
      debugId?: string;
      runtime?: RelayRuntimeSummary;
    };

async function getOracleAgeSeconds(
  relay: RelayRuntimeContext,
  marketAddress: PublicKey
): Promise<number> {
  const market = await relay.client.getMarket(marketAddress);
  const lastUpdate = Number(market.lastPriceUpdate?.toString?.() ?? "0");
  return Math.floor(Date.now() / 1000) - lastUpdate;
}

async function getOracleSnapshot(
  relay: RelayRuntimeContext,
  marketAddress: PublicKey
): Promise<OracleSnapshot> {
  const market = await relay.client.getMarket(marketAddress);
  const lastUpdate = Number(market.lastPriceUpdate?.toString?.() ?? "0");
  const oraclePriceRaw = Number(market.oraclePrice?.toString?.() ?? "0");
  return {
    ageSeconds: Math.floor(Date.now() / 1000) - lastUpdate,
    priceUi: oraclePriceRaw > 0 ? oraclePriceRaw / 1_000_000 : Number.NaN,
  };
}

function deviationBps(nextPrice: number, previousPrice: number): number {
  if (!Number.isFinite(nextPrice) || !Number.isFinite(previousPrice) || previousPrice <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return (Math.abs(nextPrice - previousPrice) / previousPrice) * 10_000;
}

const PRICE_FETCH_TIMEOUT_MS = 5_000;

async function fetchPriceJson(url: string, source: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRICE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const trimmed = detail.replace(/\s+/g, " ").trim();
      throw new Error(
        `${source}: HTTP ${response.status}${trimmed ? ` ${trimmed.slice(0, 120)}` : ""}`
      );
    }
    return response.json();
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(`${source}: request timed out after ${PRICE_FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPairPrice(pairLabel: string): Promise<{
  medianPrice: number;
  quotes: OracleQuote[];
  warnings: string[];
}> {
  const sources = PAIR_PRICE_SOURCES[pairLabel];
  if (!sources) throw new Error(`No price source configured for ${pairLabel}`);

  const results = await Promise.allSettled([
    fetchPriceJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${sources.coingeckoId}&vs_currencies=usd`,
      "coingecko"
    )
      .then((d: any) => ({
        source: "coingecko",
        price: d?.[sources.coingeckoId]?.usd as number,
      })),
    fetchPriceJson(
      `https://api.binance.com/api/v3/ticker/price?symbol=${sources.binanceSymbol}`,
      "binance"
    )
      .then((d: any) => ({
        source: "binance",
        price: parseFloat(d?.price),
      })),
    fetchPriceJson(
      `https://api.coinbase.com/v2/prices/${sources.coinbaseSymbol}/spot`,
      "coinbase"
    )
      .then((d: any) => ({
        source: "coinbase",
        price: parseFloat(d?.data?.amount),
      })),
  ]);

  const quotes: OracleQuote[] = [];
  const warnings: string[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      if (Number.isFinite(result.value.price) && result.value.price > 0) {
        quotes.push(result.value);
      } else {
        warnings.push(`${result.value.source}: invalid price ${String(result.value.price)}`);
      }
      continue;
    }
    warnings.push(extractErrorMessage(result.reason));
  }

  if (quotes.length === 0) {
    const details = warnings.length > 0 ? ` ${warnings.join(" | ")}` : "";
    throw new Error(`No usable oracle sources for ${pairLabel}.${details}`);
  }

  const prices = quotes.map((quote) => quote.price).sort((a, b) => a - b);
  return {
    medianPrice: prices[Math.floor(prices.length / 2)],
    quotes,
    warnings,
  };
}

async function ensureOracleFresh(
  relay: RelayRuntimeContext,
  marketAddress: PublicKey,
  pairLabel: string
): Promise<void> {
  try {
    const snapshot = await getOracleSnapshot(relay, marketAddress);
    if (snapshot.ageSeconds < ORACLE_MAX_AGE_SECONDS) return;

    const composite = await fetchPairPrice(pairLabel);
    const sourceCount = composite.quotes.length;
    const details = composite.warnings.length > 0 ? ` ${composite.warnings.join(" | ")}` : "";
    const moveFromLastBps = deviationBps(composite.medianPrice, snapshot.priceUi);
    const reducedSourceMode =
      sourceCount < ORACLE_MIN_SOURCES &&
      ORACLE_FAILSAFE_ALLOW_SINGLE_SOURCE &&
      sourceCount >= 1 &&
      Number.isFinite(moveFromLastBps) &&
      moveFromLastBps <= ORACLE_FAILSAFE_MAX_MOVE_BPS;

    if (sourceCount < ORACLE_MIN_SOURCES && !reducedSourceMode) {
      throw new Error(
        `Insufficient oracle sources for ${pairLabel} (${sourceCount}/${ORACLE_MIN_SOURCES}).${details}`
      );
    }

    if (composite.warnings.length > 0) {
      console.warn("[relay/open:oracle]", {
        market: marketAddress.toBase58(),
        pairLabel,
        warnings: composite.warnings,
        reducedSourceMode,
        sourceCount,
        minSourcesRequired: ORACLE_MIN_SOURCES,
        moveFromLastBps: Number.isFinite(moveFromLastBps) ? moveFromLastBps : null,
      });
    }

    const priceMicro = new BN(Math.round(composite.medianPrice * 1_000_000));
    await relay.client.updateOraclePrice(
      marketAddress,
      relay.relayer.publicKey,
      priceMicro
    );

    const refreshedAge = await getOracleAgeSeconds(relay, marketAddress);
    if (refreshedAge < ORACLE_MAX_AGE_SECONDS) return;

    throw new Error(
      `Oracle remained stale for ${pairLabel} after refresh (${refreshedAge}s old).`
    );
  } catch (error) {
    const latestAge = await getOracleAgeSeconds(relay, marketAddress).catch(() => null);
    if (latestAge !== null && latestAge < ORACLE_MAX_AGE_SECONDS) {
      return;
    }
    throw new Error(
      `Oracle is stale for ${pairLabel} and automatic refresh failed: ${extractErrorMessage(error)}`
    );
  }
}

function parseU64Bn(name: string, value?: string): BN {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  const bn = new BN(value, 10);
  if (bn.isZero()) throw new Error(`${name} must be > 0`);
  return bn;
}

function buildDebugId(): string {
  return `relay-open-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OpenResponse>
): Promise<void> {
  const debugId = buildDebugId();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  let relay;
  try {
    relay = await createRelayRuntimeContext();
  } catch (error: any) {
    console.error("[relay/open:init]", {
      debugId,
      error: extractErrorMessage(error),
    });
    res.status(503).json({
      ok: false,
      error: typeof error?.message === "string" ? error.message : "Relay unavailable",
      debugId,
    });
    return;
  }

  const runtimeSummary = summarizeRelayRuntime(relay);

  try {
    const body = (req.body || {}) as OpenRequestBody;
    if (!body.owner) throw new Error("Missing owner");
    if (!body.sessionId || !/^\d+$/.test(body.sessionId)) throw new Error("Invalid sessionId");

    if (!checkRateLimit(`open:${body.owner}`, OPEN_RATE_LIMIT, RATE_WINDOW_MS)) {
      res.status(429).json({ ok: false, error: "Rate limit exceeded. Try again later." });
      return;
    }
    if (body.side !== "long" && body.side !== "short") throw new Error("Invalid side");
    if (body.marginMode && body.marginMode !== "cross" && body.marginMode !== "isolated") {
      throw new Error("Invalid marginMode");
    }
    if (!Number.isInteger(body.leverage) || (body.leverage as number) < 1) {
      throw new Error("Invalid leverage");
    }
    if (!body.auth?.signature) throw new Error("Missing auth signature");
    if (!Number.isFinite(body.auth?.expiresAt)) throw new Error("Missing auth expiry");
    if (body.auth?.action && body.auth.action !== "open") {
      throw new Error("Authorization action mismatch");
    }

    const owner = new PublicKey(body.owner);
    const sessionId = new BN(body.sessionId, 10);
    const size = parseU64Bn("sizeRaw", body.sizeRaw);
    const entryPrice = parseU64Bn("entryPriceRaw", body.entryPriceRaw);
    const margin = parseU64Bn("marginRaw", body.marginRaw);

    const pairLabel = body.pairLabel ?? "SOL-USD";
    const marketAddress = relay.config.marketRegistry[pairLabel] ?? relay.config.marketAddress;
    if (!relay.config.marketRegistry[pairLabel]) {
      throw new Error(`Unknown trading pair: ${pairLabel}`);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    let sessionVersion: "v1" | "v2" = "v1";
    let sessionExpiry: number;
    let sessionUsedActions: number;
    let sessionMaxActions: number;
    let sessionMaxMarginPerAction: BN;
    try {
      const sessionAddress = relay.client.getTradeSessionV2Address(owner, sessionId);
      const session = await relay.client.getTradeSessionV2(sessionAddress);
      if (!session.owner.equals(owner)) {
        throw new Error("Session owner mismatch");
      }
      if (!session.relayer.equals(relay.relayer.publicKey)) {
        throw new Error("Session relayer mismatch");
      }
      if (session.revoked) {
        throw new Error("Session revoked");
      }
      sessionVersion = "v2";
      sessionExpiry = Number(session.expiresAt.toString());
      sessionUsedActions = session.usedActions;
      sessionMaxActions = session.maxActions;
      sessionMaxMarginPerAction = session.maxMarginPerAction;
    } catch (v2Error) {
      if (!isMissingAccountError(v2Error)) {
        throw v2Error;
      }

      const sessionAddress = relay.client.getTradeSessionAddress(marketAddress, owner, sessionId);
      const session = await relay.client.getTradeSession(sessionAddress);
      if (!session.owner.equals(owner)) {
        throw new Error("Session owner mismatch");
      }
      if (!session.market.equals(marketAddress)) {
        throw new Error("Session market mismatch");
      }
      if (!session.relayer.equals(relay.relayer.publicKey)) {
        throw new Error("Session relayer mismatch");
      }
      if (session.revoked) {
        throw new Error("Session revoked");
      }
      sessionExpiry = Number(session.expiresAt.toString());
      sessionUsedActions = session.usedActions;
      sessionMaxActions = session.maxActions;
      sessionMaxMarginPerAction = session.maxMarginPerAction;
    }

    if (sessionExpiry <= nowSeconds) {
      throw new Error("Session expired");
    }
    const authExpiresAt = Math.floor(body.auth.expiresAt as number);
    if (authExpiresAt > sessionExpiry) {
      throw new Error("Authorization expiry exceeds session expiry");
    }
    if (authExpiresAt <= nowSeconds) {
      throw new Error("Session authorization expired");
    }
    const message = buildRelaySessionAuthMessage({
      owner: owner.toBase58(),
      market:
        sessionVersion === "v2"
          ? ALL_MARKETS_SESSION_KEY
          : marketAddress.toBase58(),
      sessionId: sessionId.toString(),
      action: "open",
      sessionExpiresAt: sessionExpiry,
      authExpiresAt,
    });
    const verified = ed25519.verify(
      base64ToUint8(body.auth.signature),
      new TextEncoder().encode(message),
      owner.toBytes()
    );
    if (!verified) {
      throw new Error("Invalid session authorization signature");
    }
    if (sessionUsedActions >= sessionMaxActions) {
      throw new Error("Session action limit reached");
    }
    if (margin.gt(sessionMaxMarginPerAction)) {
      throw new Error("Margin exceeds delegated session limit");
    }

    const marginAddress = relay.client.getMarginAccountAddress(marketAddress, owner);
    const marginExists = await relay.client
      .getMarginAccount(marginAddress)
      .then(() => true)
      .catch((error) => {
        if (isMissingAccountError(error)) return false;
        throw error;
      });
    if (!marginExists) {
      throw new Error("No collateral deposited. Deposit collateral before opening a position.");
    }

    await ensureOracleFresh(relay, marketAddress, pairLabel);

    const result =
      sessionVersion === "v2"
        ? await relay.client.openPositionWithSessionV2(marketAddress, owner, sessionId, {
            size,
            entryPrice,
            leverage: body.leverage as number,
            direction: body.side,
            margin,
            marginMode: body.marginMode ?? "cross",
          })
        : await relay.client.openPositionWithSession(marketAddress, owner, sessionId, {
            size,
            entryPrice,
            leverage: body.leverage as number,
            direction: body.side,
            margin,
            marginMode: body.marginMode ?? "cross",
          });

    res.status(200).json({
      ok: true,
      txSignature: result.txSignature,
      positionAddress: result.positionAddress.toBase58(),
      relayMode: "session",
    });
  } catch (error: any) {
    const owner = typeof req.body?.owner === "string" ? req.body.owner : null;
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
    const side = req.body?.side === "long" || req.body?.side === "short" ? req.body.side : null;
    const marginMode =
      req.body?.marginMode === "cross" || req.body?.marginMode === "isolated"
        ? req.body.marginMode
        : null;
    console.error("[relay/open:reject]", {
      debugId,
      owner,
      sessionId,
      side,
      marginMode,
      relayer: relay.relayer.publicKey.toBase58(),
      runtime: runtimeSummary,
      error: typeof error?.message === "string" ? error.message : "Relay open failed",
    });
    res.status(400).json({
      ok: false,
      error: typeof error?.message === "string" ? error.message : "Relay open failed",
      debugId,
      runtime: runtimeSummary,
    });
  }
}
