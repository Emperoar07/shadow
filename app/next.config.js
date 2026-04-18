/** @type {import('next').NextConfig} */
const path = require("path");

const privyApiOrigin = process.env.NEXT_PUBLIC_PRIVY_API_URL?.trim();
const privyFrameSources = [
  "blob:",
  "https://s.tradingview.com",
  "https://auth.privy.io",
  "https://*.privy.io",
];

if (privyApiOrigin) {
  privyFrameSources.push(privyApiOrigin);
}

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
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://s.tradingview.com https://s3.tradingview.com https://*.privy.io",
              "style-src 'self' 'unsafe-inline' https://s.tradingview.com https://s3.tradingview.com",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https: wss:",
              "worker-src 'self' blob:",
              `frame-src ${privyFrameSources.join(" ")}`,
              "frame-ancestors 'self'",
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
