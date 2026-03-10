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

type DecodedTradeSession = {
  owner: string;
  market: string;
  relayer: string;
  sessionId: string;
  maxActions: number;
  usedActions: number;
  maxMarginPerAction: string;
  expiresAt: string;
  revoked: boolean;
};

function readU32LE(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

function readU64LE(buffer: Buffer, offset: number): bigint {
  return buffer.readBigUInt64LE(offset);
}

function readI64LE(buffer: Buffer, offset: number): bigint {
  return buffer.readBigInt64LE(offset);
}

function decodeTradeSessionAccount(data: Buffer): DecodedTradeSession | null {
  // 8 discriminator + fields defined in programs/shadowperp/src/state/trade_session.rs
  if (data.length < 168) return null;

  const owner = new PublicKey(data.subarray(8, 40)).toBase58();
  const market = new PublicKey(data.subarray(40, 72)).toBase58();
  const relayer = new PublicKey(data.subarray(72, 104)).toBase58();
  const sessionId = readU64LE(data, 104).toString();
  const maxActions = readU32LE(data, 112);
  const usedActions = readU32LE(data, 116);
  const maxMarginPerAction = readU64LE(data, 120).toString();
  const expiresAt = readI64LE(data, 128).toString();
  const revoked = data.readUInt8(136) === 1;

  return {
    owner,
    market,
    relayer,
    sessionId,
    maxActions,
    usedActions,
    maxMarginPerAction,
    expiresAt,
    revoked,
  };
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
    relay = await createRelayRuntimeContext();
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

  if (!ownerRaw && !sessionIdRaw) {
    res.status(200).json({
      ok: true,
      available: true,
      relayer: relay.relayer.publicKey.toBase58(),
      market: relay.config.marketAddress.toBase58(),
    });
    return;
  }

  if (!ownerRaw && sessionIdRaw) {
    res.status(400).json({
      ok: false,
      available: false,
      error: "owner is required when sessionId is provided",
    });
    return;
  }

  if (ownerRaw && !sessionIdRaw) {
    try {
      const owner = new PublicKey(ownerRaw);
      const connection = (relay.client as any).provider.connection;
      const accounts = await connection.getProgramAccounts(relay.config.programId, {
        filters: [
          { dataSize: 168 },
          { memcmp: { offset: 8, bytes: owner.toBase58() } },
          { memcmp: { offset: 40, bytes: relay.config.marketAddress.toBase58() } },
          { memcmp: { offset: 72, bytes: relay.relayer.publicKey.toBase58() } },
        ],
      });

      const now = Math.floor(Date.now() / 1000);
      let latest: DecodedTradeSession | null = null;

      for (const account of accounts) {
        const decoded = decodeTradeSessionAccount(account.account.data);
        if (!decoded) continue;
        const expiresAt = Number(decoded.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
        if (decoded.revoked) continue;
        if (decoded.usedActions >= decoded.maxActions) continue;

        if (!latest) {
          latest = decoded;
          continue;
        }

        const latestExpires = Number(latest.expiresAt);
        const latestSessionId = Number(latest.sessionId);
        const currentSessionId = Number(decoded.sessionId);
        if (expiresAt > latestExpires) {
          latest = decoded;
          continue;
        }
        if (expiresAt === latestExpires && currentSessionId > latestSessionId) {
          latest = decoded;
        }
      }

      if (!latest) {
        res.status(200).json({
          ok: true,
          available: true,
          relayer: relay.relayer.publicKey.toBase58(),
          market: relay.config.marketAddress.toBase58(),
          exists: false,
        });
        return;
      }

      res.status(200).json({
        ok: true,
        available: true,
        relayer: relay.relayer.publicKey.toBase58(),
        market: relay.config.marketAddress.toBase58(),
        exists: true,
        session: latest,
      });
      return;
    } catch (error: any) {
      const message =
        typeof error?.message === "string" ? error.message : "Session lookup failed";
      res.status(400).json({
        ok: false,
        available: false,
        error: message,
      });
      return;
    }
  }

  try {
    const owner = new PublicKey(ownerRaw!);
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
