import { useMemo } from "react";
import { type WalletContextState } from "@solana/wallet-adapter-react";
import { useActiveWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { PublicKey } from "@solana/web3.js";
import type { Transaction } from "@solana/web3.js";

export type WalletExecutionMode = "external" | "embedded" | "none";

export type AnchorCompatibleWallet = {
  publicKey: WalletContextState["publicKey"];
  signTransaction: WalletContextState["signTransaction"];
  signAllTransactions: WalletContextState["signAllTransactions"];
  signMessage?: WalletContextState["signMessage"];
};

type SignAllTransactions = NonNullable<WalletContextState["signAllTransactions"]>;

type ConnectedSolanaWalletLike = {
  type: string;
  address: string;
  walletClientType: string;
  signTransaction?: WalletContextState["signTransaction"];
  signMessage?: WalletContextState["signMessage"];
};

function isConnectedSolanaWalletLike(value: unknown): value is ConnectedSolanaWalletLike {
  if (!value || typeof value !== "object") return false;
  const wallet = value as Record<string, unknown>;
  return (
    wallet.type === "solana" &&
    typeof wallet.address === "string"
  );
}

export function useConnectedSolanaWallet(): ConnectedSolanaWalletLike | null {
  const { wallet: activeWallet } = useActiveWallet();
  const { wallets } = useWallets();
  const { wallets: embeddedWallets } = useSolanaWallets();

  return useMemo(() => {
    // External wallet always wins — connecting Phantom while an embedded wallet
    // exists doesn't switch useActiveWallet, so check useWallets() first.
    const connected = wallets.filter(isConnectedSolanaWalletLike);
    const externalWallet = connected.find((wallet) => wallet.walletClientType !== "privy");
    if (externalWallet) return externalWallet;

    // Active wallet from Privy (covers embedded wallet set as active)
    if (isConnectedSolanaWalletLike(activeWallet)) {
      return activeWallet;
    }

    const embeddedWallet = connected.find((wallet) => wallet.walletClientType === "privy");
    if (embeddedWallet) return embeddedWallet;

    const fallbackEmbedded = embeddedWallets.find(
      (wallet) =>
        wallet.walletClientType === "privy" &&
        typeof wallet.address === "string"
    );

    return fallbackEmbedded ?? null;
  }, [activeWallet, wallets, embeddedWallets]);
}

export function useWalletConnectionState() {
  const { ready, authenticated } = usePrivy();
  const activeWallet = useConnectedSolanaWallet();

  return useMemo(() => {
    let publicKey: PublicKey | null = null;
    if (activeWallet?.address) {
      try {
        publicKey = new PublicKey(activeWallet.address);
      } catch {
        publicKey = null;
      }
    }

    return {
      ready,
      authenticated,
      connected: !!publicKey,
      signerReady: !!publicKey && typeof activeWallet?.signTransaction === "function",
      address: publicKey?.toBase58() ?? null,
      publicKey,
      walletClientType: activeWallet?.walletClientType ?? null,
    };
  }, [activeWallet, authenticated, ready]);
}

export function useWalletExecutionMode(): WalletExecutionMode {
  const activeWallet = useConnectedSolanaWallet();

  return useMemo(() => {
    if (!activeWallet) return "none";
    if (activeWallet.walletClientType === "privy") return "embedded";
    return "external";
  }, [activeWallet]);
}

export function useAnchorWalletCompat(): AnchorCompatibleWallet | null {
  const activeWallet = useConnectedSolanaWallet();

  return useMemo(() => {
    if (!activeWallet?.address || !activeWallet.signTransaction) {
      return null;
    }

    let publicKey: PublicKey;
    try {
      publicKey = new PublicKey(activeWallet.address);
    } catch {
      return null;
    }

    const signTransaction =
      activeWallet.signTransaction as NonNullable<WalletContextState["signTransaction"]>;
    const safeSignAll: SignAllTransactions = async (txs) => {
      const out = [];
      for (const tx of txs) {
        out.push((await signTransaction(tx as Transaction)) as typeof tx);
      }
      return out;
    };

    return {
      publicKey,
      signTransaction,
      signAllTransactions: safeSignAll,
      signMessage:
        typeof activeWallet.signMessage === "function"
          ? (activeWallet.signMessage as NonNullable<WalletContextState["signMessage"]>)
          : undefined,
    };
  }, [activeWallet]);
}
