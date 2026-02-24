import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        {/* Apply saved theme before React hydrates to prevent theme flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('shadow-theme');if(t!=='dark')document.documentElement.classList.add('light');})()`
          }}
        />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
