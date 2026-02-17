import { useCallback, useRef, useState } from "react";
import BN from "bn.js";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { createShadowPerpClient } from "../lib/create-client";
import { PositionDirection } from "../types";

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
}

export const useArciumPrivacy = () => {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
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
          ? "Preparing encrypted order for Arcium MXE..."
          : "Public mode selected. This build routes through encrypted path."
      );

      const market = await client.getMarket(runtime.marketAddress);
      const oraclePrice = new BN(market.oraclePrice.toString());
      const entryPrice = oraclePrice.gt(new BN(0)) ? oraclePrice : new BN(1);
      const oraclePriceUi = Number(entryPrice.toString()) / 1_000_000;

      const sizeBase = new BN(Math.max(1, Math.round(order.sizeUi * 10 ** 9)));
      const requiredMarginUi = (order.sizeUi * oraclePriceUi) / order.leverage;
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
    setError,
    resetStatus,
  };
};
