import { useMemo } from "react";
import { type WalletContextState } from "@solana/wallet-adapter-react";
import { useActiveWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { PublicKey } from "@solana/web3.js";
import type { Transaction, VersionedTransaction } from "@solana/web3.js";

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
  const isSolana =
    wallet.type === "solana" ||
    (wallet.type === "wallet" && wallet.chainType === "solana");
  const address = wallet.address;
  const hasValidAddress = typeof address === "string" && !address.startsWith("0x");
  return isSolana && hasValidAddress;
}

export function useConnectedSolanaWallet(): ConnectedSolanaWalletLike | null {
  const { ready, authenticated, user } = usePrivy();
  const { wallet: activeWallet } = useActiveWallet();
  const { ready: walletsReady, wallets } = useWallets();
  const { ready: solanaWalletsReady, wallets: solanaWallets } = useSolanaWallets();

  return useMemo(() => {
    if (!ready || !walletsReady || !solanaWalletsReady || !authenticated) return null;

    const solanaByAddress = new Map(solanaWallets.map((w) => [w.address, w]));
    const linkedAccounts = user?.linkedAccounts ?? [];
    const userOwnsEmbeddedSolana = linkedAccounts.some((account: any) => {
      const type = account?.type ?? account?.linkedAccountType;
      return type === "wallet" && account?.chainType === "solana" && account?.walletClientType === "privy";
    });
    const userLinkedExternalSolana = linkedAccounts.some((account: any) => {
      const type = account?.type ?? account?.linkedAccountType;
      return type === "wallet" && account?.chainType === "solana" && account?.walletClientType !== "privy";
    });
    const isEmbeddedLoginUser = linkedAccounts.some((account: any) => {
      const type = account?.type ?? account?.linkedAccountType;
      return (
        type === "email" ||
        type === "phone" ||
        type === "google_oauth" ||
        type === "twitter_oauth" ||
        type === "discord_oauth" ||
        type === "github_oauth" ||
        type === "linkedin_oauth" ||
        type === "tiktok_oauth" ||
        type === "farcaster"
      );
    });

    // Privy's active wallet is the source of truth for the wallet selected in
    // the auth modal. If an extension auto-hydrates during an email session,
    // prefer the user's embedded wallet unless that external wallet is actually
    // linked to the authenticated Privy user.
    if (isConnectedSolanaWalletLike(activeWallet)) {
      if (
        activeWallet.walletClientType !== "privy" &&
        isEmbeddedLoginUser &&
        userOwnsEmbeddedSolana &&
        !userLinkedExternalSolana
      ) {
        const embedded = solanaWallets.find(
          (w) => w.walletClientType === "privy" && typeof w.address === "string"
        );
        if (embedded) return embedded;
      }
      if (activeWallet.walletClientType !== "privy" && isEmbeddedLoginUser && !userLinkedExternalSolana) {
        return null;
      }
      return solanaByAddress.get(activeWallet.address) ?? activeWallet;
    }

    const connected = wallets.filter(isConnectedSolanaWalletLike);

    if (userOwnsEmbeddedSolana) {
      const embeddedDetected = connected.find((w) => w.walletClientType === "privy");
      if (embeddedDetected) return solanaByAddress.get(embeddedDetected.address) ?? embeddedDetected;
      const embeddedFallback = solanaWallets.find(
        (w) => w.walletClientType === "privy" && typeof w.address === "string"
      );
      if (embeddedFallback) return embeddedFallback;
      return null;
    }

    if (isEmbeddedLoginUser && !userLinkedExternalSolana) return null;

    const externalDetected = connected.find((w) => w.walletClientType !== "privy");
    if (externalDetected) {
      return solanaByAddress.get(externalDetected.address) ?? externalDetected;
    }

    const embeddedDetected = connected.find((w) => w.walletClientType === "privy");
    if (embeddedDetected) {
      return solanaByAddress.get(embeddedDetected.address) ?? embeddedDetected;
    }

    const embeddedFallback = solanaWallets.find(
      (w) => w.walletClientType === "privy" && typeof w.address === "string"
    );
    if (embeddedFallback) return embeddedFallback;

    return solanaWallets.find(
      (w) => w.walletClientType !== "privy" && typeof w.address === "string"
    ) ?? null;
  }, [ready, walletsReady, solanaWalletsReady, authenticated, user, activeWallet, wallets, solanaWallets]);
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

    const signTransaction: NonNullable<WalletContextState["signTransaction"]> =
      async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
        const signed = await activeWallet.signTransaction!.call(activeWallet, tx);
        return signed as T;
      };
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
          ? ((message) =>
              activeWallet.signMessage!.call(
                activeWallet,
                message
              )) as NonNullable<WalletContextState["signMessage"]>
          : undefined,
    };
  }, [activeWallet]);
}
