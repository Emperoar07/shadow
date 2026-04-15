import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import { base64ToUint8, buildRelaySessionAuthMessage } from "./relay-session-auth";
import { isMissingAccountError, extractErrorMessage } from "./account-errors";
import { checkRateLimit } from "./rate-limit";
import {
  createRelayRuntimeContext,
  summarizeRelayRuntime,
  RelayRuntimeContext,
} from "./relay-client";

const app = express();
const PORT = process.env.PORT || 3001;
const ALL_MARKETS_SESSION_KEY = "__all_markets__";

app.use(cors());
app.use(express.json());

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseU64Bn(name: string, value?: string): BN {
  if (!value || !/^\d+$/.test(value)) throw new Error(`Invalid ${name}`);
  const bn = new BN(value, 10);
  if (bn.isZero()) throw new Error(`${name} must be > 0`);
  return bn;
}

async function validateSession(
  relay: RelayRuntimeContext,
  body: {
    owner?: string;
    sessionId?: string;
    pairLabel?: string;
    auth?: { action?: string; expiresAt?: number; signature?: string };
  },
  action: "deposit" | "withdraw" | "open",
  amount: BN
) {
  if (!body.owner) throw new Error("Missing owner");
  if (!body.sessionId || !/^\d+$/.test(body.sessionId)) throw new Error("Invalid sessionId");
  if (!body.auth?.signature) throw new Error("Missing auth signature");
  if (!Number.isFinite(body.auth?.expiresAt)) throw new Error("Missing auth expiry");
  if (body.auth?.action && body.auth.action !== action) throw new Error("Authorization action mismatch");

  const owner     = new PublicKey(body.owner);
  const sessionId = new BN(body.sessionId, 10);
  const pairLabel = body.pairLabel ?? "SOL-USD";

  if (!relay.config.marketRegistry[pairLabel]) throw new Error(`Unknown trading pair: ${pairLabel}`);
  const marketAddress = relay.config.marketRegistry[pairLabel]!;

  const nowSeconds  = Math.floor(Date.now() / 1000);
  const authExpiresAt = Math.floor(body.auth.expiresAt as number);

  let sessionVersion: "v1" | "v2" = "v1";
  let sessionExpiry: number;
  let sessionUsedActions: number;
  let sessionMaxActions: number;
  let sessionMaxMarginPerAction: BN;
  let scopeAllMarkets = false;

  try {
    const sessionAddress = relay.client.getTradeSessionV2Address(owner, sessionId);
    const session = await relay.client.getTradeSessionV2(sessionAddress);
    if (!session.owner.equals(owner)) throw new Error("Session owner mismatch");
    if (!session.relayer.equals(relay.relayer.publicKey)) throw new Error("Session relayer mismatch");
    if (session.revoked) throw new Error("Session revoked");
    sessionVersion           = "v2";
    scopeAllMarkets          = true;
    sessionExpiry            = Number(session.expiresAt.toString());
    sessionUsedActions       = session.usedActions;
    sessionMaxActions        = session.maxActions;
    sessionMaxMarginPerAction = session.maxMarginPerAction;
  } catch (v2Error: any) {
    if (!isMissingAccountError(v2Error)) throw v2Error;
    const sessionAddress = relay.client.getTradeSessionAddress(marketAddress, owner, sessionId);
    const session = await relay.client.getTradeSession(sessionAddress);
    if (!session.owner.equals(owner)) throw new Error("Session owner mismatch");
    if (!session.market.equals(marketAddress)) throw new Error("Session market mismatch");
    if (!session.relayer.equals(relay.relayer.publicKey)) throw new Error("Session relayer mismatch");
    if (session.revoked) throw new Error("Session revoked");
    sessionExpiry            = Number(session.expiresAt.toString());
    sessionUsedActions       = session.usedActions;
    sessionMaxActions        = session.maxActions;
    sessionMaxMarginPerAction = session.maxMarginPerAction;
  }

  if (sessionExpiry! <= nowSeconds) throw new Error("Session expired");
  if (authExpiresAt > sessionExpiry!) throw new Error("Authorization expiry exceeds session expiry");
  if (authExpiresAt <= nowSeconds) throw new Error("Session authorization expired");
  if (sessionUsedActions! >= sessionMaxActions!) throw new Error("Session action limit reached");
  if (amount.gt(sessionMaxMarginPerAction!)) throw new Error("Amount exceeds delegated session limit");

  const message = buildRelaySessionAuthMessage({
    owner:     owner.toBase58(),
    market:    scopeAllMarkets ? ALL_MARKETS_SESSION_KEY : marketAddress.toBase58(),
    sessionId: sessionId.toString(),
    action,
    sessionExpiresAt: sessionExpiry!,
    authExpiresAt,
  });
  const verified = ed25519.verify(
    base64ToUint8(body.auth.signature!),
    new TextEncoder().encode(message),
    owner.toBytes()
  );
  if (!verified) throw new Error("Invalid session authorization signature");

  return { owner, sessionId, marketAddress, sessionVersion };
}

