import type { NextApiRequest, NextApiResponse } from "next";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import {
  base64ToUint8,
  buildRelaySessionAuthMessage,
} from "../../../lib/relay-session-auth";
import { isMissingAccountError } from "../../../lib/account-errors";
import { createRelayRuntimeContext } from "../../../lib/server/relay-client";
import { checkRateLimit } from "../../../lib/server/rate-limit";

const WITHDRAW_RATE_LIMIT = 5;  // max 5 withdraw requests per owner per minute
const RATE_WINDOW_MS = 60_000;
const ALL_MARKETS_SESSION_KEY = "__all_markets__";

type WithdrawRequestBody = {
  owner?: string;
  sessionId?: string;
  amountRaw?: string;
  pairLabel?: string;
  auth?: {
    action?: "open" | "deposit" | "withdraw";
    expiresAt?: number;
    signature?: string;
  };
};

type WithdrawResponse =
  | {
      ok: true;
      txSignature: string;
      relayMode: "session";
    }
  | {
      ok: false;
      error: string;
    };

function parseU64Bn(name: string, value?: string): BN {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  const bn = new BN(value, 10);
  if (bn.isZero()) throw new Error(`${name} must be > 0`);
  return bn;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WithdrawResponse>
): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  let relay;
  try {
    relay = await createRelayRuntimeContext();
  } catch (error: any) {
    res.status(503).json({
      ok: false,
      error: typeof error?.message === "string" ? error.message : "Relay unavailable",
    });
    return;
  }

  try {
    const body = (req.body || {}) as WithdrawRequestBody;
    if (!body.owner) throw new Error("Missing owner");
    if (!body.sessionId || !/^\d+$/.test(body.sessionId)) throw new Error("Invalid sessionId");

    if (!checkRateLimit(`withdraw:${body.owner}`, WITHDRAW_RATE_LIMIT, RATE_WINDOW_MS)) {
      res.status(429).json({ ok: false, error: "Rate limit exceeded. Try again later." });
      return;
    }

    if (!body.auth?.signature) throw new Error("Missing auth signature");
    if (!Number.isFinite(body.auth?.expiresAt)) throw new Error("Missing auth expiry");
    if (body.auth?.action && body.auth.action !== "withdraw") {
      throw new Error("Authorization action mismatch");
    }

    const owner = new PublicKey(body.owner);
    const sessionId = new BN(body.sessionId, 10);
    const amount = parseU64Bn("amountRaw", body.amountRaw);

    const pairLabel = body.pairLabel ?? "SOL-USD";
    if (!relay.config.marketRegistry[pairLabel]) {
      throw new Error(`Unknown trading pair: ${pairLabel}`);
    }
    const marketAddress = relay.config.marketRegistry[pairLabel];

    const nowSeconds = Math.floor(Date.now() / 1000);
    const authExpiresAt = Math.floor(body.auth.expiresAt as number);

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
    } catch (v2Error: any) {
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
      action: "withdraw",
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
    // max_margin_per_action applies to opens and deposits only, not withdrawals.
    // See ARCHITECTURE.md §Session withdraw exemption.

    const txSignature =
      sessionVersion === "v2"
        ? await relay.client.withdrawCollateralWithSessionV2(marketAddress, owner, sessionId, amount)
        : await relay.client.withdrawCollateralWithSession(marketAddress, owner, sessionId, amount);

    res.status(200).json({
      ok: true,
      txSignature,
      relayMode: "session",
    });
  } catch (error: any) {
    res.status(400).json({
      ok: false,
      error: typeof error?.message === "string" ? error.message : "Relay withdraw failed",
    });
  }
}
