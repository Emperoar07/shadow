import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const CANONICAL_HOST =
  process.env.NEXT_PUBLIC_CANONICAL_HOST?.trim().toLowerCase() ||
  "www.shadowperpdex.xyz";

function shouldSkipHostRedirect(hostname: string): boolean {
  return (
    !hostname ||
    hostname === CANONICAL_HOST ||
    hostname === "localhost" ||
    hostname.startsWith("localhost:") ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("127.0.0.1:") ||
    hostname.endsWith(".vercel.app")
  );
}

export function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase() ?? "";
  if (shouldSkipHostRedirect(host)) {
    return NextResponse.next();
  }

  const apexCandidate = CANONICAL_HOST.startsWith("www.")
    ? CANONICAL_HOST.slice(4)
    : CANONICAL_HOST;

  if (host !== apexCandidate) {
    return NextResponse.next();
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.host = CANONICAL_HOST;
  redirectUrl.protocol = "https:";
  return NextResponse.redirect(redirectUrl, 308);
}

export const config = {
  matcher: "/:path*",
};
