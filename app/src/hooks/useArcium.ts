import { useCallback, useEffect, useRef, useState } from "react";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { createShadowPerpClient } from "../lib/create-client";
import { PositionDirection } from "../types";
import { useAnchorWalletCompat } from "../lib/use-anchor-wallet";
import { DEFAULT_TRADE_SESSION_DURATION_SECONDS } from "../lib/client";
import {
  buildRelaySessionAuthMessage,
  uint8ToBase64,
} from "../lib/relay-session-auth";

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

export interface SessionRelayInfo {
  owner: string;
  market: string;
  relayer: string;
  sessionId: string;
  sessionAddress: string;
  expiresAt: number;
  maxActions: number;
  usedActions: number;
  maxMarginPerActionRaw: string;
  authSignature: string;
}

export const RELAY_SESSION_STORAGE_KEY = "shadowperp.relay.session.v1";
export const RELAY_SESSION_UPDATED_EVENT = "shadowperp:relay-session-updated";
export const RELAY_SESSION_RENEW_BEFORE_SECONDS = 15;
const DEFAULT_SESSION_MAX_ACTIONS = 200;
const DEFAULT_SESSION_MAX_MARGIN_USDC = 1_000;

// Validated once at module load - throws immediately if required env var is absent
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

function storageKey(owner: string, market: string): string {
  return `${RELAY_SESSION_STORAGE_KEY}:${owner}:${market}`;
}

function isRelayStorageKey(key: string | null): boolean {
  if (!key) return false;
  return key === RELAY_SESSION_STORAGE_KEY || key.startsWith(`${RELAY_SESSION_STORAGE_KEY}:`);
}

function parseSession(raw: string | null): SessionRelayInfo | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionRelayInfo;
    if (
      typeof parsed?.owner !== "string" ||
      typeof parsed?.market !== "string" ||
      typeof parsed?.sessionId !== "string" ||
      typeof parsed?.authSignature !== "string" ||
      typeof parsed?.expiresAt !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function readStoredSession(owner?: string, market?: string): SessionRelayInfo | null {
  if (typeof window === "undefined") return null;
  if (owner && market) {
    const keyed = parseSession(window.localStorage.getItem(storageKey(owner, market)));
    if (keyed) return keyed;

    // Legacy migration: single-session storage key.
    const legacy = parseSession(window.localStorage.getItem(RELAY_SESSION_STORAGE_KEY));
    if (legacy && legacy.owner === owner && legacy.market === market) {
      window.localStorage.setItem(storageKey(owner, market), JSON.stringify(legacy));
      window.localStorage.removeItem(RELAY_SESSION_STORAGE_KEY);
      return legacy;
    }
    return null;
  }

  // Fallback for callers without owner/market.
  const legacy = parseSession(window.localStorage.getItem(RELAY_SESSION_STORAGE_KEY));
  if (legacy) return legacy;
  return null;
}

export function getStoredRelaySession(owner?: string, market?: string): SessionRelayInfo | null {
  return readStoredSession(owner, market);
}

function persistSession(session: SessionRelayInfo): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(session.owner, session.market),
      JSON.stringify(session)
    );
  } catch {
    // Storage failures should not block in-memory session activation.
  }
  window.dispatchEvent(
    new CustomEvent(RELAY_SESSION_UPDATED_EVENT, { detail: { session } })
  );
}

function clearStoredSession(owner: string, market: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(owner, market));
  } catch {
    // no-op
  }
  window.dispatchEvent(
    new CustomEvent(RELAY_SESSION_UPDATED_EVENT, {
      detail: { session: null, owner, market },
    })
  );
}

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

function isUsableRelaySession(
  session: SessionRelayInfo | null,
  owner: string | null | undefined,
  market: string | null | undefined,
  nowSeconds: number
): session is SessionRelayInfo {
  if (!session || !owner || !market) return false;
  if (session.owner !== owner) return false;
  if (session.market !== market) return false;
  if (session.expiresAt - nowSeconds <= RELAY_SESSION_RENEW_BEFORE_SECONDS) return false;
  if (session.usedActions >= session.maxActions) return false;
  return true;
}

