import { useCallback, useEffect, useRef, useState } from "react";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { createShadowPerpClient } from "../lib/create-client";
import { PositionDirection } from "../types";
import { useAnchorWalletCompat, useWalletExecutionMode } from "../lib/use-anchor-wallet";
import { DEFAULT_TRADE_SESSION_DURATION_SECONDS } from "../lib/client";
import {
  buildRelaySessionAuthMessage,
  RelaySessionAction,
  RELAY_SESSION_AUTH_SCOPE,
  uint8ToBase64,
} from "../lib/relay-session-auth";
import { isSessionInvalidError } from "../lib/session-errors";
import { isMissingAccountError } from "../lib/account-errors";
import { relayUrl } from "../lib/feature-flags";
import { PositionStatus } from "../types";

/**
 * Anchor deserializes Rust enums as `{ variantName: {} }` objects.
 * Convert to our numeric PositionStatus enum for reliable comparison.
 */
const ANCHOR_ENUM_MAP: Record<string, PositionStatus> = {
  pending: PositionStatus.Pending,
  open: PositionStatus.Open,
  closing: PositionStatus.Closing,
  closed: PositionStatus.Closed,
  liquidated: PositionStatus.Liquidated,
  closedPendingSettlement: PositionStatus.ClosedPendingSettlement,
  liquidatedPendingSettlement: PositionStatus.LiquidatedPendingSettlement,
};

function normalizePositionStatus(raw: unknown): PositionStatus {
  if (typeof raw === "number") return raw;
  if (raw && typeof raw === "object") {
    const key = Object.keys(raw)[0];
    if (key && key in ANCHOR_ENUM_MAP) return ANCHOR_ENUM_MAP[key];
  }
  return PositionStatus.Pending;
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

export interface SessionRelayInfo {
  sessionVersion: "v1" | "v2";
  owner: string;
  market: string;
  scopeAllMarkets: boolean;
  relayer: string;
  sessionId: string;
  sessionAddress: string;
  authScope: string;
  authAction: RelaySessionAction;
  expiresAt: number;
  authExpiresAt: number;
  maxActions: number;
  usedActions: number;
  maxMarginPerActionRaw: string;
  authSignature: string;
  collateralDelegateApproved: boolean;
}

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
const DEFAULT_SESSION_MAX_ACTIONS = 200;
const DEFAULT_SESSION_MAX_MARGIN_USDC = 100_000;
const RELAY_SESSION_OPTIMISTIC_HOLD_MS = 15_000;
const ALL_MARKETS_SESSION_KEY = "__all_markets__";

function actionFromReason(reason?: EnsureRelaySessionOptions["reason"]): RelaySessionAction {
  if (reason === "deposit") return "deposit";
  if (reason === "withdraw") return "withdraw";
  return "open";
}

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
const U64_MAX_BN = new BN("18446744073709551615");
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

function storageKey(owner: string, market: string): string {
  return `${RELAY_SESSION_STORAGE_KEY}:${owner}:${market}`;
}

function sessionStorageMarketKey(session: Pick<SessionRelayInfo, "market" | "scopeAllMarkets">): string {
  return session.scopeAllMarkets ? ALL_MARKETS_SESSION_KEY : session.market;
}

function sessionSupportsMarket(session: SessionRelayInfo, market: string): boolean {
  return session.scopeAllMarkets || session.market === market;
}

function isRelayStorageKey(key: string | null): boolean {
  if (!key) return false;
  return key === RELAY_SESSION_STORAGE_KEY || key.startsWith(`${RELAY_SESSION_STORAGE_KEY}:`);
}

function parseSession(raw: string | null): SessionRelayInfo | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SessionRelayInfo>;
    if (
      typeof parsed?.owner !== "string" ||
      typeof parsed?.market !== "string" ||
      typeof parsed?.relayer !== "string" ||
      typeof parsed?.sessionId !== "string" ||
      typeof parsed?.sessionAddress !== "string" ||
      typeof parsed?.maxMarginPerActionRaw !== "string" ||
      typeof parsed?.authSignature !== "string" ||
      !Number.isFinite(Number(parsed?.expiresAt))
    ) {
      return null;
    }
    const parsedExpiresAt = Number(parsed.expiresAt);
    const parsedAuthExpiresAt = Number(parsed.authExpiresAt ?? parsedExpiresAt);
    const parsedMaxActions = Number(parsed.maxActions);
    const parsedUsedActions = Number(parsed.usedActions);
    const maxActions =
      Number.isFinite(parsedMaxActions) && parsedMaxActions > 0
        ? Math.floor(parsedMaxActions)
        : DEFAULT_SESSION_MAX_ACTIONS;
    const usedActions =
      Number.isFinite(parsedUsedActions) && parsedUsedActions >= 0
        ? Math.floor(parsedUsedActions)
        : 0;
    const parsedAuthAction =
      parsed.authAction === "open" ||
      parsed.authAction === "deposit" ||
      parsed.authAction === "withdraw"
        ? parsed.authAction
        : null;
    return {
      ...parsed,
      sessionVersion: parsed.sessionVersion === "v2" ? "v2" : "v1",
      scopeAllMarkets:
        typeof parsed.scopeAllMarkets === "boolean" ? parsed.scopeAllMarkets : false,
      authScope:
        typeof parsed.authScope === "string" && parsed.authScope.length > 0
          ? parsed.authScope
          : "__legacy__",
      authAction: parsedAuthAction ?? "open",
      expiresAt: parsedExpiresAt,
      authExpiresAt: Number.isFinite(parsedAuthExpiresAt)
        ? Math.floor(parsedAuthExpiresAt)
        : parsedExpiresAt,
      maxActions,
      usedActions: Math.min(usedActions, maxActions),
      collateralDelegateApproved:
        typeof parsed.collateralDelegateApproved === "boolean"
          ? parsed.collateralDelegateApproved
          : false,
    } as SessionRelayInfo;
  } catch {
    return null;
  }
}

