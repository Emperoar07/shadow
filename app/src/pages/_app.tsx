import { useMemo } from "react";
import type { AppProps } from "next/app";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { Toaster } from "react-hot-toast";

import "@solana/wallet-adapter-react-ui/styles.css";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  // Use devnet for development
  const endpoint = useMemo(() => clusterApiUrl("devnet"), []);

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "#1a1a25",
                color: "#fff",
                border: "1px solid rgba(139, 92, 246, 0.3)",
              },
            }}
          />
          <Component {...pageProps} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
