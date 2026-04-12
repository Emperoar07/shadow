import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="alternate icon" href="/favicon.ico" />
        {/* Preload TradingView so it's in the browser cache before the chart mounts */}
        <link rel="preload" href="https://s3.tradingview.com/tv.js" as="script" />
      </Head>
      <body>
        {/* Apply saved theme before React hydrates to prevent theme flash.
            Loaded as a static file to avoid dangerouslySetInnerHTML. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-init.js" />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
