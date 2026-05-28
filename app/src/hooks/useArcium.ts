import { useCallback, useEffect, useRef, useState } from "react";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
import { createShadowPerpClient } from "../lib/create-client";
import { PositionDirection, PositionStatus } from "../types";
import {
  useAnchorWalletCompat,
  useWalletExecutionMode,
} from "../lib/use-anchor-wallet";
import { isMissingAccountError } from "../lib/account-errors";
import {
  diagnoseOpenCallbackFailure,
  normalizePositionStatus as normalizePositionStatusShared,
} from "../lib/arcium-callback-diag";
import { ensureFreshMarketOracle } from "../lib/oracle-refresh";

function normalizePositionStatus(raw: unknown): PositionStatus {
  return normalizePositionStatusShared(raw) as PositionStatus;
}

type PrivacyStatus =
  | "idle"
  | "preparing"
  | "queued"
  | "verifying"
  | "verified"
  | "error";

export type RelaySessionUiState =
  | "idle"
  | "creating"
  | "active"
  | "expired"
  | "reconnecting";

export interface PrivateOrderInput {
  side: PositionDirection;
  sizeUi: number;
  leverage: number;
  entryPriceUi?: number;
  marginMode?: "cross" | "isolated";
  pairLabel?: string;
}

/**
 * Retained for compatibility while the app transitions away from delegated
 * relay sessions. The live UI no longer uses these fields.
 */
export interface SessionRelayInfo {
  sessionVersion: "v1" | "v2";
  owner: string;
  market: string;
  scopeAllMarkets: boolean;
  relayer: string;
  sessionId: string;
  sessionAddress: string;
  authScope: string;
  authAction: "open" | "deposit" | "withdraw";
  expiresAt: number;
  authExpiresAt: number;
  maxActions: number;
  usedActions: number;
  maxMarginPerActionRaw: string;
  authSignature: string;
  collateralDelegateApproved: boolean;
}

/**
 * Retained for compatibility while the direct wallet path is the only live path.
 */
export interface EnsureRelaySessionOptions {
  maxActions?: number;
  maxMarginPerActionUsdc?: number;
  reason?: "trade" | "deposit" | "withdraw";
  userInitiated?: boolean;
  durationSeconds?: number;
}

export const RELAY_SESSION_STORAGE_KEY = "shadowperp.relay.session.v1";
export const RELAY_SESSION_UPDATED_EVENT = "shadowperp:relay-session-updated";
export const RELAY_SESSION_RENEW_BEFORE_SECONDS = 15;

// Relay sessions are no longer active in the live direct-wallet flow.
export function getStoredRelaySession(): SessionRelayInfo | null {
  return null;
}

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
const OPEN_POSITION_CALLBACK_TIMEOUT_MS = 120_000;
const OPEN_POSITION_CALLBACK_POLL_MS = 2_000;
const OPEN_POSITION_CALLBACK_DIAG_POLL_MS = 6_000;

type PrivateOrderProgress = {
  stage: "queued";
  txSignature: string;
  positionAddress: string;
};

type PrivateOrderSubmitOptions = {
  onProgress?: (update: PrivateOrderProgress) => void;
};

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

