"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getExplorerTxUrl } from "../lib/explorer";

export type TradeStep =
  | "signing"
  | "encrypting"
  | "submitting"
  | "verifying"
  | "confirmed"
  | "error";

interface TradeConfirmationModalProps {
  isOpen: boolean;
  step: TradeStep;
  direction: "long" | "short";
  size: string;
  leverage: number;
  entryPrice: number | null;
  errorMessage?: string;
  txSignature?: string;
  onClose: () => void;
  onRetry?: () => void;
}

const STEPS: { key: TradeStep; label: string; icon: string }[] = [
  { key: "signing",    label: "Signing",    icon: "✍️" },
  { key: "encrypting", label: "Encrypting", icon: "🔒" },
  { key: "submitting", label: "Submitting", icon: "📡" },
  { key: "verifying",  label: "Finalizing", icon: "⚙️" },
  { key: "confirmed",  label: "Confirmed",  icon: "✓"  },
];

const TERMINAL_AUTO_DISMISS_MS = 5_000;
const QUEUED_PERSIST_KEY       = "shadow-queued-tx";

function stepIndex(step: TradeStep): number {
  if (step === "error") return -1;
  return STEPS.findIndex((s) => s.key === step);
}

function isRetryableError(msg: string | undefined): boolean {
  const m = msg ?? "";
  // 6204 = Arcium AlreadyCallbackedComputation — original callback already
  // settled the trade. Retrying would create a duplicate computation. Refresh,
  // do not retry.
  if (
    /AlreadyCallbackedComputation/i.test(m) ||
    /Callback computation already called/i.test(m) ||
    /already settled on-chain/i.test(m)
  ) {
    return false;
  }
  // MPC aborts are safe to retry: the program callback resets the position
  // to a clean state (open: Closed with no margin lock, close: back to Open),
  // and a fresh executeOpen() generates a new computation_offset and nonce.
  if (
    /callback already failed on-chain/i.test(m) ||
    /resolved to Closed instead of Open/i.test(m) ||
    /unexpected status Closed/i.test(m) ||
    /AbortedComputation/i.test(m) ||
    /InvalidComputationResult/i.test(m)
  ) {
    return true;
  }
  if (
    /Oracle is stale/i.test(m) ||
    /Insufficient oracle sources/i.test(m) ||
    /Price feed catching up/i.test(m) ||
    /timeout/i.test(m) ||
    /timed out/i.test(m) ||
    /finalization/i.test(m) ||
    /network/i.test(m) ||
    /blockhash/i.test(m) ||
    /429/i.test(m) ||
    /rate limit/i.test(m)
  ) {
    return true;
  }
  // Hard failures that won't change on retry
  if (
    /Insufficient margin/i.test(m) ||
    /InsufficientMargin/i.test(m) ||
    /User rejected/i.test(m) ||
    /Transaction cancelled/i.test(m) ||
    /ConstraintAddress/i.test(m) ||
    /Account not initialized/i.test(m) ||
    /missing account/i.test(m) ||
    /env var/i.test(m)
  ) {
    return false;
  }
  return false;
}

