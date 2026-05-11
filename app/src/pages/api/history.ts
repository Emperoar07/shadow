import type { NextApiRequest, NextApiResponse } from "next";
import { checkRateLimit } from "../../lib/server/rate-limit";
import { getHistorySnapshot } from "../../lib/server/history";
import { requirePrivySolanaWallet } from "../../lib/server/privy-auth";
import { getRequestIp } from "../../lib/server/request-ip";

type HistoryResponse =
  | {
      ok: true;
      activity: Awaited<ReturnType<typeof getHistorySnapshot>>["activity"];
      historyPositions: Awaited<ReturnType<typeof getHistorySnapshot>>["historyPositions"];
      historyPositionsSource: Awaited<ReturnType<typeof getHistorySnapshot>>["historyPositionsSource"];
      historyPositionsNotice?: Awaited<ReturnType<typeof getHistorySnapshot>>["historyPositionsNotice"];
      nextBefore: string | null;
      hasMore: boolean;
      fetchedAt: number;
    }
  | {
      ok: false;
      error: string;
    };

const RATE_LIMIT = 30;
const IP_RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HistoryResponse>
): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const walletRaw = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
  if (!walletRaw) {
    res.status(400).json({ ok: false, error: "Missing wallet" });
    return;
  }
  let wallet: string;
  try {
    const { PublicKey } = await import("@solana/web3.js");
    new PublicKey(walletRaw);
    wallet = walletRaw;
  } catch {
    res.status(400).json({ ok: false, error: "Invalid wallet address" });
    return;
  }

  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
  const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
  const before = typeof req.query.before === "string" ? req.query.before : undefined;
  const includePositions = req.query.includePositions === "true";

  let userId: string;
  try {
    ({ userId } = await requirePrivySolanaWallet(req, wallet));
  } catch (error) {
    res.status(401).json({
      ok: false,
      error: error instanceof Error ? error.message : "Authentication required.",
    });
    return;
  }

  if (
    !checkRateLimit(`history:user:${userId}`, RATE_LIMIT, RATE_WINDOW_MS) ||
    !checkRateLimit(`history:ip:${getRequestIp(req)}`, IP_RATE_LIMIT, RATE_WINDOW_MS)
  ) {
    res.status(429).json({ ok: false, error: "Rate limit exceeded. Try again later." });
    return;
  }

  try {
    const snapshot = await getHistorySnapshot(wallet, {
      limit,
      before,
      includePositions,
      userId,
    });
    res.status(200).json({
      ok: true,
      activity: snapshot.activity,
      historyPositions: snapshot.historyPositions,
      historyPositionsSource: snapshot.historyPositionsSource,
      historyPositionsNotice: snapshot.historyPositionsNotice,
      nextBefore: snapshot.nextBefore,
      hasMore: snapshot.hasMore,
      fetchedAt: snapshot.fetchedAt,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: typeof error?.message === "string" ? error.message : "Failed to load history",
    });
  }
}
