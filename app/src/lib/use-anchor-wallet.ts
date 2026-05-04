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
  // Privy wallets have type="wallet" + chainType="solana"; external connectors use type="solana"
  const isSolana =
    wallet.type === "solana" ||
    (wallet.type === "wallet" && wallet.chainType === "solana");
  // Reject Ethereum addresses (0x...) — they are not valid Solana base58
  const address = wallet.address;
  const hasValidAddress =
    typeof address === "string" && !address.startsWith("0x");
  return isSolana && hasValidAddress;
}

export function useConnectedSolanaWallet(): ConnectedSolanaWalletLike | null {
  const { ready, authenticated, user } = usePrivy();
  const { wallet: activeWallet } = useActiveWallet();
  const { wallets } = useWallets();
  const { wallets: embeddedWallets } = useSolanaWallets();

  return useMemo(() => {
    // Wait for Privy to hydrate before picking a wallet. Otherwise an extension
    // auto-connect (shouldAutoConnect: true) wins the race against Privy's
    // session restore and hijacks email/embedded logins on refresh.
    if (!ready) return null;

    // No Privy session = logged out. If localStorage is cleared, authenticated
    // becomes false and we return null even if Phantom is still connected via
    // its own extension state. The app should show the logged-out UI.
    if (!authenticated) return null;

    // useSolanaWallets() is the authoritative source for signTransaction — always
    // resolve wallets through it by address so signing methods are available.
    const solanaByAddress = new Map(embeddedWallets.map((w) => [w.address, w]));

    const userOwnsEmbeddedSolana = (user?.linkedAccounts ?? []).some((a: any) => {
      const t = a?.type ?? a?.linkedAccountType;
      const ct = a?.chainType;
      const wct = a?.walletClientType;
      return t === "wallet" && ct === "solana" && wct === "privy";
    });

    // Privy's active wallet reflects the wallet the user actually signed in
    // with — for email/social logins it's the embedded wallet, for wallet
    // logins it's the connected extension. Trust it.
    if (isConnectedSolanaWalletLike(activeWallet)) {
      // Guardrail: if Privy says "external" but the authenticated user owns
      // an embedded Solana wallet AND no external wallet is in linkedAccounts,
      // the extension is hijacking. Prefer the embedded wallet.
      if (activeWallet.walletClientType !== "privy" && userOwnsEmbeddedSolana) {
        const userLinkedExternal = (user?.linkedAccounts ?? []).some((a: any) => {
          const t = a?.type ?? a?.linkedAccountType;
          const ct = a?.chainType;
          const wct = a?.walletClientType;
          return t === "wallet" && ct === "solana" && wct !== "privy";
        });
        if (!userLinkedExternal) {
          const embeddedFromSdk = embeddedWallets.find(
            (w) => w.walletClientType === "privy" && typeof w.address === "string"
          );
          if (embeddedFromSdk) return embeddedFromSdk;
        }
      }
      return solanaByAddress.get(activeWallet.address) ?? activeWallet;
    }

    // Privy is ready+authenticated but has no active wallet yet — fall back
    // based on the user's actual login type from linkedAccounts.
    const connected = wallets.filter(isConnectedSolanaWalletLike);

    if (userOwnsEmbeddedSolana) {
      const embeddedFromConnected = connected.find(
        (w) => w.walletClientType === "privy"
      );
      if (embeddedFromConnected) {
        return solanaByAddress.get(embeddedFromConnected.address) ?? embeddedFromConnected;
      }
      const embeddedFromSdk = embeddedWallets.find(
        (w) => w.walletClientType === "privy" && typeof w.address === "string"
      );
      if (embeddedFromSdk) return embeddedFromSdk;
    }

    // External-only login: use the connected extension.
    const externalDetected = connected.find((w) => w.walletClientType !== "privy");
    if (externalDetected) {
      return solanaByAddress.get(externalDetected.address) ?? externalDetected;
    }

    return embeddedWallets.find(
      (w) => w.walletClientType !== "privy" && typeof w.address === "string"
    ) ?? null;
  }, [ready, authenticated, user, activeWallet, wallets, embeddedWallets]);
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
        // Privy embedded wallet methods rely on their wallet object context.
        // Calling the method unbound can drop the internal public key.
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