async function waitForOpenPositionCallback(
  connection: Connection,
  client: ReturnType<typeof createShadowPerpClient>["client"],
  positionAddress: PublicKey,
  clusterOffset: number
): Promise<void> {
  const deadline = Date.now() + OPEN_POSITION_CALLBACK_TIMEOUT_MS;
  let lastStatus: PositionStatus | null = null;
  let lastPendingComputationAddress: PublicKey | null = null;
  let nextCallbackDiagnosisAt = 0;

  while (Date.now() < deadline) {
    try {
      const position = await client.getPosition(positionAddress);
      const status = normalizePositionStatus(position.status);
      lastStatus = status;

      if (status === PositionStatus.Open) {
        return;
      }

      if (status === PositionStatus.Pending) {
        const pendingComputation = parsePendingComputationAccount(position);
        if (pendingComputation) {
          lastPendingComputationAddress = pendingComputation;
        }

        if (Date.now() >= nextCallbackDiagnosisAt) {
          nextCallbackDiagnosisAt = Date.now() + OPEN_POSITION_CALLBACK_DIAG_POLL_MS;
          const callbackFailure = await diagnoseOpenCallbackFailure(
            connection,
            positionAddress,
            lastPendingComputationAddress,
            clusterOffset
          );
          if (callbackFailure) {
            throw new Error(callbackFailure);
          }
        }
      } else if (status === PositionStatus.Closed) {
        const callbackFailure = await diagnoseOpenCallbackFailure(
          connection,
          positionAddress,
          lastPendingComputationAddress,
          clusterOffset
        );
        throw new Error(
          callbackFailure ??
            `Queued on Arcium cluster ${clusterOffset}, but the position resolved to Closed instead of Open.`
        );
      } else {
        throw new Error(
          `Queued on Arcium cluster ${clusterOffset}, but the position entered unexpected status ${PositionStatus[status] ?? status}.`
        );
      }
    } catch (error: any) {
      if (!isMissingAccountError(error)) {
        throw error;
      }
    }

    const remainingMs = deadline - Date.now();
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(OPEN_POSITION_CALLBACK_POLL_MS, Math.max(remainingMs, 0)))
    );
  }

  const callbackFailure = await diagnoseOpenCallbackFailure(
    connection,
    positionAddress,
    lastPendingComputationAddress,
    clusterOffset
  );
  if (callbackFailure) {
    throw new Error(callbackFailure);
  }

  const statusLabel =
    lastStatus === null ? "no position state observed yet" : PositionStatus[lastStatus];
  throw new Error(
    `Queued on Arcium cluster ${clusterOffset}, but no MPC callback finalized the position within ${OPEN_POSITION_CALLBACK_TIMEOUT_MS / 1000}s (${statusLabel}).`
  );
}

function parsePendingComputationAccount(position: unknown): PublicKey | null {
  const raw = (position as { pendingComputationAccount?: unknown } | null)
    ?.pendingComputationAccount;
  if (!raw) return null;

  try {
    const pubkey = raw instanceof PublicKey ? raw : new PublicKey(raw as string);
    return pubkey.equals(PublicKey.default) ? null : pubkey;
  } catch {
    return null;
  }
}


function attachTxContext(
  error: Error,
  txSignature: string,
  positionAddress: string
): Error & {
  txSignature: string;
  positionAddress: string;
} {
  const withContext = error as Error & {
    txSignature: string;
    positionAddress: string;
  };
  withContext.txSignature = txSignature;
  withContext.positionAddress = positionAddress;
  return withContext;
}

