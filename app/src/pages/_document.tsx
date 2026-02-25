import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head />
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