function computeSessionDelegateAllowanceRaw(session: Pick<SessionRelayInfo, "maxActions" | "maxMarginPerActionRaw">): BN {
  const marginPerAction = new BN(session.maxMarginPerActionRaw, 10);
  const maxActionsBn = new BN(session.maxActions.toString(), 10);
  const raw = marginPerAction.mul(maxActionsBn);
  if (raw.isNeg() || raw.isZero()) return marginPerAction;
  return raw.gt(U64_MAX_BN) ? U64_MAX_BN : raw;
}

function readStoredSession(owner?: string, market?: string): SessionRelayInfo | null {
  if (typeof window === "undefined") return null;
  if (owner && market) {
    const keyed = parseSession(window.localStorage.getItem(storageKey(owner, market)));
    if (keyed) {
      return keyed;
    }

    const globalSession = parseSession(
      window.localStorage.getItem(storageKey(owner, ALL_MARKETS_SESSION_KEY))
    );
    if (globalSession && globalSession.scopeAllMarkets) {
      return globalSession;
    }

    // Legacy migration: single-session storage key.
    const legacy = parseSession(window.localStorage.getItem(RELAY_SESSION_STORAGE_KEY));
    if (legacy && legacy.owner === owner && legacy.market === market) {
      writeStoredSession(legacy);
      window.localStorage.removeItem(RELAY_SESSION_STORAGE_KEY);
      return {
        ...legacy,
        authSignature: "",
        authExpiresAt: legacy.expiresAt,
      };
    }
    return null;
  }

  // Fallback for callers without owner/market.
  const legacy = parseSession(window.localStorage.getItem(RELAY_SESSION_STORAGE_KEY));
  if (legacy) {
    return {
      ...legacy,
      authSignature: "",
      authExpiresAt: legacy.expiresAt,
    };
  }
  return null;
}

export function getStoredRelaySession(owner?: string, market?: string): SessionRelayInfo | null {
  return readStoredSession(owner, market);
}

function sanitizeSessionForStorage(session: SessionRelayInfo): SessionRelayInfo {
  // Auth signature is a scoped, expiring message signature (not a private key).
  // Persisting it avoids redundant wallet popups when the session is restored.
  return { ...session };
}

function writeStoredSession(session: SessionRelayInfo): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    storageKey(session.owner, sessionStorageMarketKey(session)),
    JSON.stringify(sanitizeSessionForStorage(session))
  );
}

