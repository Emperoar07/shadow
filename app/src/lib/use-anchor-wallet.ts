import { useMemo } from "react";
import {
  useWallet,
  type WalletContextState,
} from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { PublicKey } from "@solana/web3.js";
import type { Transaction } from "@solana/web3.js";

export type AnchorCompatibleWallet = {
  publicKey: WalletContextState["publicKey"];
  signTransaction: WalletContextState["signTransaction"];
  signAllTransactions: WalletContextState["signAllTransactions"];
};

type SignAllTransactions = NonNullable<WalletContextState["signAllTransactions"]>;

export function useAnchorWalletCompat(): AnchorCompatibleWallet | null {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
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
      };
    }

    // Fall back to any Privy-managed wallet (embedded or external like Phantom via Privy)
    if (authenticated && solanaWallets.length > 0) {
      // Prefer the first wallet that has signTransaction — external wallet first, then embedded
      const privyWallet =
        solanaWallets.find((w) => w.walletClientType !== "privy" && w.signTransaction) ??
        solanaWallets.find((w) => w.signTransaction);

      if (privyWallet?.address && privyWallet.signTransaction) {
        let privyPublicKey: PublicKey;
        try {
          privyPublicKey = new PublicKey(privyWallet.address);
        } catch {
          return null;
        }

        const privySignTransaction = privyWallet.signTransaction as NonNullable<WalletContextState["signTransaction"]>;
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
        };
      }
    }

    return null;
  }, [publicKey, signTransaction, signAllTransactions, authenticated, solanaWallets]);
}
