import type { NextApiRequest, NextApiResponse } from "next";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import {
  base64ToUint8,
  buildRelaySessionAuthMessage,
} from "../../../lib/relay-session-auth";
import { createRelayRuntimeContext } from "../../../lib/server/relay-client";
import { checkRateLimit } from "../../../lib/server/rate-limit";

const DEPOSIT_RATE_LIMIT = 5;  // max 5 deposit requests per owner per minute
const RATE_WINDOW_MS = 60_000;

type DepositRequestBody = {
  owner?: string;
  sessionId?: string;
  amountRaw?: string;
  auth?: {
    expiresAt?: number;
    signature?: string;
  };
};

type DepositResponse =
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
  res: NextApiResponse<DepositResponse>
): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  let relay;
  try {
    relay = createRelayRuntimeContext();
  } catch (error: any) {
    res.status(503).json({
      ok: false,
      error: typeof error?.message === "string" ? error.message : "Relay unavailable",
    });
    return;
  }

  try {
    const body = (req.body || {}) as DepositRequestBody;
    if (!body.owner) throw new Error("Missing owner");
    if (!body.sessionId || !/^\d+$/.test(body.sessionId)) throw new Error("Invalid sessionId");

    if (!checkRateLimit(`deposit:${body.owner}`, DEPOSIT_RATE_LIMIT, RATE_WINDOW_MS)) {
      res.status(429).json({ ok: false, error: "Rate limit exceeded. Try again later." });
      return;
    }

    if (!body.auth?.signature) throw new Error("Missing auth signature");
    if (!Number.isFinite(body.auth?.expiresAt)) throw new Error("Missing auth expiry");

    const owner = new PublicKey(body.owner);
    const sessionId = new BN(body.sessionId, 10);
    const amount = parseU64Bn("amountRaw", body.amountRaw);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const authExpiresAt = Math.floor(body.auth.expiresAt as number);

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
    const sessionExpiry = Number(session.expiresAt.toString());
    if (sessionExpiry <= nowSeconds) {
      throw new Error("Session expired");
    }
    if (authExpiresAt > sessionExpiry) {
      throw new Error("Authorization expiry exceeds session expiry");
    }

    const message = buildRelaySessionAuthMessage({
      owner: owner.toBase58(),
      market: relay.config.marketAddress.toBase58(),
      sessionId: sessionId.toString(),
      expiresAt: sessionExpiry,
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
    if (amount.gt(session.maxMarginPerAction)) {
      throw new Error("Deposit exceeds delegated session limit");
    }

    const txSignature = await relay.client.depositCollateralWithSession(
      relay.config.marketAddress,
      owner,
      sessionId,
      amount
    );

    res.status(200).json({
      ok: true,
      txSignature,
      relayMode: "session",
    });
  } catch (error: any) {
    res.status(400).json({
      ok: false,
      error: typeof error?.message === "string" ? error.message : "Relay deposit failed",
    });
  }
}