export const useArciumPrivacy = ({ pairLabel }: { pairLabel?: string } = {}) => {
  const { connection } = useConnection();
  const { getAccessToken } = usePrivy();
  const anchorWallet = useAnchorWalletCompat();
  const walletExecutionMode = useWalletExecutionMode();
  const publicKey = anchorWallet?.publicKey ?? null;
  const clientRef = useRef<ReturnType<typeof createShadowPerpClient> | null>(null);
  const prevWalletModeRef = useRef(walletExecutionMode);
  if (prevWalletModeRef.current !== walletExecutionMode) {
    clientRef.current = null;
    prevWalletModeRef.current = walletExecutionMode;
  }

  const [status, setStatus] = useState<PrivacyStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [lastSignature, setLastSignature] = useState<string | undefined>();

  const resetStatus = useCallback(() => {
    setStatus("idle");
    setStatusMessage("");
  }, []);

  const getClient = useCallback(() => {
    if (!anchorWallet) return null;
    if (!clientRef.current) {
      clientRef.current = createShadowPerpClient(connection, anchorWallet, walletExecutionMode);
    }
    return clientRef.current;
  }, [anchorWallet, connection, walletExecutionMode]);

  const resolveMarketAddress = useCallback(
    (ctx: ReturnType<typeof createShadowPerpClient>) => {
      if (!pairLabel) return ctx.runtime.marketAddress;
      return ctx.runtime.marketRegistry[pairLabel] ?? ctx.runtime.marketAddress;
    },
    [pairLabel]
  );

  useEffect(() => {
    clientRef.current = null;
  }, [anchorWallet, publicKey]);

  const submitPrivateOrder = useCallback(
    async (
      order: PrivateOrderInput,
      isPrivate: boolean,
      options?: PrivateOrderSubmitOptions
    ): Promise<{ txSignature: string; positionAddress: string; usedPrivatePath: boolean }> => {
      const ctx = getClient();
      if (!ctx) {
        throw new Error(
          "Connect a compatible wallet and ensure runtime env vars are configured."
        );
      }

      const { client } = ctx;
      const orderMarket = resolveMarketAddress(ctx);
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

      setStatusMessage("Refreshing market oracle before encrypted submission...");
      try {
        // Fire refresh in background without blocking execution
        ensureFreshMarketOracle({
          market: orderMarket,
          pairLabel: order.pairLabel,
          getAccessToken,
          operation: "opening position",
        }).catch((err) => {
          console.debug("[useArcium] Background oracle refresh skipped or rate-limited:", err);
        });
      } catch (err: any) {
        // Safe catch
      }

      const market = await client.getMarket(orderMarket);
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
      const oraclePriceUi = Number(oraclePrice.toString()) / SCALE_PRICE;
      const resolvedEntryPriceUi =
        order.entryPriceUi && order.entryPriceUi > 0
          ? order.entryPriceUi
          : oraclePriceUi;
      requireFinitePositive(resolvedEntryPriceUi, "entry price");

      const entryPrice = toScaledPositiveBn(
        resolvedEntryPriceUi,
        SCALE_PRICE,
        "entry price"
      );
      const sizeBase = toScaledPositiveBn(
        order.sizeUi,
        SCALE_BASE_SIZE,
        "position size"
      );
      const requiredMarginUi = (order.sizeUi * resolvedEntryPriceUi) / order.leverage;
      requireFinitePositive(requiredMarginUi, "required margin");
      const marginBase = toScaledPositiveBn(
        requiredMarginUi,
        SCALE_MARGIN,
        "required margin"
      );

      setStatus("queued");
      setStatusMessage("Queued on Arcium cluster...");

      const { txSignature, positionAddress } = await client.openPosition(orderMarket, {
        size: sizeBase,
        entryPrice,
        leverage: order.leverage,
        direction: order.side,
        margin: marginBase,
        marginMode: order.marginMode ?? "cross",
      });

      const positionAddressBase58 = positionAddress.toBase58();
      setLastSignature(txSignature);
      options?.onProgress?.({
        stage: "queued",
        txSignature,
        positionAddress: positionAddressBase58,
      });

      setStatus("verifying");
      setStatusMessage("Awaiting MPC callback finalization...");
      try {
        await waitForOpenPositionCallback(
          connection,
          client,
          positionAddress,
          ctx.runtime.clusterOffset
        );
      } catch (error: any) {
        const message =
          error instanceof Error
            ? error
            : new Error(
                typeof error?.message === "string"
                  ? error.message
                  : "Queued transaction did not finalize."
              );
        throw attachTxContext(message, txSignature, positionAddressBase58);
      }

      setStatus("verified");
      setStatusMessage("MPC callback finalized. Position opened.");

      return {
        txSignature,
        positionAddress: positionAddressBase58,
        usedPrivatePath: true,
      };
    },
    [connection, getAccessToken, getClient, resolveMarketAddress]
  );

  const setError = useCallback((message: string) => {
    setStatus("error");
    setStatusMessage(message);
  }, []);

  const directModeMessage =
    walletExecutionMode === "embedded"
      ? "Embedded wallet signs directly"
      : "Direct signing active";

  return {
    submitPrivateOrder,
    status,
    statusMessage,
    lastSignature,
    arciumRpcUrl: ARCIUM_RPC_URL,
    setError,
    resetStatus,
    relayAvailable: false,
    relayError: null,
    relaySession: null as SessionRelayInfo | null,
    relaySessionHydrated: true,
    relaySessionState: "idle" as RelaySessionUiState,
    relaySessionMessage: directModeMessage,
    createRelaySession: async (_options?: EnsureRelaySessionOptions) => null,
    ensureRelaySession: async (_options?: EnsureRelaySessionOptions) => null,
    invalidateRelaySession: (_owner?: string, _market?: string) => undefined,
    revokeRelaySession: async (_revokeOnChain = true) => undefined,
    refreshRelaySession: async (_candidate?: SessionRelayInfo | null) => null,
  };
};
