import { useMemo } from "react";
import {
  useWallet,
  type WalletContextState,
} from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
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

export function useWalletExecutionMode(): WalletExecutionMode {
  const { publicKey } = useWallet();
  const { authenticated } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();

  return useMemo(() => {
    if (publicKey) return "external";
    if (authenticated && solanaWallets.some((wallet) => wallet.walletClientType === "privy")) {
      return "embedded";
    }
    return "none";
  }, [publicKey, authenticated, solanaWallets]);
}

export function useAnchorWalletCompat(): AnchorCompatibleWallet | null {
  const { publicKey, signTransaction, signAllTransactions, signMessage } = useWallet();
  const { authenticated } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();

  return useMemo(() => {
    // Prefer wallet-adapter (Phantom, Solflare, etc.) if connected
    if (publicKey && signTransaction) {
      const safeSignAll =
        signAllTransactions ??
        (async (txs: Transaction[]) => {
          const out: Transaction[] = [];
          for (const tx of txs) {
            out.push(await signTransaction(tx));
          }
          return out;
        });

      return {
        publicKey,
        signTransaction,
        signAllTransactions: safeSignAll as SignAllTransactions,
        signMessage,
      };
    }

    // Fall back to Privy embedded wallet (email/social users — walletClientType === "privy")
    if (authenticated) {
      const embedded = solanaWallets.find((w) => w.walletClientType === "privy");
      if (embedded?.address && embedded.signTransaction) {
        let privyPublicKey: PublicKey;
        try {
          privyPublicKey = new PublicKey(embedded.address);
        } catch {
          return null;
        }

        const privySignTransaction = embedded.signTransaction as NonNullable<WalletContextState["signTransaction"]>;
        const safeSignAll: SignAllTransactions = async (txs) => {
          const out = [];
          for (const tx of txs) {
            out.push(await privySignTransaction(tx as Transaction) as typeof tx);
          }
          return out;
        };

        return {
          publicKey: privyPublicKey,
          signTransaction: privySignTransaction,
          signAllTransactions: safeSignAll,
          signMessage:
            typeof embedded.signMessage === "function"
              ? (embedded.signMessage as NonNullable<WalletContextState["signMessage"]>)
              : undefined,
        };
      }
    }

    return null;
  }, [publicKey, signTransaction, signAllTransactions, signMessage, authenticated, solanaWallets]);
}