// ── Health ────────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ── GET /api/relay/session ────────────────────────────────────────────────────

app.get("/api/relay/session", async (req: Request, res: Response) => {
  let relay: RelayRuntimeContext;
  try {
    relay = await createRelayRuntimeContext();
  } catch (error: any) {
    res.status(503).json({ ok: false, available: false, error: error?.message ?? "Relay unavailable" });
    return;
  }

  const runtimeSummary = summarizeRelayRuntime(relay);
  const ownerRaw    = req.query.owner as string | undefined;
  const pairParam   = req.query.pair  as string | undefined;
  const pairLabel   = pairParam ?? "SOL-USD";
  if (pairParam && !relay.config.marketRegistry[pairParam]) {
    res.status(400).json({ ok: false, available: false, error: `Unknown trading pair: ${pairParam}` });
    return;
  }
  const marketAddress = relay.config.marketRegistry[pairLabel] ?? relay.config.marketAddress;

  if (!ownerRaw) {
    res.json({ ok: true, available: true, relayer: relay.relayer.publicKey.toBase58(), market: marketAddress.toBase58(), runtime: runtimeSummary });
    return;
  }

  try {
    const owner = new PublicKey(ownerRaw);
    const connection = (relay.client as any).provider.connection;
    const [v2Accounts, v1Accounts] = await Promise.all([
      connection.getProgramAccounts(relay.config.programId, {
        filters: [
          { dataSize: 136 },
          { memcmp: { offset: 8,  bytes: owner.toBase58() } },
          { memcmp: { offset: 40, bytes: relay.relayer.publicKey.toBase58() } },
        ],
      }),
      connection.getProgramAccounts(relay.config.programId, {
        filters: [
          { dataSize: 168 },
          { memcmp: { offset: 8,  bytes: owner.toBase58() } },
          { memcmp: { offset: 40, bytes: marketAddress.toBase58() } },
          { memcmp: { offset: 72, bytes: relay.relayer.publicKey.toBase58() } },
        ],
      }),
    ]);

    const now = Math.floor(Date.now() / 1000);
    let latest: any = null;

    for (const acct of v2Accounts) {
      const d = acct.account.data as Buffer;
      if (d.length < 136) continue;
      const expiresAt = Number(d.readBigInt64LE(96));
      if (expiresAt <= now) continue;
      if (d.readUInt8(104) === 1) continue; // revoked
      if (!latest || expiresAt > Number(latest.expiresAt)) {
        latest = {
          sessionVersion: "v2",
          owner: new PublicKey(d.subarray(8, 40)).toBase58(),
          relayer: new PublicKey(d.subarray(40, 72)).toBase58(),
          sessionId: d.readBigUInt64LE(72).toString(),
          maxActions: d.readUInt32LE(80),
          usedActions: d.readUInt32LE(84),
          maxMarginPerAction: d.readBigUInt64LE(88).toString(),
          expiresAt: expiresAt.toString(),
          revoked: false,
          scopeAllMarkets: d.readUInt8(105) === 1,
        };
      }
    }

    if (!latest) {
      for (const acct of v1Accounts) {
        const d = acct.account.data as Buffer;
        if (d.length < 168) continue;
        const expiresAt = Number(d.readBigInt64LE(128));
        if (expiresAt <= now) continue;
        if (d.readUInt8(136) === 1) continue;
        if (!latest || expiresAt > Number(latest.expiresAt)) {
          latest = {
            sessionVersion: "v1",
            owner: new PublicKey(d.subarray(8, 40)).toBase58(),
            relayer: new PublicKey(d.subarray(72, 104)).toBase58(),
            sessionId: d.readBigUInt64LE(104).toString(),
            maxActions: d.readUInt32LE(112),
            usedActions: d.readUInt32LE(116),
            maxMarginPerAction: d.readBigUInt64LE(120).toString(),
            expiresAt: expiresAt.toString(),
            revoked: false,
            scopeAllMarkets: false,
          };
        }
      }
    }

    res.json({ ok: true, available: true, relayer: relay.relayer.publicKey.toBase58(), market: marketAddress.toBase58(), runtime: runtimeSummary, exists: !!latest, session: latest ?? undefined });
  } catch (error: any) {
    const msg = extractErrorMessage(error) || "Session lookup failed";
    res.status(400).json({ ok: false, available: false, error: msg });
  }
});

// ── POST /api/relay/deposit ───────────────────────────────────────────────────

