import { useMemo } from "react";
import {
  useWallet,
  type WalletContextState,
} from "@solana/wallet-adapter-react";
import type { Transaction } from "@solana/web3.js";

export type AnchorCompatibleWallet = {
  publicKey: WalletContextState["publicKey"];
  signTransaction: WalletContextState["signTransaction"];
  signAllTransactions: WalletContextState["signAllTransactions"];
};

type SignAllTransactions = NonNullable<WalletContextState["signAllTransactions"]>;

export function useAnchorWalletCompat(): AnchorCompatibleWallet | null {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();

  return useMemo(() => {
    if (!publicKey || !signTransaction) {
      return null;
    }

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
  }, [publicKey, signTransaction, signAllTransactions]);
}
