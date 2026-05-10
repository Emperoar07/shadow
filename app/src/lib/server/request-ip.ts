import type { NextApiRequest } from "next";

// Trusts x-forwarded-for as set by Vercel's edge proxy. Not safe on platforms
// without a trusted proxy chain.
export function getRequestIp(req: NextApiRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
}
