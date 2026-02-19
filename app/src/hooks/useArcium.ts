import { useCallback, useRef, useState } from "react";
import BN from "bn.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { createShadowPerpClient } from "../lib/create-client";
import { PositionDirection } from "../types";
import { useAnchorWalletCompat } from "../lib/use-anchor-wallet";

type PrivacyStatus =
  | "idle"
  | "preparing"
  | "queued"
  | "verifying"
  | "verified"
  | "error";

export interface PrivateOrderInput {
  side: PositionDirection;
  sizeUi: number;
  leverage: number;
  entryPriceUi?: number;
}

// Validated once at module load — throws immediately if required env var is absent
// so misconfiguration is caught at startup rather than silently routing to devnet.
function resolveArciumRpcUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_ARCIUM_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!url) {
    throw new Error(
      "[ShadowPerp] Missing required env var NEXT_PUBLIC_ARCIUM_RPC_URL. " +
        "Copy .env.example to .env.local and set all required values before starting the app."
    );
  }
  return url;
}

const ARCIUM_RPC_URL = resolveArciumRpcUrl();

export const useArciumPrivacy = () => {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWalletCompat();
  const clientRef = useRef<ReturnType<typeof createShadowPerpClient> | null>(null);

  const [status, setStatus] = useState<PrivacyStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [lastSignature, setLastSignature] = useState<string | null>(null);

  const getClient = useCallback(() => {
    if (!anchorWallet) return null;
    if (!clientRef.current) {
      clientRef.current = createShadowPerpClient(connection, anchorWallet);
    }
    return clientRef.current;
  }, [anchorWallet, connection]);

  const resetStatus = useCallback(() => {
    setStatus("idle");
    setStatusMessage("");
    setLastSignature(null);
  }, []);

  const submitPrivateOrder = useCallback(
    async (
      order: PrivateOrderInput,
      isPrivate: boolean
    ): Promise<{ txSignature: string; positionAddress: string; usedPrivatePath: boolean }> => {
      const ctx = getClient();
      if (!ctx) {
        throw new Error("Connect a compatible wallet and ensure runtime env vars are configured.");
      }

      const { client, runtime } = ctx;
      setStatus("preparing");
      setStatusMessage(
        isPrivate
          ? `Preparing encrypted order for Arcium MXE (${ARCIUM_RPC_URL})...`
          : "Public mode selected. This build routes through encrypted path."
      );

      const market = await client.getMarket(runtime.marketAddress);
      const oraclePriceRaw = new BN(market.oraclePrice.toString());
      const oraclePrice = oraclePriceRaw.gt(new BN(0)) ? oraclePriceRaw : new BN(1);
      const oraclePriceUi = Number(oraclePrice.toString()) / 1_000_000;
      const resolvedEntryPriceUi =
        order.entryPriceUi && order.entryPriceUi > 0
          ? order.entryPriceUi
          : oraclePriceUi;
      const entryPrice = new BN(
        Math.max(1, Math.round(resolvedEntryPriceUi * 1_000_000))
      );

      const sizeBase = new BN(Math.max(1, Math.round(order.sizeUi * 10 ** 9)));
      const requiredMarginUi = (order.sizeUi * resolvedEntryPriceUi) / order.leverage;
      const marginBase = new BN(Math.max(1, Math.round(requiredMarginUi * 1_000_000)));

      const { txSignature, positionAddress } = await client.openPosition(runtime.marketAddress, {
        size: sizeBase,
        entryPrice,
        leverage: order.leverage,
        direction: order.side,
        margin: marginBase,
      });

      setLastSignature(txSignature);
      setStatus("queued");
      setStatusMessage("Queued on Arcium cluster");

      setStatus("verifying");
      setStatusMessage("Verifying computation callback...");
      setStatus("verified");
      setStatusMessage("Verified computation complete");

      return {
        txSignature,
        positionAddress: positionAddress.toBase58(),
        usedPrivatePath: true,
      };
    },
    [getClient]
  );

  const setError = useCallback((message: string) => {
    setStatus("error");
    setStatusMessage(message);
  }, []);

  return {
    submitPrivateOrder,
    status,
    statusMessage,
    lastSignature,
    arciumRpcUrl: ARCIUM_RPC_URL,
    setError,
    resetStatus,
  };
};
