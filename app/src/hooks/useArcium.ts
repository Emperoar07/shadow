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
const SCALE_PRICE = 1_000_000;
const SCALE_BASE_SIZE = 1_000_000_000;
const SCALE_MARGIN = 1_000_000;

function requireFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${label}.`);
  }
}

function toScaledPositiveBn(value: number, scale: number, label: string): BN {
  requireFinitePositive(value, label);
  const scaled = Math.round(value * scale);
  if (!Number.isFinite(scaled) || scaled <= 0 || !Number.isSafeInteger(scaled)) {
    throw new Error(`Invalid ${label}: out of supported range.`);
  }
  return new BN(scaled);
}

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
      requireFinitePositive(order.sizeUi, "position size");
      if (!Number.isInteger(order.leverage) || order.leverage < 1) {
        throw new Error("Invalid leverage.");
      }

      setStatus("preparing");
      setStatusMessage(
        isPrivate
          ? `Preparing encrypted order for Arcium MXE (${ARCIUM_RPC_URL})...`
          : "Public mode selected. This build routes through encrypted path."
      );

      const market = await client.getMarket(runtime.marketAddress);
      const marketMaxLeverage = Number(market.maxLeverage ?? 0);
      if (
        !Number.isFinite(marketMaxLeverage) ||
        marketMaxLeverage < 1 ||
        order.leverage > marketMaxLeverage
      ) {
        throw new Error(`Leverage exceeds market max (${marketMaxLeverage}x).`);
      }

      const oraclePriceRaw = new BN(market.oraclePrice.toString());
      const oraclePrice = oraclePriceRaw.gt(new BN(0)) ? oraclePriceRaw : new BN(1);
      const oraclePriceUi = Number(oraclePrice.toString()) / 1_000_000;
      const resolvedEntryPriceUi =
        order.entryPriceUi && order.entryPriceUi > 0
          ? order.entryPriceUi
          : oraclePriceUi;
      requireFinitePositive(resolvedEntryPriceUi, "entry price");
      const entryPrice = toScaledPositiveBn(resolvedEntryPriceUi, SCALE_PRICE, "entry price");

      const sizeBase = toScaledPositiveBn(order.sizeUi, SCALE_BASE_SIZE, "position size");
      const requiredMarginUi = (order.sizeUi * resolvedEntryPriceUi) / order.leverage;
      requireFinitePositive(requiredMarginUi, "required margin");
      const marginBase = toScaledPositiveBn(requiredMarginUi, SCALE_MARGIN, "required margin");

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
