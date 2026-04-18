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
  // Privy wallets have type="wallet" + chainType="solana"; external connectors use type="solana"
  const isSolana =
    wallet.type === "solana" ||
    (wallet.type === "wallet" && wallet.chainType === "solana");
  return isSolana && typeof wallet.address === "string";
}

export function useConnectedSolanaWallet(): ConnectedSolanaWalletLike | null {
  const { wallet: activeWallet } = useActiveWallet();
  const { wallets } = useWallets();
  const { wallets: embeddedWallets } = useSolanaWallets();

  return useMemo(() => {
    // useSolanaWallets() is the authoritative source for signTransaction — always
    // resolve wallets through it by address so signing methods are available.
    const solanaByAddress = new Map(embeddedWallets.map((w) => [w.address, w]));

    // External wallet always wins — check useWallets() for connection state,
    // then look up the rich version (with signTransaction) from useSolanaWallets().
    const connected = wallets.filter(isConnectedSolanaWalletLike);
    const externalDetected = connected.find((w) => w.walletClientType !== "privy");
    if (externalDetected) {
      return solanaByAddress.get(externalDetected.address) ?? externalDetected;
    }

    // Active wallet from Privy (covers embedded wallet set as active)
    if (isConnectedSolanaWalletLike(activeWallet)) {
      return solanaByAddress.get(activeWallet.address) ?? activeWallet;
    }

    const embeddedDetected = connected.find((w) => w.walletClientType === "privy");
    if (embeddedDetected) {
      return solanaByAddress.get(embeddedDetected.address) ?? embeddedDetected;
    }

    // Pure useSolanaWallets() fallbacks
    const fallbackExternal = embeddedWallets.find(
      (w) => w.walletClientType !== "privy" && typeof w.address === "string"
    );
    if (fallbackExternal) return fallbackExternal;

    return embeddedWallets.find(
      (w) => w.walletClientType === "privy" && typeof w.address === "string"
    ) ?? null;
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