function humanError(msg: string | undefined, hasQueuedTx: boolean): {
  headline: string;
  hint: string;
  detail?: string;
} {
  const m = msg?.trim() ?? "";

  if (!m) {
    return {
      headline: hasQueuedTx ? "Still processing" : "Something went wrong",
      hint: hasQueuedTx
        ? "Your order is in the queue — check back in a moment."
        : "The order didn't go through. Try again.",
    };
  }

  if (
    /AlreadyCallbackedComputation/i.test(m) ||
    /Callback computation already called/i.test(m) ||
    /already settled on-chain/i.test(m)
  ) {
    return {
      headline: "Already settled",
      hint: "This order already settled on-chain. Refresh to see the latest state.",
      detail: m,
    };
  }

  if (
    /callback already failed on-chain/i.test(m) ||
    /resolved to Closed instead of Open/i.test(m) ||
    /AbortedComputation/i.test(m) ||
    /InvalidComputationResult/i.test(m)
  ) {
    return {
      headline: "Order cancelled by MPC",
      hint: "The MPC cluster rejected this order. Your funds are safe and nothing was debited.",
      detail: m,
    };
  }

  if (/Oracle is stale/i.test(m) || /Insufficient oracle sources/i.test(m) || /invalid price NaN/i.test(m)) {
    return {
      headline: "Price feed catching up",
      hint: "Shadow needs a fresh price before sending the order. Wait a few seconds and retry.",
      detail: m,
    };
  }

  if (/insufficient margin/i.test(m) || /InsufficientMargin/i.test(m)) {
    return {
      headline: "Not enough margin",
      hint: "Reduce your size or deposit more collateral before retrying.",
      detail: m,
    };
  }

  if (/Transaction failed with error code 1\b/i.test(m)) {
    return {
      headline: "Insufficient token balance",
      hint: "Your wallet may not have enough mUSDC to cover the margin. Tap Faucet to top up, then retry.",
      detail: m,
    };
  }

  if (/Transaction failed with error code 3007/i.test(m) || /ConstraintAddress/i.test(m)) {
    return {
      headline: "Market not ready",
      hint: "This trading pair is still being set up on-chain. Try SOL-USD for now.",
      detail: m,
    };
  }

  if (hasQueuedTx) {
    return {
      headline: "Queued but not settled",
      hint: "Your order made it to the network but settlement is taking longer than expected.",
      detail: m,
    };
  }

  return {
    headline: "Order didn't go through",
    hint: "Something went wrong on this attempt. Your funds are safe — retry when ready.",
    detail: m,
  };
}