export const useArciumPrivacy = () => {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWalletCompat();
  const { publicKey, signMessage } = useWallet();
  const clientRef = useRef<ReturnType<typeof createShadowPerpClient> | null>(null);

  const [status, setStatus] = useState<PrivacyStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const [relaySession, setRelaySession] = useState<SessionRelayInfo | null>(null);
  const [relayAvailable, setRelayAvailable] = useState<boolean>(false);
  const [relayError, setRelayError] = useState<string | null>(null);

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

  const refreshRelayAvailability = useCallback(async () => {
    try {
      const response = await fetch("/api/relay/session");
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || !payload?.available) {
        setRelayAvailable(false);
        setRelayError(payload?.error || `Relay unavailable (${response.status})`);
        return null;
      }
      setRelayAvailable(true);
      setRelayError(null);
      return payload as {
        ok: true;
        available: true;
        relayer: string;
        market: string;
      };
    } catch (error: any) {
      setRelayAvailable(false);
      setRelayError(
        typeof error?.message === "string" ? error.message : "Relay unavailable"
      );
      return null;
    }
  }, []);

  const refreshRelaySession = useCallback(async () => {
    const current = relaySession;
    if (!current) return null;
    if (!publicKey || current.owner !== publicKey.toBase58()) {
      setRelaySession(null);
      return null;
    }

    try {
      const query = new URLSearchParams({
        owner: current.owner,
        sessionId: current.sessionId,
      });
      const response = await fetch(`/api/relay/session?${query.toString()}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || !payload?.available || payload.exists === false) {
        setRelaySession(null);
        clearStoredSession(current.owner, current.market);
        return null;
      }
      if (!payload.session) return current;

      const next: SessionRelayInfo = {
        ...current,
        relayer: payload.session.relayer,
        usedActions: payload.session.usedActions,
        maxActions: payload.session.maxActions,
        maxMarginPerActionRaw: payload.session.maxMarginPerAction,
        expiresAt: Number(payload.session.expiresAt),
      };
      if (
        payload.session.revoked ||
        next.expiresAt - Math.floor(Date.now() / 1000) <=
          RELAY_SESSION_RENEW_BEFORE_SECONDS ||
        next.usedActions >= next.maxActions
      ) {
        setRelaySession(null);
        clearStoredSession(current.owner, current.market);
        return null;
      }

      setRelaySession(next);
      persistSession(next);
      return next;
    } catch {
      return current;
    }
  }, [publicKey, relaySession]);

  const createRelaySession = useCallback(
    async (options?: { maxActions?: number; maxMarginPerActionUsdc?: number }) => {
      if (!publicKey) {
        throw new Error("Connect wallet first.");
      }
      if (!signMessage) {
        throw new Error("Wallet does not support message signing.");
      }
      const ctx = getClient();
      if (!ctx) {
        throw new Error("Trading client unavailable. Check wallet + env.");
      }

      const relayInfo = await refreshRelayAvailability();
      if (!relayInfo) {
        throw new Error(relayError || "Relay unavailable.");
      }

      const { client, runtime } = ctx;
      const owner = publicKey.toBase58();
      const marketAddress = runtime.marketAddress.toBase58();
      const nowSeconds = Math.floor(Date.now() / 1000);
      const existing =
        relaySession ??
        readStoredSession(owner, marketAddress);
      if (isUsableRelaySession(existing, owner, marketAddress, nowSeconds)) {
        setRelaySession(existing);
        return existing;
      }

      const sessionId = new BN(Math.floor(Date.now() / 1000));
      const expiresAt = Math.floor(Date.now() / 1000) + DEFAULT_TRADE_SESSION_DURATION_SECONDS;
      const maxActions = options?.maxActions ?? DEFAULT_SESSION_MAX_ACTIONS;
      const maxMarginPerActionUsdc =
        options?.maxMarginPerActionUsdc ?? DEFAULT_SESSION_MAX_MARGIN_USDC;
      const maxMarginPerAction = toScaledPositiveBn(
        maxMarginPerActionUsdc,
        SCALE_MARGIN,
        "delegated session max margin"
      );

      setStatus("preparing");
      setStatusMessage("Authorizing delegated trading session...");

      const authMessage = buildRelaySessionAuthMessage({
        owner,
        market: marketAddress,
        sessionId: sessionId.toString(),
        expiresAt,
      });
      const signature = await signMessage(new TextEncoder().encode(authMessage));

      setStatus("queued");
      setStatusMessage("Creating delegated session on-chain...");

      const { txSignature, sessionAddress } = await client.createTradeSession(
        runtime.marketAddress,
        sessionId,
        new PublicKey(relayInfo.relayer),
        maxActions,
        maxMarginPerAction,
        new BN(expiresAt)
      );
      setLastSignature(txSignature);

      const nextSession: SessionRelayInfo = {
        owner,
        market: marketAddress,
        relayer: relayInfo.relayer,
        sessionId: sessionId.toString(),
        sessionAddress: sessionAddress.toBase58(),
        expiresAt,
        maxActions,
        usedActions: 0,
        maxMarginPerActionRaw: maxMarginPerAction.toString(),
        authSignature: uint8ToBase64(signature),
      };
      setRelaySession(nextSession);
      persistSession(nextSession);
      setStatus("verified");
      setStatusMessage("Delegated session active. New trades can run without wallet popups.");

      return nextSession;
    },
    [publicKey, signMessage, getClient, refreshRelayAvailability, relayError, relaySession]
  );

  const ensureRelaySession = useCallback(
    async (options?: { maxActions?: number; maxMarginPerActionUsdc?: number }) => {
      const ctx = getClient();
      const owner = publicKey?.toBase58();
      const market = ctx?.runtime.marketAddress.toBase58();
      const nowSeconds = Math.floor(Date.now() / 1000);

      if (isUsableRelaySession(relaySession, owner, market, nowSeconds)) {
        return relaySession;
      }

      const refreshed = await refreshRelaySession();
      if (isUsableRelaySession(refreshed, owner, market, nowSeconds)) {
        return refreshed;
      }

      return createRelaySession(options);
    },
    [createRelaySession, getClient, publicKey, refreshRelaySession, relaySession]
  );

  const revokeRelaySession = useCallback(
    async (revokeOnChain = true) => {
      const current = relaySession;
      if (!current) return;

      if (revokeOnChain) {
        const ctx = getClient();
        if (!ctx) {
          throw new Error("Trading client unavailable.");
        }
        await ctx.client.revokeTradeSession(
          ctx.runtime.marketAddress,
          new BN(current.sessionId, 10)
        );
      }

      setRelaySession(null);
      clearStoredSession(current.owner, current.market);
    },
    [relaySession, getClient]
  );

  useEffect(() => {
    void refreshRelayAvailability();
  }, [refreshRelayAvailability]);

  useEffect(() => {
    const ctx = getClient();
    if (!publicKey || !ctx) {
      setRelaySession(null);
      return;
    }

    const owner = publicKey.toBase58();
    const market = ctx.runtime.marketAddress.toBase58();
    const stored = readStoredSession(owner, market);
    if (!stored) return;

    if (
      stored.expiresAt - Math.floor(Date.now() / 1000) <=
        RELAY_SESSION_RENEW_BEFORE_SECONDS ||
      stored.usedActions >= stored.maxActions
    ) {
      setRelaySession(null);
      clearStoredSession(owner, market);
      return;
    }

    setRelaySession(stored);
  }, [getClient, publicKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncFromStorage = () => {
      const ctx = getClient();
      const owner = publicKey?.toBase58();
      if (!ctx || !owner) {
        setRelaySession(null);
        return;
      }
      const market = ctx.runtime.marketAddress.toBase58();
      const stored = readStoredSession(owner, market);
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (
        !isUsableRelaySession(
          stored,
          owner,
          market,
          nowSeconds
        )
      ) {
        setRelaySession(null);
        return;
      }
      setRelaySession(stored);
    };

    const onStorage = (event: StorageEvent) => {
      if (isRelayStorageKey(event.key)) syncFromStorage();
    };
    const onSessionUpdated = () => syncFromStorage();

    window.addEventListener("storage", onStorage);
    window.addEventListener(
      RELAY_SESSION_UPDATED_EVENT,
      onSessionUpdated as EventListener
    );

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        RELAY_SESSION_UPDATED_EVENT,
        onSessionUpdated as EventListener
      );
    };
  }, [getClient, publicKey]);

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

      const nowSeconds = Math.floor(Date.now() / 1000);
      const activeRelaySession: SessionRelayInfo | null =
        isUsableRelaySession(
          relaySession,
          anchorWallet?.publicKey?.toBase58(),
          runtime.marketAddress.toBase58(),
          nowSeconds
        )
          ? relaySession
          : null;

      if (!activeRelaySession) {
        throw new Error(
          "Delegated session required. Please sign a new session to continue trading."
        );
      }

      setStatus("queued");
      setStatusMessage("Queued on Arcium cluster via delegated session...");

      const response = await fetch("/api/relay/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: activeRelaySession.owner,
          sessionId: activeRelaySession.sessionId,
          side: order.side,
          leverage: order.leverage,
          sizeRaw: sizeBase.toString(),
          entryPriceRaw: entryPrice.toString(),
          marginRaw: marginBase.toString(),
          auth: {
            expiresAt: activeRelaySession.expiresAt,
            signature: activeRelaySession.authSignature,
          },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.error || `Delegated session submit failed (${response.status}).`
        );
      }

      const txSignature = payload.txSignature as string;
      const positionAddress = payload.positionAddress as string;

      const nextSession: SessionRelayInfo = {
        ...activeRelaySession,
        usedActions: activeRelaySession.usedActions + 1,
      };
      setRelaySession(nextSession);
      persistSession(nextSession);

      setLastSignature(txSignature);
      setStatus("queued");
      setStatusMessage("Queued on Arcium cluster");

      setStatus("verifying");
      setStatusMessage("Verifying computation callback...");
      setStatus("verified");
      setStatusMessage("Verified computation complete");

      return {
        txSignature,
        positionAddress,
        usedPrivatePath: true,
      };
    },
    [getClient, relaySession, anchorWallet]
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
    relayAvailable,
    relayError,
    relaySession,
    createRelaySession,
    ensureRelaySession,
    revokeRelaySession,
    refreshRelaySession,
  };
};