function persistSession(session: SessionRelayInfo): void {
  if (typeof window === "undefined") return;
  try {
    writeStoredSession(session);
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
    if (market !== ALL_MARKETS_SESSION_KEY) {
      window.localStorage.removeItem(storageKey(owner, ALL_MARKETS_SESSION_KEY));
    }
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
  if (!sessionSupportsMarket(session, market)) return false;
  if (session.authScope !== RELAY_SESSION_AUTH_SCOPE) return false;
  if (session.expiresAt - nowSeconds <= RELAY_SESSION_RENEW_BEFORE_SECONDS) return false;
  if (session.usedActions >= session.maxActions) return false;
  return true;
}

function hasUsableRelayAuth(
  session: SessionRelayInfo,
  action: RelaySessionAction,
  nowSeconds: number
): boolean {
  if (session.authScope !== RELAY_SESSION_AUTH_SCOPE) return false;
  if (session.authAction !== action) return false;
  if (typeof session.authSignature !== "string" || session.authSignature.length === 0) return false;
  if (!Number.isFinite(session.authExpiresAt)) return false;
  if (session.authExpiresAt - nowSeconds <= RELAY_SESSION_RENEW_BEFORE_SECONDS) return false;
  if (session.authExpiresAt > session.expiresAt) return false;
  return true;
}

function wasLikelyJustCreated(session: SessionRelayInfo, nowSeconds: number): boolean {
  const createdAt = Number(session.sessionId);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
  return nowSeconds - createdAt <= 90;
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
  const raw = (position as { pendingComputationAccount?: unknown } | null)?.pendingComputationAccount;
  if (!raw) return null;

  try {
    const pubkey = raw instanceof PublicKey ? raw : new PublicKey(raw as string);
    return pubkey.equals(PublicKey.default) ? null : pubkey;
  } catch {
    return null;
  }
}

function extractOpenCallbackFailureMessage(logs: string[], clusterOffset: number): string | null {
  if (!logs.some((line) => line.includes("Instruction: OpenPositionProbeBCallback"))) {
    return null;
  }

  const aborted = logs.find((line) => line.includes("AbortedComputation"));
  const invalidResult = logs.find((line) => line.includes("InvalidComputationResult"));

  if (aborted || invalidResult) {
    const stages = [
      aborted ? "AbortedComputation (6000)" : null,
      invalidResult ? "InvalidComputationResult (6010)" : null,
    ].filter(Boolean);
    return `Queued on Arcium cluster ${clusterOffset}, but the MPC callback already failed on-chain: ${stages.join(" -> ")}.`;
  }

  return `Queued on Arcium cluster ${clusterOffset}, but the MPC callback already failed on-chain.`;
}

async function diagnoseOpenCallbackFailure(
  connection: Connection,
  positionAddress: PublicKey,
  pendingComputationAddress: PublicKey | null,
  clusterOffset: number
): Promise<string | null> {
  const addresses = [pendingComputationAddress, positionAddress].filter(
    (address): address is PublicKey => !!address
  );
  const seen = new Set<string>();
  const signatures: { signature: string; blockTime: number }[] = [];

  for (const address of addresses) {
    try {
      const recent = await connection.getSignaturesForAddress(address, { limit: 8 }, "confirmed");
      for (const entry of recent) {
        if (seen.has(entry.signature)) continue;
        seen.add(entry.signature);
        signatures.push({
          signature: entry.signature,
          blockTime: entry.blockTime ?? 0,
        });
      }
    } catch {
      // Best-effort only. If RPC history lookup fails, fall back to the generic pending message.
    }
  }

  signatures.sort((a, b) => b.blockTime - a.blockTime);

  for (const { signature } of signatures.slice(0, 12)) {
    try {
      const tx = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      const logs = tx?.meta?.logMessages ?? [];
      if (!logs.length || !tx?.meta?.err) continue;
      const message = extractOpenCallbackFailureMessage(logs, clusterOffset);
      if (message) return message;
    } catch {
      // Ignore individual RPC misses and keep scanning.
    }
  }

  return null;
}

function attachTxContext(error: Error, txSignature: string, positionAddress: string): Error & {
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

function attachRelayOpenContext(
  error: Error,
  meta: {
    relayMessage?: string;
    debugId?: string;
    relayRuntime?: unknown;
  }
): Error & {
  relayMessage?: string;
  debugId?: string;
  relayRuntime?: unknown;
} {
  const withContext = error as Error & {
    relayMessage?: string;
    debugId?: string;
    relayRuntime?: unknown;
  };
  withContext.relayMessage = meta.relayMessage;
  withContext.debugId = meta.debugId;
  withContext.relayRuntime = meta.relayRuntime;
  return withContext;
}

export const useArciumPrivacy = ({ pairLabel }: { pairLabel?: string } = {}) => {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWalletCompat();
  const walletExecutionMode = useWalletExecutionMode();
  const isEmbeddedWalletMode = walletExecutionMode === "embedded";
  const publicKey = anchorWallet?.publicKey ?? null;
  const signMessage = anchorWallet?.signMessage;
  const clientRef = useRef<ReturnType<typeof createShadowPerpClient> | null>(null);

  const [status, setStatus] = useState<PrivacyStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const [relaySession, setRelaySessionRaw] = useState<SessionRelayInfo | null>(null);
  // In-memory auth cache — survives localStorage sanitization which wipes authSignature.
  const relayAuthRef = useRef<{
    sessionId: string;
    owner: string;
    market: string;
    authSignature: string;
    authAction: string;
    authExpiresAt: number;
  } | null>(null);

  const setRelaySession = useCallback((update: SessionRelayInfo | null | ((prev: SessionRelayInfo | null) => SessionRelayInfo | null)) => {
    setRelaySessionRaw((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      if (!next) {
        relayAuthRef.current = null;
        return next;
      }
      // If setting a session WITH auth, cache it in the ref.
      if (next.authSignature && next.authSignature.length > 0) {
        relayAuthRef.current = {
          sessionId: next.sessionId,
          owner: next.owner,
          market: next.market,
          authSignature: next.authSignature,
          authAction: next.authAction,
          authExpiresAt: next.authExpiresAt,
        };
        return next;
      }
      // If setting a session WITHOUT auth, restore from ref if it matches.
      const cached = relayAuthRef.current;
      if (
        cached &&
        cached.sessionId === next.sessionId &&
        cached.owner === next.owner &&
        cached.market === next.market &&
        cached.authSignature.length > 0
      ) {
        return {
          ...next,
          authSignature: cached.authSignature,
          authAction: cached.authAction as RelaySessionAction,
          authExpiresAt: cached.authExpiresAt,
        };
      }
      return next;
    });
  }, []);
  const [relayAvailable, setRelayAvailable] = useState<boolean>(false);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [relaySessionHydrated, setRelaySessionHydrated] = useState<boolean>(false);
  const [relaySessionState, setRelaySessionState] = useState<RelaySessionUiState>("idle");
  const [relaySessionMessage, setRelaySessionMessage] = useState<string>("Start delegated session");
  const [relaySessionCreating, setRelaySessionCreating] = useState<boolean>(false);
  const [relaySessionRecovering, setRelaySessionRecovering] = useState<boolean>(false);
  const [relaySessionOptimisticUntil, setRelaySessionOptimisticUntil] = useState<number>(0);
  const [relaySessionSeen, setRelaySessionSeen] = useState<boolean>(false);
  const [relaySessionClockMs, setRelaySessionClockMs] = useState<number>(() => Date.now());

  const getClient = useCallback(() => {
    if (!anchorWallet) return null;
    if (!clientRef.current) {
      clientRef.current = createShadowPerpClient(connection, anchorWallet);
    }
    return clientRef.current;
  }, [anchorWallet, connection]);

  // Resolve market address: use pairLabel's market PDA if known, otherwise default.
  const resolveMarketAddress = useCallback((ctx: ReturnType<typeof getClient>) => {
    if (!ctx) return null;
    const registry = ctx.runtime.marketRegistry as Record<string, import("@solana/web3.js").PublicKey> | undefined;
    if (pairLabel && registry && registry[pairLabel]) return registry[pairLabel];
    return ctx.runtime.marketAddress;
  }, [pairLabel]);

  const resolvePairLabelForMarket = useCallback(
    (
      ctx: ReturnType<typeof getClient>,
      marketAddress?: string | import("@solana/web3.js").PublicKey | null
    ): string | undefined => {
      if (!ctx) return pairLabel;
      const target =
        typeof marketAddress === "string"
          ? marketAddress
          : marketAddress?.toBase58();
      if (!target) return pairLabel;
      const registry =
        ctx.runtime.marketRegistry as
          | Record<string, import("@solana/web3.js").PublicKey>
          | undefined;
      if (!registry) return pairLabel;
      for (const [label, address] of Object.entries(registry)) {
        if (address.toBase58() === target) return label;
      }
      return pairLabel;
    },
    [pairLabel]
  );

  const resetStatus = useCallback(() => {
    setStatus("idle");
    setStatusMessage("");
    setLastSignature(null);
  }, []);

  const refreshRelayAvailability = useCallback(async () => {
    if (isEmbeddedWalletMode) {
      setRelayAvailable(false);
      setRelayError(null);
      return null;
    }
    try {
      const response = await fetch(relayUrl("/api/relay/session"));
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
  }, [isEmbeddedWalletMode]);

  const refreshRelaySession = useCallback(async (candidate?: SessionRelayInfo | null, forceInvalidate = false) => {
    if (isEmbeddedWalletMode) {
      setRelaySession(null);
      return null;
    }
    const current = candidate ?? relaySession;
    if (!current) return null;
    const currentOwner = current.owner;
    const ctx = getClient();
    const resolvedRuntimeMarket = ctx
      ? (resolveMarketAddress(ctx) ?? ctx.runtime.marketAddress).toBase58()
      : null;
    const currentMarket = current.scopeAllMarkets
      ? resolvedRuntimeMarket ?? current.market
      : current.market;
    if (!publicKey || current.owner !== publicKey.toBase58()) {
      setRelaySession(null);
      return null;
    }

    setRelaySessionRecovering(true);
    try {
      const query = new URLSearchParams({
        owner: current.owner,
        sessionId: current.sessionId,
      });
      const pair = resolvePairLabelForMarket(ctx, currentMarket);
      if (pair) {
        query.set("pair", pair);
      }
      const response = await fetch(relayUrl(`/api/relay/session?${query.toString()}`));
      const payload = await response.json().catch(() => null);
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (!response.ok || !payload?.ok || !payload?.available) {
        return current;
      }
      if (payload.exists === false) {
        if (
          !forceInvalidate && (
            isUsableRelaySession(current, currentOwner, currentMarket, nowSeconds) ||
            wasLikelyJustCreated(current, nowSeconds)
          )
        ) {
          return current;
        }
        setRelaySession(null);
        clearStoredSession(currentOwner, sessionStorageMarketKey(current));
        return null;
      }
      if (!payload.session) return current;
      const nextMaxActionsRaw = Number(payload.session.maxActions);
      const nextUsedActionsRaw = Number(payload.session.usedActions);
      const nextMaxActions =
        Number.isFinite(nextMaxActionsRaw) && nextMaxActionsRaw > 0
          ? Math.floor(nextMaxActionsRaw)
          : current.maxActions;
      const nextUsedActions =
        Number.isFinite(nextUsedActionsRaw) && nextUsedActionsRaw >= 0
          ? Math.floor(nextUsedActionsRaw)
          : current.usedActions;

      const next: SessionRelayInfo = {
        ...current,
        sessionVersion: payload.session.sessionVersion === "v2" ? "v2" : "v1",
        market: payload.session.scopeAllMarkets ? ALL_MARKETS_SESSION_KEY : currentMarket,
        scopeAllMarkets: Boolean(payload.session.scopeAllMarkets),
        relayer: payload.session.relayer,
        usedActions: Math.min(nextUsedActions, nextMaxActions),
        maxActions: nextMaxActions,
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
        clearStoredSession(current.owner, sessionStorageMarketKey(current));
        return null;
      }

      setRelaySession(next);
      persistSession(next);
      return next;
    } catch {
      return current;
    } finally {
      setRelaySessionRecovering(false);
    }
  }, [getClient, publicKey, relaySession, resolveMarketAddress, resolvePairLabelForMarket, isEmbeddedWalletMode]);

  const invalidateRelaySession = useCallback(
    (owner?: string, market?: string) => {
      const resolvedOwner = owner ?? relaySession?.owner;
      const resolvedMarket = market ?? relaySession?.market;
      if (resolvedOwner && resolvedMarket) {
        clearStoredSession(resolvedOwner, resolvedMarket);
      }
      setRelaySessionOptimisticUntil(0);
      setRelaySession((current) => {
        if (!current) return null;
        if (resolvedOwner && current.owner !== resolvedOwner) return current;
        if (resolvedMarket && !sessionSupportsMarket(current, resolvedMarket)) return current;
        return null;
      });
    },
    [relaySession]
  );

  const ensureCollateralDelegateApproval = useCallback(
    async (
      session: SessionRelayInfo,
      runtimeMarketAddress?: PublicKey
    ): Promise<SessionRelayInfo> => {
      if (session.collateralDelegateApproved) return session;

      const ctx = getClient();
      if (!ctx) {
        throw new Error("Trading client unavailable. Check wallet + env.");
      }
      const marketAddress = runtimeMarketAddress ?? ctx.runtime.marketAddress;
      const allowanceRaw = computeSessionDelegateAllowanceRaw(session);

      setStatus("verifying");
      setStatusMessage("Granting delegated collateral allowance...");
      const approveSignature = await ctx.client.approveCollateralDelegate(
        marketAddress,
        new PublicKey(session.relayer),
        allowanceRaw
      );
      setLastSignature(approveSignature);

      const next: SessionRelayInfo = {
        ...session,
        collateralDelegateApproved: true,
      };
      setRelaySession(next);
      persistSession(next);
      return next;
    },
    [getClient]
  );

  const ensureRelaySessionAuth = useCallback(
    async (
      session: SessionRelayInfo,
      action: RelaySessionAction,
      userInitiated = false
    ): Promise<SessionRelayInfo> => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (hasUsableRelayAuth(session, action, nowSeconds)) {
        return session;
      }
      if (!userInitiated) {
        return session;
      }
      if (!signMessage) {
        throw new Error("Wallet does not support message signing.");
      }

      setStatus("preparing");
      setStatusMessage("Authorizing delegated trading session...");
      const authMessage = buildRelaySessionAuthMessage({
        owner: session.owner,
        market: sessionStorageMarketKey(session),
        sessionId: session.sessionId,
        action,
        sessionExpiresAt: session.expiresAt,
        authExpiresAt: session.expiresAt,
      });
      const signature = await signMessage(new TextEncoder().encode(authMessage));

      const next: SessionRelayInfo = {
        ...session,
        authScope: RELAY_SESSION_AUTH_SCOPE,
        authAction: action,
        authExpiresAt: session.expiresAt,
        authSignature: uint8ToBase64(signature),
      };
      setRelaySession(next);
      persistSession(next);
      return next;
    },
    [signMessage]
  );

  const maybeEnsureCollateralForReason = useCallback(
    async (
      session: SessionRelayInfo,
      reason: EnsureRelaySessionOptions["reason"],
      runtimeMarketAddress?: PublicKey
    ): Promise<SessionRelayInfo> => {
      if (reason !== "deposit") {
        return session;
      }
      return ensureCollateralDelegateApproval(session, runtimeMarketAddress);
    },
    [ensureCollateralDelegateApproval]
  );

  const recoverLatestRelaySession = useCallback(
    async (userInitiatedAuth = false): Promise<SessionRelayInfo | null> => {
      if (isEmbeddedWalletMode) return null;
      if (!publicKey) return null;
      const ctx = getClient();
      if (!ctx) return null;

      const owner = publicKey.toBase58();
      const resolvedMarket = resolveMarketAddress(ctx);
      if (!resolvedMarket) return null;
      const market = resolvedMarket.toBase58();
      const nowSeconds = Math.floor(Date.now() / 1000);
      setRelaySessionRecovering(true);
      try {
        const query = new URLSearchParams({ owner });
        if (pairLabel) query.set("pair", pairLabel);
        const response = await fetch(relayUrl(`/api/relay/session?${query.toString()}`));
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok || !payload?.available || payload.exists === false || !payload.session) {
          return null;
        }

        const maxActionsRaw = Number(payload.session.maxActions);
        const usedActionsRaw = Number(payload.session.usedActions);
        const maxActions =
          Number.isFinite(maxActionsRaw) && maxActionsRaw > 0
            ? Math.floor(maxActionsRaw)
            : DEFAULT_SESSION_MAX_ACTIONS;
        const usedActions =
          Number.isFinite(usedActionsRaw) && usedActionsRaw >= 0
            ? Math.floor(usedActionsRaw)
            : 0;
        const sessionId = String(payload.session.sessionId);
        const expiresAt = Number(payload.session.expiresAt);

        const sessionVersion = payload.session.sessionVersion === "v2" ? "v2" : "v1";
        const scopeAllMarkets = Boolean(payload.session.scopeAllMarkets);
        const sessionAddress =
          sessionVersion === "v2"
            ? ctx.client
                .getTradeSessionV2Address(new PublicKey(owner), new BN(sessionId, 10))
                .toBase58()
            : ctx.client
                .getTradeSessionAddress(
                  resolvedMarket,
                  new PublicKey(owner),
                  new BN(sessionId, 10)
                )
                .toBase58();

        const stored = readStoredSession(owner, market);
        const candidate: SessionRelayInfo = {
          sessionVersion,
          owner,
          market: scopeAllMarkets ? ALL_MARKETS_SESSION_KEY : market,
          scopeAllMarkets,
          relayer: payload.session.relayer,
          sessionId,
          sessionAddress,
          authScope:
            typeof stored?.authScope === "string" && stored.authScope.length > 0
              ? stored.authScope
              : RELAY_SESSION_AUTH_SCOPE,
          authAction:
            stored?.authAction === "open" ||
            stored?.authAction === "deposit" ||
            stored?.authAction === "withdraw"
              ? stored.authAction
              : actionFromReason("trade"),
          expiresAt,
          authExpiresAt:
            Number.isFinite(stored?.authExpiresAt)
              ? Math.floor(stored!.authExpiresAt)
              : expiresAt,
          maxActions,
          usedActions: Math.min(usedActions, maxActions),
          maxMarginPerActionRaw: payload.session.maxMarginPerAction,
          authSignature: typeof stored?.authSignature === "string" ? stored.authSignature : "",
          collateralDelegateApproved:
            typeof stored?.collateralDelegateApproved === "boolean"
              ? stored.collateralDelegateApproved
              : false,
        };

        if (!isUsableRelaySession(candidate, owner, market, nowSeconds)) {
          return null;
        }

        const authed = await ensureRelaySessionAuth(
          candidate,
          actionFromReason("trade"),
          userInitiatedAuth
        );
        setRelaySession(authed);
        persistSession(authed);
        return authed;
      } catch {
        return null;
      } finally {
        setRelaySessionRecovering(false);
      }
    },
    [publicKey, getClient, resolveMarketAddress, pairLabel, ensureRelaySessionAuth, isEmbeddedWalletMode]
  );

  const createRelaySession = useCallback(
    async (options?: EnsureRelaySessionOptions) => {
      if (isEmbeddedWalletMode) {
        throw new Error(
          "Privy embedded wallets sign directly and do not use delegated trading sessions."
        );
      }
      setRelaySessionCreating(true);
      try {
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

        const { client } = ctx;
        const resolvedMarket = resolveMarketAddress(ctx)!;
        const owner = publicKey.toBase58();
        const marketAddress = resolvedMarket.toBase58();
        const nowSeconds = Math.floor(Date.now() / 1000);
        const existing =
          relaySession ??
          readStoredSession(owner, marketAddress);
        const reason = options?.reason ?? "trade";
        if (isUsableRelaySession(existing, owner, marketAddress, nowSeconds)) {
          const authed = await ensureRelaySessionAuth(
            existing,
            actionFromReason(reason),
            Boolean(options?.userInitiated)
          );
          const prepared = await maybeEnsureCollateralForReason(
            authed,
            reason,
            resolvedMarket
          );
          setRelaySession(prepared);
          return prepared;
        }

        const sessionId = new BN(Math.floor(Date.now() / 1000));
        const duration = options?.durationSeconds ?? DEFAULT_TRADE_SESSION_DURATION_SECONDS;
        const expiresAt = Math.floor(Date.now() / 1000) + duration;
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
          market: ALL_MARKETS_SESSION_KEY,
          sessionId: sessionId.toString(),
          action: actionFromReason(reason),
          sessionExpiresAt: expiresAt,
          authExpiresAt: expiresAt,
        });
        const signature = await signMessage(new TextEncoder().encode(authMessage));

        setStatus("queued");
        setStatusMessage("Creating delegated session on-chain...");

        const sessionAddress = client.getTradeSessionV2Address(publicKey, sessionId);
        let txSignature: string;
        try {
          const result = await client.createTradeSessionV2(
            sessionId,
            new PublicKey(relayInfo.relayer),
            maxActions,
            maxMarginPerAction,
            new BN(expiresAt)
          );
          txSignature = result.txSignature;
        } catch (createErr: any) {
          const msg: string = createErr?.message ?? "";
          const alreadyExists =
            msg.includes("already been processed") ||
            msg.includes("already in use") ||
            msg.includes("custom program error: 0x0");
          if (!alreadyExists) throw createErr;
          // Session PDA already on-chain — verify it's still usable before reusing.
          const existing = await client.getTradeSessionV2(sessionAddress);
          const nowSec = Math.floor(Date.now() / 1000);
          if (
            existing.revoked ||
            Number(existing.expiresAt.toString()) <= nowSec ||
            existing.usedActions >= existing.maxActions
          ) {
            throw new Error("Session already exists but is expired or exhausted. Try again.");
          }
          txSignature = "";
        }
        if (txSignature) setLastSignature(txSignature);

        const nextSession: SessionRelayInfo = {
          sessionVersion: "v2",
          owner,
          market: ALL_MARKETS_SESSION_KEY,
          scopeAllMarkets: true,
          relayer: relayInfo.relayer,
          sessionId: sessionId.toString(),
          sessionAddress: sessionAddress.toBase58(),
          authScope: RELAY_SESSION_AUTH_SCOPE,
          authAction: actionFromReason(reason),
          expiresAt,
          authExpiresAt: expiresAt,
          maxActions,
          usedActions: 0,
          maxMarginPerActionRaw: maxMarginPerAction.toString(),
          authSignature: uint8ToBase64(signature),
          collateralDelegateApproved: false,
        };
        const preparedSession = await maybeEnsureCollateralForReason(
          nextSession,
          reason,
          resolvedMarket
        );
        setRelaySession(preparedSession);
        persistSession(preparedSession);
        setRelaySessionOptimisticUntil(Date.now() + RELAY_SESSION_OPTIMISTIC_HOLD_MS);
        setStatus("verified");
        setStatusMessage("Delegated session active. New trades can run without wallet popups.");

        return preparedSession;
      } finally {
        setRelaySessionCreating(false);
      }
    },
    [
      publicKey,
      signMessage,
      getClient,
      resolveMarketAddress,
      refreshRelayAvailability,
      relayError,
      relaySession,
      ensureRelaySessionAuth,
      maybeEnsureCollateralForReason,
      isEmbeddedWalletMode,
    ]
  );

  const ensureRelaySession = useCallback(
    async (options?: EnsureRelaySessionOptions) => {
      if (isEmbeddedWalletMode) {
        throw new Error(
          "Privy embedded wallets sign directly and do not use delegated trading sessions."
        );
      }
      const ctx = getClient();
      const owner = publicKey?.toBase58();
      const resolvedCtxMarket = ctx ? resolveMarketAddress(ctx) : null;
      const market = resolvedCtxMarket?.toBase58();
      const nowSeconds = Math.floor(Date.now() / 1000);
      const reason = options?.reason ?? "trade";
      const userInitiated = Boolean(options?.userInitiated);

      const finalize = async (session: SessionRelayInfo): Promise<SessionRelayInfo> => {
        const authed = await ensureRelaySessionAuth(
          session,
          actionFromReason(reason),
          userInitiated
        );
        return maybeEnsureCollateralForReason(
          authed,
          reason,
          resolvedCtxMarket ?? undefined
        );
      };

      if (isUsableRelaySession(relaySession, owner, market, nowSeconds)) {
        return finalize(relaySession);
      }

      const stored = owner && market ? readStoredSession(owner, market) : null;
      if (isUsableRelaySession(stored, owner, market, nowSeconds)) {
        setRelaySession(stored);
        return finalize(stored);
      }

      const refreshed = await refreshRelaySession(stored ?? undefined);
      if (isUsableRelaySession(refreshed, owner, market, nowSeconds)) {
        return finalize(refreshed);
      }

      const recovered = await recoverLatestRelaySession(userInitiated);
      if (isUsableRelaySession(recovered, owner, market, nowSeconds)) {
        return finalize(recovered);
      }

      if (stored && owner) {
        clearStoredSession(owner, sessionStorageMarketKey(stored));
      }

      if (!userInitiated) {
        throw new Error(
          "Delegated session missing. Session creation is blocked unless triggered by an explicit user action."
        );
      }

      return createRelaySession(options);
    },
    [
      createRelaySession,
      getClient,
      resolveMarketAddress,
      ensureRelaySessionAuth,
      maybeEnsureCollateralForReason,
      publicKey,
      refreshRelaySession,
      recoverLatestRelaySession,
      relaySession,
      isEmbeddedWalletMode,
    ]
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
        if (current.sessionVersion === "v2") {
          await ctx.client.revokeTradeSessionV2(new BN(current.sessionId, 10));
        } else {
          await ctx.client.revokeTradeSession(
            resolveMarketAddress(ctx) ?? ctx.runtime.marketAddress,
            new BN(current.sessionId, 10)
          );
        }
      }

      // On-chain tx confirmed — session is definitively gone. Clear all local state
      // without querying the relay (relay may lag behind the confirmed tx).
      setRelaySession(null);
      setRelaySessionSeen(false);
      setRelaySessionOptimisticUntil(0);
      clearStoredSession(current.owner, sessionStorageMarketKey(current));
    },
    [relaySession, getClient, resolveMarketAddress]
  );

  useEffect(() => {
    void refreshRelayAvailability();
  }, [refreshRelayAvailability]);

  useEffect(() => {
    let cancelled = false;
    setRelaySessionHydrated(false);
    const ctx = getClient();
    if (isEmbeddedWalletMode) {
      setRelaySession(null);
      setRelaySessionHydrated(true);
      return;
    }
    if (!publicKey || !ctx) {
      setRelaySession(null);
      setRelaySessionHydrated(true);
      return;
    }

    const owner = publicKey.toBase58();
    const market = (resolveMarketAddress(ctx) ?? ctx.runtime.marketAddress).toBase58();
    const stored = readStoredSession(owner, market);
    if (!stored) {
      setRelaySession(null);
      setRelaySessionHydrated(true);
      void (async () => {
        const recovered = await recoverLatestRelaySession(false);
        if (cancelled || !recovered) return;
        setRelaySession(recovered);
      })();
      return;
    }

    if (isUsableRelaySession(stored, owner, market, Math.floor(Date.now() / 1000))) {
      setRelaySession(stored);
      setRelaySessionHydrated(true);
      return;
    }

    setRelaySession(null);
    setRelaySessionHydrated(true);
    void (async () => {
      const recovered = await recoverLatestRelaySession(false);
      if (cancelled) return;
      if (recovered) {
        setRelaySession(recovered);
        return;
      }
      clearStoredSession(owner, sessionStorageMarketKey(stored));
    })();

    return () => {
      cancelled = true;
    };
  }, [getClient, publicKey, recoverLatestRelaySession, isEmbeddedWalletMode]);

  useEffect(() => {
    if (relaySession) {
      setRelaySessionSeen(true);
    }
  }, [relaySession]);

  useEffect(() => {
    if (publicKey) return;
    setRelaySessionSeen(false);
    setRelaySessionOptimisticUntil(0);
  }, [publicKey]);

  useEffect(() => {
    const id = window.setInterval(() => setRelaySessionClockMs(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const owner = publicKey?.toBase58();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const optimisticActive = relaySessionClockMs < relaySessionOptimisticUntil;
    const isActive =
      !!relaySession &&
      relaySession.owner === owner &&
      relaySession.usedActions < relaySession.maxActions &&
      (relaySession.expiresAt - nowSeconds > RELAY_SESSION_RENEW_BEFORE_SECONDS ||
        optimisticActive);

    if (!publicKey) {
      setRelaySessionState("idle");
      setRelaySessionMessage("Connect wallet to start delegated session");
      return;
    }

    if (isEmbeddedWalletMode) {
      setRelaySessionState("idle");
      setRelaySessionMessage("Embedded wallet signs directly");
      return;
    }

    if (relaySessionCreating) {
      setRelaySessionState("creating");
      setRelaySessionMessage("Creating delegated session...");
      return;
    }

    if (isActive) {
      setRelaySessionState("active");
      setRelaySessionMessage("Delegated session active");
      return;
    }

    if (relaySessionRecovering) {
      setRelaySessionState("reconnecting");
      setRelaySessionMessage("Reconnecting delegated session...");
      return;
    }

    if (relaySessionHydrated && relaySessionSeen) {
      setRelaySessionState("expired");
      setRelaySessionMessage(
        relayAvailable ? "Delegated session expired" : "Relay unavailable"
      );
      return;
    }

    setRelaySessionState("idle");
    setRelaySessionMessage(
      relayAvailable ? "Start delegated session" : "Relay unavailable"
    );
  }, [
    publicKey,
    relaySession,
    relaySessionCreating,
    relaySessionRecovering,
    relaySessionHydrated,
    relaySessionClockMs,
    relaySessionOptimisticUntil,
    relaySessionSeen,
    relayAvailable,
    isEmbeddedWalletMode,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncFromStorage = () => {
      const ctx = getClient();
      const owner = publicKey?.toBase58();
      if (!ctx || !owner) {
        setRelaySession(null);
        return;
      }
      const market = (resolveMarketAddress(ctx) ?? ctx.runtime.marketAddress).toBase58();
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
      isPrivate: boolean,
      options?: PrivateOrderSubmitOptions
    ): Promise<{ txSignature: string; positionAddress: string; usedPrivatePath: boolean }> => {
      const ctx = getClient();
      if (!ctx) {
        throw new Error("Connect a compatible wallet and ensure runtime env vars are configured.");
      }

      const { client } = ctx;
      const orderMarket = resolveMarketAddress(ctx)!;
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

      if (isEmbeddedWalletMode) {
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
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      let activeRelaySession: SessionRelayInfo | null =
        isUsableRelaySession(
          relaySession,
          anchorWallet?.publicKey?.toBase58(),
          orderMarket.toBase58(),
          nowSeconds
        )
          ? relaySession
          : null;

      if (!activeRelaySession) {
        const ensured = await ensureRelaySession({
          reason: "trade",
          userInitiated: true,
        });
        if (
          isUsableRelaySession(
            ensured,
            anchorWallet?.publicKey?.toBase58(),
            orderMarket.toBase58(),
            Math.floor(Date.now() / 1000)
          )
        ) {
          activeRelaySession = ensured;
        }
      }

      if (!activeRelaySession) {
        throw new Error(
          "Delegated session required. Please sign a new session to continue trading."
        );
      }

      // Restore auth from in-memory cache if localStorage wiped it.
      const cachedAuth = relayAuthRef.current;
      if (
        cachedAuth &&
        cachedAuth.sessionId === activeRelaySession.sessionId &&
        cachedAuth.owner === activeRelaySession.owner &&
        cachedAuth.market === activeRelaySession.market &&
        cachedAuth.authSignature.length > 0
      ) {
        activeRelaySession = {
          ...activeRelaySession,
          authSignature: cachedAuth.authSignature,
          authAction: cachedAuth.authAction as RelaySessionAction,
          authExpiresAt: cachedAuth.authExpiresAt,
        };
      }

      // If still no valid auth, request a new signature.
      if (!hasUsableRelayAuth(activeRelaySession, "open", Math.floor(Date.now() / 1000))) {
        activeRelaySession = await ensureRelaySessionAuth(activeRelaySession, "open", true);
      }

      setStatus("queued");
      setStatusMessage("Queued on Arcium cluster via delegated session...");

      const response = await fetch(relayUrl("/api/relay/open"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: activeRelaySession.owner,
          sessionId: activeRelaySession.sessionId,
          side: order.side,
          marginMode: order.marginMode ?? "cross",
          leverage: order.leverage,
          sizeRaw: sizeBase.toString(),
          entryPriceRaw: entryPrice.toString(),
          marginRaw: marginBase.toString(),
          pairLabel: order.pairLabel ?? "SOL-USD",
          auth: {
            action: "open",
            expiresAt: activeRelaySession.authExpiresAt,
            signature: activeRelaySession.authSignature,
          },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        const message =
          payload?.error || `Delegated session submit failed (${response.status}).`;
        if (payload?.runtime || payload?.debugId) {
          console.warn("[relay/open:client]", {
            status: response.status,
            error: message,
            debugId: payload?.debugId,
            runtime: payload?.runtime ?? null,
          });
        }
        if (
          typeof message === "string" &&
          isSessionInvalidError(message)
        ) {
          invalidateRelaySession(activeRelaySession.owner, activeRelaySession.market);
          throw new Error(
            "Your trading session is no longer valid. Please start a new session and try again."
          );
        }
        throw attachRelayOpenContext(new Error(message), {
          relayMessage: message,
          debugId: typeof payload?.debugId === "string" ? payload.debugId : undefined,
          relayRuntime: payload?.runtime,
        });
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
      options?.onProgress?.({
        stage: "queued",
        txSignature,
        positionAddress,
      });

      setStatus("verifying");
      setStatusMessage("Awaiting MPC callback finalization...");
      try {
        await waitForOpenPositionCallback(
          connection,
          client,
          new PublicKey(positionAddress),
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
        throw attachTxContext(message, txSignature, positionAddress);
      }
      setStatus("verified");
      setStatusMessage("MPC callback finalized. Position opened.");

      return {
        txSignature,
        positionAddress,
        usedPrivatePath: true,
      };
    },
    [getClient, resolveMarketAddress, relaySession, anchorWallet, ensureRelaySession, invalidateRelaySession, connection, isEmbeddedWalletMode]
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
    relaySessionHydrated,
    relaySessionState,
    relaySessionMessage,
    createRelaySession,
    ensureRelaySession,
    invalidateRelaySession,
    revokeRelaySession,
    refreshRelaySession,
  };
};