app.post("/api/relay/deposit", async (req: Request, res: Response) => {
  let relay: RelayRuntimeContext;
  try {
    relay = await createRelayRuntimeContext();
  } catch (error: any) {
    res.status(503).json({ ok: false, error: error?.message ?? "Relay unavailable" });
    return;
  }

  try {
    const body = req.body ?? {};
    if (!checkRateLimit(`deposit:${body.owner}`, 5, 60_000)) {
      res.status(429).json({ ok: false, error: "Rate limit exceeded. Try again later." });
      return;
    }
    const amount = parseU64Bn("amountRaw", body.amountRaw);
    const { owner, sessionId, marketAddress, sessionVersion } = await validateSession(relay, body, "deposit", amount);

    const txSignature = sessionVersion === "v2"
      ? await relay.client.depositCollateralWithSessionV2(marketAddress, owner, sessionId, amount)
      : await relay.client.depositCollateralWithSession(marketAddress, owner, sessionId, amount);

    res.json({ ok: true, txSignature, relayMode: "session" });
  } catch (error: any) {
    const msg: string = error?.message ?? "Relay deposit failed";
    const userMessage = isMissingAccountError(error)
      ? "Your trading session has expired or was not created on-chain. Please revoke and start a new session."
      : msg;
    res.status(400).json({ ok: false, error: userMessage });
  }
});

// ── POST /api/relay/withdraw ──────────────────────────────────────────────────

app.post("/api/relay/withdraw", async (req: Request, res: Response) => {
  let relay: RelayRuntimeContext;
  try {
    relay = await createRelayRuntimeContext();
  } catch (error: any) {
    res.status(503).json({ ok: false, error: error?.message ?? "Relay unavailable" });
    return;
  }

  try {
    const body = req.body ?? {};
    if (!checkRateLimit(`withdraw:${body.owner}`, 5, 60_000)) {
      res.status(429).json({ ok: false, error: "Rate limit exceeded. Try again later." });
      return;
    }
    const amount = parseU64Bn("amountRaw", body.amountRaw);
    const { owner, sessionId, marketAddress, sessionVersion } = await validateSession(relay, body, "withdraw", amount);

    const txSignature = sessionVersion === "v2"
      ? await relay.client.withdrawCollateralWithSessionV2(marketAddress, owner, sessionId, amount)
      : await relay.client.withdrawCollateralWithSession(marketAddress, owner, sessionId, amount);

    res.json({ ok: true, txSignature, relayMode: "session" });
  } catch (error: any) {
    const msg: string = error?.message ?? "Relay withdraw failed";
    const userMessage = isMissingAccountError(error)
      ? "Your trading session has expired or was not created on-chain. Please revoke and start a new session."
      : msg;
    res.status(400).json({ ok: false, error: userMessage });
  }
});

// ── POST /api/relay/open ──────────────────────────────────────────────────────

app.post("/api/relay/open", async (req: Request, res: Response) => {
  let relay: RelayRuntimeContext;
  try {
    relay = await createRelayRuntimeContext();
  } catch (error: any) {
    res.status(503).json({ ok: false, error: error?.message ?? "Relay unavailable" });
    return;
  }

  try {
    const body = req.body ?? {};
    if (!checkRateLimit(`open:${body.owner}`, 10, 60_000)) {
      res.status(429).json({ ok: false, error: "Rate limit exceeded. Try again later." });
      return;
    }

    const margin = parseU64Bn("margin", body.marginRaw ?? body.margin);
    const { owner, sessionId, marketAddress, sessionVersion } = await validateSession(relay, body, "open", margin);

    if (sessionVersion !== "v2") throw new Error("openPositionWithSessionV2 requires a v2 session");

    const result = await relay.client.openPositionWithSessionV2(
      marketAddress,
      owner,
      sessionId,
      {
        direction:    body.direction ?? body.side,
        margin:       margin,
        leverage:     Number(body.leverage),
        entryPrice:   parseU64Bn("entryPrice", body.entryPriceRaw ?? body.entryPrice),
        marginMode:   body.marginMode ?? "cross",
        size:         body.sizeRaw ? parseU64Bn("size", body.sizeRaw) : undefined,
      }
    );

    res.json({ ok: true, txSignature: result.txSignature, positionAddress: result.positionAddress.toBase58(), relayMode: "session" });
  } catch (error: any) {
    const msg: string = error?.message ?? "Relay open failed";
    const isSessionMissing = isMissingAccountError(error) || msg.includes("Session");
    const userMessage = isSessionMissing
      ? "Your trading session has expired or was not created on-chain. Please revoke and start a new session."
      : msg;
    res.status(400).json({ ok: false, error: userMessage });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`ShadowPerp relay server running on port ${PORT}`);
});
