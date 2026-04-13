import { useEffect, useMemo } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";

/**
 * Syncs the Privy embedded Solana wallet into the wallet-adapter context.
 * Call this once inside a component that is a child of both PrivyProvider
 * and WalletProvider.
 */
export function usePrivyWalletSync() {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { select, connect, publicKey } = useWallet();

  const privySolanaWallet = useMemo(
    () => wallets.find((w) => w.walletClientType === "privy" && (w as any).chainType === "solana"),
    [wallets]
  );

  useEffect(() => {
    if (!ready || !authenticated || !privySolanaWallet) return;
    if (publicKey) return; // already connected
    // Select the Privy wallet adapter by name so wallet-adapter picks it up
    select("Privy" as WalletName);
  }, [ready, authenticated, privySolanaWallet, publicKey, select]);
}
