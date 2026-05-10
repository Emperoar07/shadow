/** @type {import('next').NextConfig} */
const path = require("path");

const privyApiOrigin = process.env.NEXT_PUBLIC_PRIVY_API_URL?.trim();
const canonicalHost = process.env.NEXT_PUBLIC_CANONICAL_HOST?.trim().toLowerCase();
const privyFrameSourceSet = new Set([
  "blob:",
  "https://s.tradingview.com",
  "https://auth.privy.io",
  "https://*.privy.io",
  // Privy custom wallet proxy domains used by hosted Shadow deployments.
  "https://privy.shadowperpdex.xyz",
  "https://privy.www.shadowperpdex.xyz",
]);

if (canonicalHost) {
  privyFrameSourceSet.add(`https://privy.${canonicalHost}`);
  if (canonicalHost.startsWith("www.")) {
    privyFrameSourceSet.add(`https://privy.${canonicalHost.slice(4)}`);
  }
}

if (privyApiOrigin) {
  privyFrameSourceSet.add(privyApiOrigin);
}

const privyFrameSources = Array.from(privyFrameSourceSet);

const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent clickjacking — allow same-origin framing for Privy wallet proxy
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Prevent MIME-type sniffing
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Limit referrer information sent to third parties
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Restrict iframes to TradingView and Privy embedded wallet
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://s.tradingview.com https://s3.tradingview.com https://*.privy.io",
              "style-src 'self' 'unsafe-inline' https://s.tradingview.com https://s3.tradingview.com",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https: wss:",
              "worker-src 'self' blob:",
              `frame-src ${privyFrameSources.join(" ")}`,
              "frame-ancestors 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          // Disable access to sensitive browser features
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
    };
    return config;
  },
};

module.exports = nextConfig;
