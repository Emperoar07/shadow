import type { NextApiRequest, NextApiResponse } from "next";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  createRelayRuntimeContext,
  RelayRuntimeSummary,
  summarizeRelayRuntime,
} from "../../../lib/server/relay-client";
import { extractErrorMessage, isMissingAccountError } from "../../../lib/account-errors";

type SessionResponse =
  | {
      ok: true;
      available: true;
      relayer: string;
      market: string;
      runtime?: RelayRuntimeSummary;
      exists?: boolean;
      session?: {
        sessionVersion: "v1" | "v2";
        scopeAllMarkets: boolean;
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
  sessionVersion: "v1" | "v2";
  scopeAllMarkets: boolean;
  owner: string;
  market: string | null;
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
    sessionVersion: "v1",
    scopeAllMarkets: false,
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

function decodeTradeSessionV2Account(data: Buffer): DecodedTradeSession | null {
  if (data.length < 136) return null;

  const owner = new PublicKey(data.subarray(8, 40)).toBase58();
  const relayer = new PublicKey(data.subarray(40, 72)).toBase58();
  const sessionId = readU64LE(data, 72).toString();
  const maxActions = readU32LE(data, 80);
  const usedActions = readU32LE(data, 84);
  const maxMarginPerAction = readU64LE(data, 88).toString();
  const expiresAt = readI64LE(data, 96).toString();
  const revoked = data.readUInt8(104) === 1;
  const scopeAllMarkets = data.readUInt8(105) === 1;

  return {
    sessionVersion: "v2",
    scopeAllMarkets,
    owner,
    market: null,
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

  const runtimeSummary = summarizeRelayRuntime(relay);

  const ownerRaw = first(req.query.owner);
  const sessionIdRaw = first(req.query.sessionId);
  const pairParam = first(req.query.pair);
  if (pairParam && !relay.config.marketRegistry[pairParam]) {
    throw new Error(`Unknown trading pair: ${pairParam}`);
  }
  const pairLabel = pairParam ?? "SOL-USD";
  const marketAddress = relay.config.marketRegistry[pairLabel] ?? relay.config.marketAddress;

  if (!ownerRaw && !sessionIdRaw) {
    res.status(200).json({
      ok: true,
      available: true,
      relayer: relay.relayer.publicKey.toBase58(),
      market: marketAddress.toBase58(),
      runtime: runtimeSummary,
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
      const [v2Accounts, v1Accounts] = await Promise.all([
        connection.getProgramAccounts(relay.config.programId, {
          filters: [
            { dataSize: 136 },
            { memcmp: { offset: 8, bytes: owner.toBase58() } },
            { memcmp: { offset: 40, bytes: relay.relayer.publicKey.toBase58() } },
          ],
        }),
        connection.getProgramAccounts(relay.config.programId, {
          filters: [
            { dataSize: 168 },
            { memcmp: { offset: 8, bytes: owner.toBase58() } },
            { memcmp: { offset: 40, bytes: marketAddress.toBase58() } },
            { memcmp: { offset: 72, bytes: relay.relayer.publicKey.toBase58() } },
          ],
        }),
      ]);

      const now = Math.floor(Date.now() / 1000);
      let latestV2: DecodedTradeSession | null = null;
      let latestV1: DecodedTradeSession | null = null;

      for (const account of v2Accounts) {
        const decoded = decodeTradeSessionV2Account(account.account.data);
        if (!decoded) continue;
        const expiresAt = Number(decoded.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
        if (decoded.revoked) continue;
        if (decoded.usedActions >= decoded.maxActions) continue;

        if (!latestV2) {
          latestV2 = decoded;
          continue;
        }

        const latestExpires = Number(latestV2.expiresAt);
        const latestSessionId = Number(latestV2.sessionId);
        const currentSessionId = Number(decoded.sessionId);
        if (expiresAt > latestExpires) {
          latestV2 = decoded;
          continue;
        }
        if (expiresAt === latestExpires && currentSessionId > latestSessionId) {
          latestV2 = decoded;
        }
      }

      for (const account of v1Accounts) {
        const decoded = decodeTradeSessionAccount(account.account.data);
        if (!decoded) continue;
        const expiresAt = Number(decoded.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
        if (decoded.revoked) continue;
        if (decoded.usedActions >= decoded.maxActions) continue;

        if (!latestV1) {
          latestV1 = decoded;
          continue;
        }

        const latestExpires = Number(latestV1.expiresAt);
        const latestSessionId = Number(latestV1.sessionId);
        const currentSessionId = Number(decoded.sessionId);
        if (expiresAt > latestExpires) {
          latestV1 = decoded;
          continue;
        }
        if (expiresAt === latestExpires && currentSessionId > latestSessionId) {
          latestV1 = decoded;
        }
      }

      const latest = latestV2 ?? latestV1;

      if (!latest) {
        res.status(200).json({
          ok: true,
          available: true,
          relayer: relay.relayer.publicKey.toBase58(),
          market: marketAddress.toBase58(),
          runtime: runtimeSummary,
          exists: false,
        });
        return;
      }

      res.status(200).json({
        ok: true,
        available: true,
        relayer: relay.relayer.publicKey.toBase58(),
        market: marketAddress.toBase58(),
        runtime: runtimeSummary,
        exists: true,
        session: latest,
      });
      return;
    } catch (error: any) {
      const message =
        typeof error?.message === "string" ? error.message : "Session lookup failed";
      if (message.includes("getProgramAccounts is not available")) {
        res.status(503).json({
          ok: false,
          available: false,
          error:
            "Relay session lookup is temporarily degraded on this RPC: getProgramAccounts is unavailable.",
        });
        return;
      }
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
    try {
      const sessionAddress = relay.client.getTradeSessionV2Address(owner, sessionId);
      const session = await relay.client.getTradeSessionV2(sessionAddress);

      res.status(200).json({
        ok: true,
        available: true,
        relayer: relay.relayer.publicKey.toBase58(),
        market: marketAddress.toBase58(),
        runtime: runtimeSummary,
        exists: true,
        session: {
          sessionVersion: "v2",
          scopeAllMarkets: Boolean((session as any).scopeAllMarkets ?? true),
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
      return;
    } catch (v2Error: any) {
      if (!isMissingAccountError(v2Error)) {
        throw v2Error;
      }
    }

    const sessionAddress = relay.client.getTradeSessionAddress(marketAddress, owner, sessionId);
    const session = await relay.client.getTradeSession(sessionAddress);

    res.status(200).json({
      ok: true,
      available: true,
      relayer: relay.relayer.publicKey.toBase58(),
      market: marketAddress.toBase58(),
      runtime: runtimeSummary,
      exists: true,
      session: {
        sessionVersion: "v1",
        scopeAllMarkets: false,
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
    const message = extractErrorMessage(error) || "Session lookup failed";
    if (isMissingAccountError(error)) {
      res.status(200).json({
        ok: true,
        available: true,
        relayer: relay.relayer.publicKey.toBase58(),
        market: marketAddress.toBase58(),
        runtime: runtimeSummary,
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
