import { AnchorProvider } from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import { WalletContextState } from "@solana/wallet-adapter-react";
import { ShadowPerpClient } from "./client";
import { getRuntimeConfig } from "./runtime";

type AnchorWallet = {
  publicKey: WalletContextState["publicKey"];
  signTransaction: WalletContextState["signTransaction"];
  signAllTransactions: WalletContextState["signAllTransactions"];
};

export function createShadowPerpClient(
  connection: Connection,
  wallet: AnchorWallet,
  walletMode: "embedded" | "external" | "none" = "none"
): { client: ShadowPerpClient; runtime: ReturnType<typeof getRuntimeConfig> } {
  if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
    throw new Error("Connected wallet does not support Anchor transactions");
  }

  const runtime = getRuntimeConfig();
  const provider = new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });

  return {
    client: new ShadowPerpClient(provider, runtime, walletMode),
    runtime,
  };
}
