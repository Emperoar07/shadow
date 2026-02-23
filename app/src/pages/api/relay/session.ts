import type { NextApiRequest, NextApiResponse } from "next";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { createRelayRuntimeContext } from "../../../lib/server/relay-client";

type SessionResponse =
  | {
      ok: true;
      available: true;
      relayer: string;
      market: string;
      rpcUrl: string;
      exists?: boolean;
      session?: {
        owner: string;
        relayer: string;
        sessionId: string;
        maxActions: number;
        usedActions: number;
        maxMarginPerAction: string;
        expiresAt: string;
        revoked: boolean;
      };
    }
  | {
      ok: false;
      available: false;
      error: string;
    };

function first(input: string | string[] | undefined): string | undefined {
  if (Array.isArray(input)) return input[0];
  return input;
}

function parseSessionId(value?: string): BN {
  if (!value) throw new Error("Missing sessionId");
  if (!/^\d+$/.test(value)) throw new Error("Invalid sessionId");
  return new BN(value, 10);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SessionResponse>
): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({
      ok: false,
      available: false,
      error: "Method not allowed",
    });
    return;
  }

  let relay;
  try {
    relay = createRelayRuntimeContext();
  } catch (error: any) {
    res.status(503).json({
      ok: false,
      available: false,
      error: typeof error?.message === "string" ? error.message : "Relay unavailable",
    });
    return;
  }

  const ownerRaw = first(req.query.owner);
  const sessionIdRaw = first(req.query.sessionId);

  if (!ownerRaw || !sessionIdRaw) {
    res.status(200).json({
      ok: true,
      available: true,
      relayer: relay.relayer.publicKey.toBase58(),
      market: relay.config.marketAddress.toBase58(),
      rpcUrl: relay.rpcUrl,
    });
    return;
  }

  try {
    const owner = new PublicKey(ownerRaw);
    const sessionId = parseSessionId(sessionIdRaw);
    const sessionAddress = relay.client.getTradeSessionAddress(
      relay.config.marketAddress,
      owner,
      sessionId
    );
    const session = await relay.client.getTradeSession(sessionAddress);

    res.status(200).json({
      ok: true,
      available: true,
      relayer: relay.relayer.publicKey.toBase58(),
      market: relay.config.marketAddress.toBase58(),
      rpcUrl: relay.rpcUrl,
      exists: true,
      session: {
        owner: session.owner.toBase58(),
        relayer: session.relayer.toBase58(),
        sessionId: session.sessionId.toString(),
        maxActions: session.maxActions,
        usedActions: session.usedActions,
        maxMarginPerAction: session.maxMarginPerAction.toString(),
        expiresAt: session.expiresAt.toString(),
        revoked: session.revoked,
      },
    });
  } catch (error: any) {
    const message = typeof error?.message === "string" ? error.message : "Session lookup failed";
    if (message.includes("Account does not exist")) {
      res.status(200).json({
        ok: true,
        available: true,
        relayer: relay.relayer.publicKey.toBase58(),
        market: relay.config.marketAddress.toBase58(),
        rpcUrl: relay.rpcUrl,
        exists: false,
      });
      return;
    }
    res.status(400).json({
      ok: false,
      available: false,
      error: message,
    });
  }
}
