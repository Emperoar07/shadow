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
import { checkRateLimit } from "../../../lib/server/rate-limit";

const OPEN_RATE_LIMIT = 10;   // max 10 open requests per owner per minute
const RATE_WINDOW_MS = 60_000;
const ORACLE_MAX_AGE_SECONDS = 250; // refresh if older than this (contract requires < 300)

/** Fetch SOL price from multiple sources; return median. */
async function fetchSolPrice(): Promise<number> {
  const sources = await Promise.allSettled([
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd")
      .then((r) => r.json())
      .then((d: any) => d?.solana?.usd as number),
    fetch("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT")
      .then((r) => r.json())
      .then((d: any) => parseFloat(d?.price)),
  ]);
  const prices = sources
    .filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled" && r.value > 0)
    .map((r) => r.value);
  if (!prices.length) throw new Error("No live price sources available");
  prices.sort((a, b) => a - b);
  return prices[Math.floor(prices.length / 2)];
}

/** Refresh oracle if stale. Returns silently on failure — the open tx will produce a clearer error. */
async function ensureOracleFresh(relay: RelayRuntimeContext): Promise<void> {
  try {
    const market = await relay.client.getMarket(relay.config.marketAddress);
    const lastUpdate = Number(market.lastPriceUpdate?.toString?.() ?? "0");
    const age = Math.floor(Date.now() / 1000) - lastUpdate;
    if (age < ORACLE_MAX_AGE_SECONDS) return; // still fresh

    const price = await fetchSolPrice();
    const priceMicro = new BN(Math.round(price * 1_000_000));
    await relay.client.updateOraclePrice(
      relay.config.marketAddress,
      relay.relayer.publicKey,
      priceMicro
    );
  } catch {
    // Non-fatal: if the oracle is already fresh or the relayer isn't the price feeder,
    // the open tx will either succeed or fail with StalePrice for the user to see.
  }
}

type OpenRequestBody = {
  owner?: string;
  sessionId?: string;
  side?: "long" | "short";
  marginMode?: "cross" | "isolated";
  leverage?: number;
  sizeRaw?: string;
  entryPriceRaw?: string;
  marginRaw?: string;
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
      error: typeof error?.message === "string" ? error.message : String(error),
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

    const sessionAddress = relay.client.getTradeSessionAddress(
      relay.config.marketAddress,
      owner,
      sessionId
    );
    const session = await relay.client.getTradeSession(sessionAddress);
    if (!session.owner.equals(owner)) {
      throw new Error("Session owner mismatch");
    }
    if (!session.market.equals(relay.config.marketAddress)) {
      throw new Error("Session market mismatch");
    }
    if (!session.relayer.equals(relay.relayer.publicKey)) {
      throw new Error("Session relayer mismatch");
    }
    if (session.revoked) {
      throw new Error("Session revoked");
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const sessionExpiry = Number(session.expiresAt.toString());
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
      market: relay.config.marketAddress.toBase58(),
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
    if (session.usedActions >= session.maxActions) {
      throw new Error("Session action limit reached");
    }
    if (margin.gt(session.maxMarginPerAction)) {
      throw new Error("Margin exceeds delegated session limit");
    }

    // Verify margin account exists — it is created by the first deposit, not by open_position
    const marginAddress = relay.client.getMarginAccountAddress(relay.config.marketAddress, owner);
    const marginExists = await relay.client.getMarginAccount(marginAddress).then(() => true).catch(() => false);
    if (!marginExists) {
      throw new Error("No collateral deposited. Deposit collateral before opening a position.");
    }

    // Auto-refresh oracle price if stale (contract requires < 300s freshness)
    await ensureOracleFresh(relay);

    const result = await relay.client.openPositionWithSession(
      relay.config.marketAddress,
      owner,
      sessionId,
      {
        size,
        entryPrice,
        leverage: body.leverage as number,
        direction: body.side,
        margin,
        marginMode: body.marginMode ?? "cross",
      }
    );

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