export default function TradeConfirmationModal({
  isOpen,
  step,
  direction,
  size,
  leverage,
  entryPrice,
  errorMessage,
  txSignature,
  onClose,
  onRetry,
}: TradeConfirmationModalProps) {
  const [mounted,       setMounted]       = useState(false);
  const [visible,       setVisible]       = useState(false);
  const [minimized,     setMinimized]     = useState(false);
  const [detailOpen,    setDetailOpen]    = useState(false);
  const [dismissPct,    setDismissPct]    = useState(0);
  const [verifyElapsed, setVerifyElapsed] = useState(0);

  const dismissRafRef     = useRef<number | null>(null);
  const dismissTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissStartRef   = useRef<number | null>(null);
  const verifyIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const verifyStartRef    = useRef<number | null>(null);
  const hoverRef          = useRef(false);

  const clearDismiss = useCallback(() => {
    if (dismissTimerRef.current)  { clearTimeout(dismissTimerRef.current);        dismissTimerRef.current  = null; }
    if (dismissRafRef.current)    { cancelAnimationFrame(dismissRafRef.current);  dismissRafRef.current    = null; }
    dismissStartRef.current = null;
    setDismissPct(0);
  }, []);

  const scheduleDismiss = useCallback(() => {
    clearDismiss();
    const start = performance.now();
    dismissStartRef.current = start;
    const tick = (now: number) => {
      const pct = Math.min(100, ((now - start) / TERMINAL_AUTO_DISMISS_MS) * 100);
      setDismissPct(pct);
      if (pct < 100) dismissRafRef.current = requestAnimationFrame(tick);
    };
    dismissRafRef.current = requestAnimationFrame(tick);
    dismissTimerRef.current = setTimeout(onClose, TERMINAL_AUTO_DISMISS_MS);
  }, [clearDismiss, onClose]);

  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setVisible(true));
      setMinimized(false);
      setDetailOpen(false);
      setDismissPct(0);
    } else {
      setVisible(false);
      setMinimized(false);
      setVerifyElapsed(0);
      clearDismiss();
      if (verifyIntervalRef.current) { clearInterval(verifyIntervalRef.current); verifyIntervalRef.current = null; }
    }
  }, [isOpen, clearDismiss]);

  // Verifying elapsed counter
  useEffect(() => {
    if (isOpen && step === "verifying") {
      verifyStartRef.current = Date.now();
      setVerifyElapsed(0);
      verifyIntervalRef.current = setInterval(() => {
        setVerifyElapsed(Math.floor((Date.now() - (verifyStartRef.current ?? Date.now())) / 1000));
      }, 1000);
    } else {
      if (verifyIntervalRef.current) { clearInterval(verifyIntervalRef.current); verifyIntervalRef.current = null; }
    }
  }, [isOpen, step]);

  // Auto-minimize then auto-dismiss on terminal states
  useEffect(() => {
    if (!isOpen) return;
    const isTerminal = step === "confirmed" || step === "error";
    if (!isTerminal) { clearDismiss(); return; }
    if (!hoverRef.current) scheduleDismiss();
  }, [isOpen, step, clearDismiss, scheduleDismiss]);

  useEffect(() => () => { clearDismiss(); }, [clearDismiss]);

  useEffect(() => {
    if (txSignature && step === "error") {
      try { localStorage.setItem(QUEUED_PERSIST_KEY, txSignature); } catch {}
    }
    if (step === "confirmed") {
      try { localStorage.removeItem(QUEUED_PERSIST_KEY); } catch {}
    }
  }, [txSignature, step]);

  if (!isOpen || !mounted) return null;

  const currentIdx  = stepIndex(step);
  const isError     = step === "error";
  const isComplete  = step === "confirmed";
  const isTerminal  = isError || isComplete;
  const isLong      = direction === "long";
  const hasQueuedTx = Boolean(txSignature);
  const canRetry    = isError && isRetryableError(errorMessage) && Boolean(onRetry);
  const error       = humanError(errorMessage, hasQueuedTx);

  const priceStr =
    entryPrice == null ? null
    : entryPrice < 0.01 ? entryPrice.toFixed(8)
    : entryPrice.toFixed(2);

  const handlePointerEnter = () => {
    hoverRef.current = true;
    clearDismiss();
    setMinimized(false);
  };
  const handlePointerLeave = () => {
    hoverRef.current = false;
    if (isTerminal) scheduleDismiss();
  };
  const handleRetry = () => {
    try { localStorage.removeItem(QUEUED_PERSIST_KEY); } catch {}
    onRetry?.();
  };

  // ── Minimized pill ──────────────────────────────────────────────────────────
  const pill = (
    <div className="fixed bottom-5 right-5 z-[650]">
      <button
        type="button"
        onClick={() => setMinimized(false)}
        onMouseEnter={handlePointerEnter}
        onMouseLeave={handlePointerLeave}
        className={`relative flex items-center gap-2.5 overflow-hidden rounded-full border px-4 py-2.5 shadow-xl backdrop-blur transition-all hover:-translate-y-0.5 ${
          isError
            ? "border-red-500/30 bg-shadow-800/95 shadow-red-500/10"
            : isComplete
            ? "border-emerald-500/30 bg-shadow-800/95 shadow-emerald-500/10"
            : "border-accent-purple/30 bg-shadow-800/95 shadow-purple-500/10"
        }`}
      >
        {isTerminal && dismissPct > 0 && (
          <span
            className={`pointer-events-none absolute bottom-0 left-0 h-[2px] ${isError ? "bg-red-500/50" : "bg-emerald-500/50"}`}
            style={{ width: `${100 - dismissPct}%` }}
          />
        )}
        <span className={`h-2 w-2 rounded-full flex-shrink-0 ${
          isError ? "bg-red-400 animate-pulse"
          : isComplete ? "bg-emerald-400"
          : "bg-accent-purple animate-pulse"
        }`} />
        <span className="text-[12px] font-medium text-white">
          {isError ? "Order failed" : isComplete ? "Position opened" : STEPS[Math.max(currentIdx, 0)]?.label ?? "Processing"}
        </span>
        <span className="text-[10px] text-gray-500">{isLong ? "Long" : "Short"} {size}</span>
      </button>
    </div>
  );

  // ── Expanded modal ──────────────────────────────────────────────────────────
  const modal = (
    <div className="fixed bottom-5 right-5 z-[650]">
      <div
        onMouseEnter={handlePointerEnter}
        onMouseLeave={handlePointerLeave}
        className={`w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border bg-shadow-800 shadow-2xl transition-all duration-300 ${
          visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
        } ${
          isError ? "border-red-500/20" : isComplete ? "border-emerald-500/20" : "border-shadow-500/60"
        }`}
      >
        {/* Top colour stripe */}
        <div className={`h-[3px] w-full ${isError ? "bg-red-500" : isComplete ? "bg-emerald-500" : "bg-accent-purple"}`} />

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${
              isLong ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
            }`}>
              {direction.toUpperCase()}
            </span>
            <span className="text-[11px] text-gray-400">{leverage}x · {size}{priceStr ? ` @ $${priceStr}` : ""}</span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setMinimized(true)}
              className="text-gray-600 hover:text-gray-300 transition-colors p-1" aria-label="Minimise">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
              </svg>
            </button>
            {isTerminal && (
              <button type="button" onClick={onClose}
                className="text-gray-600 hover:text-gray-300 transition-colors p-1" aria-label="Close">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Step progress */}
        {!isTerminal && (
          <div className="px-4 pb-3">
            <div className="flex items-center gap-1.5">
              {STEPS.slice(0, -1).map((s, idx) => {
                const done   = currentIdx > idx;
                const active = currentIdx === idx;
                return (
                  <div key={s.key} className="flex items-center gap-1.5 flex-1 last:flex-none">
                    <div className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] transition-all ${
                      done   ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : active ? "bg-accent-purple/20 text-white border border-accent-purple animate-pulse"
                      : "bg-shadow-700 text-gray-600 border border-shadow-600"
                    }`}>
                      {done ? (
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <span>{idx + 1}</span>
                      )}
                    </div>
                    {idx < STEPS.length - 2 && (
                      <div className={`h-px flex-1 transition-all ${done ? "bg-emerald-500/30" : "bg-shadow-600"}`} />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-white">
                {STEPS[Math.max(currentIdx, 0)]?.label}
                {step === "verifying" && verifyElapsed > 0 && (
                  <span className="ml-1.5 text-[10px] font-normal text-gray-500 tabular-nums">{verifyElapsed}s</span>
                )}
              </span>
              {step === "verifying" && verifyElapsed >= 10 && (
                <span className="text-[10px] text-gray-600">— MPC settling, hang tight</span>
              )}
            </div>
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div className="px-4 pb-2">
            <div className="rounded-xl bg-red-500/8 border border-red-500/15 p-3.5">
              <p className="text-[13px] font-semibold text-white mb-1">{error.headline}</p>
              <p className="text-[11px] leading-relaxed text-gray-400">{error.hint}</p>
              {error.detail && (
                <div className="mt-2.5">
                  <button
                    type="button"
                    onClick={() => setDetailOpen((v) => !v)}
                    className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                  >
                    <svg className={`h-2.5 w-2.5 transition-transform ${detailOpen ? "rotate-90" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    Show details
                  </button>
                  {detailOpen && (
                    <p className="mt-1.5 rounded-lg bg-shadow-900/80 px-2.5 py-2 text-[10px] text-gray-500 break-all leading-relaxed border border-shadow-600/50">
                      {error.detail}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Success state */}
        {isComplete && (
          <div className="px-4 pb-2">
            <div className="flex items-center gap-3 rounded-xl bg-emerald-500/8 border border-emerald-500/15 p-3.5">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-[13px] font-semibold text-white">Position opened</p>
                <p className="text-[11px] text-gray-500">Verified through Arcium MPC</p>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-4 pb-4 pt-2 space-y-2">
          {isTerminal && txSignature && (
            <a href={getExplorerTxUrl(txSignature)} target="_blank" rel="noreferrer"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-shadow-700/80 py-2.5 text-[12px] font-medium text-gray-300 transition-colors hover:bg-shadow-600 hover:text-white"
            >
              View on Explorer
              <svg className="h-3 w-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
          {canRetry && (
            <button type="button" onClick={handleRetry}
              className="w-full rounded-xl bg-accent-purple py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-purple/85"
            >
              Try again
            </button>
          )}
          {isTerminal && (
            <button type="button" onClick={onClose}
              className="w-full rounded-xl bg-shadow-700/60 py-2.5 text-[12px] font-medium text-gray-400 transition-colors hover:bg-shadow-700 hover:text-gray-200"
            >
              {isComplete ? "Done" : "Dismiss"}
            </button>
          )}
          {!isTerminal && (
            <div className="flex items-center justify-center text-[10px] text-gray-600">
              Protected by Arcium MPC
            </div>
          )}
        </div>

        {/* Dismiss drain bar */}
        {isTerminal && dismissPct > 0 && (
          <div
            className={`h-[2px] transition-none ${isError ? "bg-red-500/30" : "bg-emerald-500/30"}`}
            style={{ width: `${100 - dismissPct}%` }}
          />
        )}
      </div>
    </div>
  );

  return createPortal(minimized ? pill : modal, document.body);
}
