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

const STEPS: { key: TradeStep; label: string; sub: string }[] = [
  { key: "signing",    label: "Sign",      sub: "Wallet approval" },
  { key: "encrypting", label: "Encrypt",   sub: "Arcium MPC" },
  { key: "submitting", label: "Submit",    sub: "Solana network" },
  { key: "verifying",  label: "Finalize",  sub: "MPC callback" },
  { key: "confirmed",  label: "Confirmed", sub: "Position opened" },
];

const PROGRESS_AUTO_MINIMIZE_MS  = 1200;
const TERMINAL_AUTO_MINIMIZE_MS  = 1200;
const TERMINAL_AUTO_DISMISS_MS   = 8_000;
const QUEUED_PERSIST_KEY         = "shadow-queued-tx";

function stepIndex(step: TradeStep): number {
  if (step === "error") return -1;
  return STEPS.findIndex((s) => s.key === step);
}

function isRetryableError(errorMessage: string | undefined): boolean {
  const msg = errorMessage ?? "";
  const isCallbackAbort =
    /callback already failed on-chain/i.test(msg) ||
    /resolved to Closed instead of Open/i.test(msg) ||
    /unexpected status Closed/i.test(msg) ||
    /AbortedComputation/i.test(msg) ||
    /InvalidComputationResult/i.test(msg);
  // Non-retryable: callback aborts need the underlying Arcium fix first
  return !isCallbackAbort;
}

function normalizeTradeError(
  errorMessage: string | undefined,
  hasQueuedTx: boolean
): { title: string; body: string; compact: string; detail?: string; followUp?: string } {
  const message = errorMessage?.trim() ?? "";
  const isCallbackAbort =
    /callback already failed on-chain/i.test(message) ||
    /resolved to Closed instead of Open/i.test(message) ||
    /unexpected status Closed/i.test(message) ||
    /AbortedComputation/i.test(message) ||
    /InvalidComputationResult/i.test(message);

  if (!message) {
    return {
      title: hasQueuedTx ? "Still resolving" : "Needs retry",
      body: hasQueuedTx
        ? "Your order was submitted and is still waiting on final settlement."
        : "The order could not be completed. Please try again.",
      compact: hasQueuedTx ? "Waiting on final settlement" : "Order needs retry",
    };
  }

  if (isCallbackAbort) {
    return {
      title: "Arcium callback aborted",
      body: "Your order reached the private queue, but the Arcium callback aborted during final settlement, so Shadow cleaned the pending position up instead of opening it.",
      compact: "Arcium callback aborted",
      detail: message,
      followUp: "Retry after the underlying issue is fixed. Your wallet stays in control, and the queued order does not remain open.",
    };
  }

  const staleOraclePair = message.match(/Oracle is stale for\s+([A-Z-]+)/i)?.[1];
  if (
    /Oracle is stale/i.test(message) ||
    /Insufficient oracle sources/i.test(message) ||
    /invalid price NaN/i.test(message)
  ) {
    const marketLabel = staleOraclePair ?? "this market";
    return {
      title: "Market data is syncing again",
      body: `Shadow needs fresh reference prices for ${marketLabel} before it can send the order.`,
      compact: "Waiting for fresh price feeds",
      detail: message,
      followUp: "Give it a few seconds and retry. This is a market-data freshness issue, not a wallet approval problem.",
    };
  }

  if (hasQueuedTx) {
    return {
      title: "Queued but still resolving",
      body: "Your order was accepted for private processing, but final settlement has not completed yet.",
      compact: "Queued and still resolving",
      detail: message,
      followUp: "If the state does not update soon, check the explorer link for the queued transaction and then retry.",
    };
  }

  return {
    title: "Transaction failed",
    body: "The order could not be completed on this attempt.",
    compact: "Order could not be completed",
    detail: message,
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
  const [mounted,         setMounted]         = useState(false);
  const [visible,         setVisible]         = useState(false);
  const [minimized,       setMinimized]       = useState(false);
  const [isHovered,       setIsHovered]       = useState(false);
  const [detailOpen,      setDetailOpen]      = useState(false);
  const [dismissProgress, setDismissProgress] = useState(0); // 0-100
  const [verifyElapsed,   setVerifyElapsed]   = useState(0); // seconds

  const minimizeTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissRafRef       = useRef<number | null>(null);
  const dismissStartRef     = useRef<number | null>(null);
  const verifyIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const verifyStartRef      = useRef<number | null>(null);

  const clearMinimizeTimer = useCallback(() => {
    if (minimizeTimerRef.current) { clearTimeout(minimizeTimerRef.current); minimizeTimerRef.current = null; }
  }, []);

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current)  { clearTimeout(dismissTimerRef.current);  dismissTimerRef.current  = null; }
    if (dismissRafRef.current)    { cancelAnimationFrame(dismissRafRef.current); dismissRafRef.current = null; }
    dismissStartRef.current = null;
    setDismissProgress(0);
  }, []);

  // Animate the dismiss progress bar
  const animateDismiss = useCallback((startTime: number) => {
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const pct = Math.min(100, (elapsed / TERMINAL_AUTO_DISMISS_MS) * 100);
      setDismissProgress(pct);
      if (pct < 100) {
        dismissRafRef.current = requestAnimationFrame(tick);
      }
    };
    dismissRafRef.current = requestAnimationFrame(tick);
  }, []);

  const scheduleDismiss = useCallback(() => {
    clearDismissTimer();
    const start = performance.now();
    dismissStartRef.current = start;
    animateDismiss(start);
    dismissTimerRef.current = setTimeout(() => { onClose(); }, TERMINAL_AUTO_DISMISS_MS);
  }, [clearDismissTimer, animateDismiss, onClose]);

  // Verifying elapsed timer
  const startVerifyTimer = useCallback(() => {
    if (verifyIntervalRef.current) return;
    verifyStartRef.current = Date.now();
    setVerifyElapsed(0);
    verifyIntervalRef.current = setInterval(() => {
      setVerifyElapsed(Math.floor((Date.now() - (verifyStartRef.current ?? Date.now())) / 1000));
    }, 1000);
  }, []);

  const stopVerifyTimer = useCallback(() => {
    if (verifyIntervalRef.current) { clearInterval(verifyIntervalRef.current); verifyIntervalRef.current = null; }
  }, []);

  // Persist queued tx to localStorage so it survives refresh
  useEffect(() => {
    if (txSignature && step === "error") {
      try { localStorage.setItem(QUEUED_PERSIST_KEY, txSignature); } catch {}
    }
    if (step === "confirmed") {
      try { localStorage.removeItem(QUEUED_PERSIST_KEY); } catch {}
    }
  }, [txSignature, step]);

  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setVisible(true));
      setMinimized(false);
      setIsHovered(false);
      setDetailOpen(false);
      setDismissProgress(0);
    } else {
      setVisible(false);
      setMinimized(false);
      setIsHovered(false);
      setVerifyElapsed(0);
      clearMinimizeTimer();
      clearDismissTimer();
      stopVerifyTimer();
    }
  }, [clearDismissTimer, clearMinimizeTimer, isOpen, stopVerifyTimer]);

  // Start/stop verifying elapsed timer
  useEffect(() => {
    if (isOpen && step === "verifying") {
      startVerifyTimer();
    } else {
      stopVerifyTimer();
    }
  }, [isOpen, step, startVerifyTimer, stopVerifyTimer]);

  useEffect(() => {
    if (!isOpen) return;
    const isTerminal = step === "confirmed" || step === "error";
    clearMinimizeTimer();

    if (isHovered) {
      clearDismissTimer();
      setMinimized(false);
      return;
    }

    minimizeTimerRef.current = setTimeout(() => {
      setMinimized(true);
    }, isTerminal ? TERMINAL_AUTO_MINIMIZE_MS : PROGRESS_AUTO_MINIMIZE_MS);

    if (isTerminal) { scheduleDismiss(); } else { clearDismissTimer(); }
  }, [clearDismissTimer, clearMinimizeTimer, isHovered, isOpen, scheduleDismiss, step]);

  useEffect(() => {
    return () => { clearMinimizeTimer(); clearDismissTimer(); stopVerifyTimer(); };
  }, [clearDismissTimer, clearMinimizeTimer, stopVerifyTimer]);

  if (!isOpen || !mounted) return null;

  const currentIdx    = stepIndex(step);
  const isError       = step === "error";
  const isComplete    = step === "confirmed";
  const isTerminal    = isError || isComplete;
  const hasQueuedTx   = Boolean(txSignature);
  const isLong        = direction === "long";
  const priceStr =
    entryPrice == null
      ? "Price unavailable"
      : entryPrice < 0.01
      ? entryPrice.toFixed(8)
      : entryPrice.toFixed(2);
  const tradeLabel =
    entryPrice == null
      ? `${direction.toUpperCase()} ${size}`
      : `${direction.toUpperCase()} ${size} @ $${priceStr}`;
  const normalizedError = normalizeTradeError(errorMessage, hasQueuedTx);
  const canRetry      = isError && isRetryableError(errorMessage) && Boolean(onRetry);

  const hasKnownOnChainCallbackFailure =
    isError &&
    (/callback already failed on-chain/i.test(errorMessage ?? "") ||
      /resolved to Closed instead of Open/i.test(errorMessage ?? "") ||
      /unexpected status Closed/i.test(errorMessage ?? "") ||
      /AbortedComputation/i.test(errorMessage ?? "") ||
      /InvalidComputationResult/i.test(errorMessage ?? ""));

  const statusLabel = isError
    ? hasKnownOnChainCallbackFailure ? "Callback aborted" : hasQueuedTx ? "Queued" : "Failed"
    : isComplete ? "Confirmed"
    : STEPS[Math.max(currentIdx, 0)]?.label ?? "Processing";

  const statusToneClass = isError
    ? "border-accent-red/30 bg-accent-red/8 text-accent-red"
    : isComplete
    ? "border-accent-green/30 bg-accent-green/8 text-accent-green"
    : "border-accent-purple/30 bg-accent-purple/8 text-accent-purple";

  const handleExpand = () => { clearMinimizeTimer(); clearDismissTimer(); setMinimized(false); };

  const handleMinimize = () => {
    setIsHovered(false);
    setMinimized(true);
    if (isTerminal) scheduleDismiss();
  };

  const handlePointerEnter = () => {
    setIsHovered(true);
    clearMinimizeTimer();
    clearDismissTimer();
    setMinimized(false);
  };

  const handlePointerLeave = () => {
    setIsHovered(false);
    setMinimized(true);
    if (isTerminal) scheduleDismiss();
  };

  // On touch devices mouseLeave never fires after a tap, leaving isHovered stuck.
  // Reset on touchEnd so the dismiss timer can resume.
  const handleTouchEnd = () => {
    setIsHovered(false);
    if (isTerminal) scheduleDismiss();
  };

  const handleRetry = () => {
    try { localStorage.removeItem(QUEUED_PERSIST_KEY); } catch {}
    onRetry?.();
  };

  // ── Minimized card ─────────────────────────────────────────────────────────
  const minimizedView = (
    <div className="fixed bottom-4 right-4 z-[650] sm:bottom-6 sm:right-6">
      <button
        type="button"
        onClick={handleExpand}
        onMouseEnter={handlePointerEnter}
        onMouseLeave={handlePointerLeave}
        onFocus={handlePointerEnter}
        onBlur={handlePointerLeave}
        onTouchEnd={handleTouchEnd}
        className={`pointer-events-auto relative flex min-w-[15rem] items-center gap-3 overflow-hidden rounded-2xl border border-shadow-500 bg-shadow-800/95 px-4 py-3 shadow-2xl backdrop-blur transition-all hover:-translate-y-0.5 ${
          isError ? "shadow-red-500/10" : isComplete ? "shadow-emerald-500/10" : "shadow-purple-500/10"
        }`}
      >
        {/* Auto-dismiss drain bar */}
        {isTerminal && dismissProgress > 0 && (
          <span
            className={`pointer-events-none absolute bottom-0 left-0 h-[2px] transition-none ${
              isError ? "bg-accent-red/40" : "bg-accent-green/40"
            }`}
            style={{ width: `${100 - dismissProgress}%` }}
          />
        )}

        {/* Status icon */}
        <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border ${statusToneClass}`}>
          {isTerminal ? (
            <span className={`h-2.5 w-2.5 rounded-full ${isError ? "bg-accent-red animate-pulse" : "bg-accent-green"}`} />
          ) : (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" />
              <path className="opacity-100" d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          )}
        </span>

        {/* Labels — always show trade identity */}
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-[11px] font-semibold text-white">{statusLabel}</span>
          <span className="block truncate text-[10px] text-gray-500">{tradeLabel}</span>
        </span>

        <svg className="h-4 w-4 flex-shrink-0 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );

  // ── Expanded modal ─────────────────────────────────────────────────────────
  const expandedView = (
    <div className="fixed bottom-4 right-4 z-[650] pointer-events-none sm:bottom-6 sm:right-6">
      <div
        onMouseEnter={handlePointerEnter}
        onMouseLeave={handlePointerLeave}
        onFocus={handlePointerEnter}
        onBlur={handlePointerLeave}
        onTouchEnd={handleTouchEnd}
        className={`pointer-events-auto w-[min(26rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-shadow-500/80 bg-shadow-800 shadow-2xl transition-all duration-300 ${
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-4 scale-95 opacity-0"
        }`}
      >
        {/* Top accent bar */}
        <div className={`h-[2px] w-full ${isError ? "bg-accent-red" : isComplete ? "bg-accent-green" : "bg-accent-purple"}`} />

        {/* Header */}
        <div className="flex items-start justify-between px-5 pb-4 pt-5">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wider ${
                isLong ? "bg-accent-green/15 text-accent-green" : "bg-accent-red/15 text-accent-red"
              }`}>
                {direction.toUpperCase()}
              </span>
              <span className="text-[11px] font-medium text-gray-500">{leverage}x leverage</span>
            </div>
            <p className="text-xl font-semibold tabular-nums text-white">
              {size} <span className="text-sm font-normal text-gray-500">@ ${priceStr}</span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={handleMinimize}
              className="mt-0.5 text-gray-600 transition-colors hover:text-gray-300" aria-label="Minimize">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
              </svg>
            </button>
            {isTerminal && (
              <button type="button" onClick={onClose}
                className="mt-0.5 text-gray-600 transition-colors hover:text-gray-300" aria-label="Dismiss">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Steps */}
        <div className="px-5 pb-4">
          <div className="relative">
            {STEPS.map((s, idx) => {
              const isDone   = !isError && currentIdx > idx;
              const isActive = !isError && currentIdx === idx;
              const isVerifyStep = s.key === "verifying";

              return (
                <div key={s.key} className="mb-0 flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-all duration-500 ${
                      isDone   ? "border border-accent-green/40 bg-accent-green/20"
                      : isActive ? "border border-accent-purple bg-accent-purple/20"
                      : "border border-shadow-500 bg-shadow-800"
                    }`}>
                      {isDone ? (
                        <svg className="h-3 w-3 text-accent-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : isActive ? (
                        <div className="h-2 w-2 animate-pulse rounded-full bg-accent-purple" />
                      ) : (
                        <div className="h-1.5 w-1.5 rounded-full bg-shadow-500" />
                      )}
                    </div>
                    {idx < STEPS.length - 1 && (
                      <div className={`my-0.5 h-5 w-px transition-all duration-500 ${isDone ? "bg-accent-green/30" : "bg-shadow-600"}`} />
                    )}
                  </div>

                  <div className={`pb-4 transition-all duration-500 ${isActive ? "opacity-100" : isDone ? "opacity-60" : "opacity-30"}`}>
                    <p className={`mb-0.5 text-sm font-medium leading-none ${isActive ? "text-white" : "text-gray-400"}`}>
                      {s.label}
                      {/* Elapsed timer on verifying step */}
                      {isVerifyStep && isActive && verifyElapsed > 0 && (
                        <span className="ml-2 text-[10px] font-normal text-gray-500 tabular-nums">
                          {verifyElapsed}s
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-gray-600">
                      {isVerifyStep && isActive && verifyElapsed >= 10
                        ? `Waiting on MPC callback… ${verifyElapsed}s`
                        : s.sub}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Error block */}
          {isError && (
            <div className="mt-1 rounded-xl border border-accent-red/20 bg-accent-red/8 p-3.5">
              <div className="mb-1.5 flex items-center gap-2">
                <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent-red/20">
                  <svg className="h-3 w-3 text-accent-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <span className="text-sm font-semibold text-accent-red">{normalizedError.title}</span>
              </div>
              <p className="text-[11px] leading-relaxed text-gray-500">{normalizedError.body}</p>
              {normalizedError.followUp && (
                <p className="mt-2 text-[10px] leading-relaxed text-gray-500">{normalizedError.followUp}</p>
              )}

              {/* Technical detail — collapsed by default */}
              {normalizedError.detail && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setDetailOpen((v) => !v)}
                    className="flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-gray-600 hover:text-gray-400 transition-colors"
                  >
                    <svg
                      className={`h-2.5 w-2.5 transition-transform ${detailOpen ? "rotate-90" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    Technical detail
                  </button>
                  {detailOpen && (
                    <div className="mt-1.5 rounded-lg border border-shadow-600/80 bg-shadow-900/70 px-2.5 py-2">
                      <p className="text-[10px] leading-relaxed text-gray-500 break-all">
                        {normalizedError.detail}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Success block */}
          {isComplete && (
            <div className="mt-1 flex items-center gap-3 rounded-xl border border-accent-green/20 bg-accent-green/8 p-3.5">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent-green/20">
                <svg className="h-4 w-4 text-accent-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-accent-green">Position opened</p>
                <p className="text-[11px] text-gray-500">Verified through Arcium MPC</p>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-2 px-5 pb-5">
          {isTerminal && txSignature && (
            <a href={getExplorerTxUrl(txSignature)} target="_blank" rel="noreferrer"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent-purple/15 py-2.5 text-sm font-medium text-accent-purple transition-colors hover:bg-accent-purple/25"
            >
              {isComplete ? "View on Explorer" : "View queued tx on Explorer"}
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}

          {/* Retry button — only for retryable errors */}
          {canRetry && (
            <button type="button" onClick={handleRetry}
              className="w-full rounded-xl border border-accent-purple/30 bg-accent-purple/10 py-2.5 text-sm font-medium text-accent-purple transition-colors hover:bg-accent-purple/20"
            >
              Retry
            </button>
          )}

          {isTerminal && (
            <button type="button" onClick={onClose}
              className="w-full rounded-xl bg-shadow-700 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-shadow-600 hover:text-white"
            >
              {isComplete ? "Done" : "Dismiss"}
            </button>
          )}

          {!isTerminal && (
            <div className="flex items-center justify-center gap-1.5 pt-1 text-[10px] text-gray-600">
              <svg className="h-2.5 w-2.5 text-accent-purple/50" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              Protected by Arcium MPC
            </div>
          )}
        </div>

        {/* Auto-dismiss bar at bottom of expanded modal */}
        {isTerminal && dismissProgress > 0 && (
          <div className={`h-[2px] w-full transition-none ${isError ? "bg-accent-red/30" : "bg-accent-green/30"}`}
            style={{ width: `${100 - dismissProgress}%` }}
          />
        )}
      </div>
    </div>
  );

  return createPortal(minimized ? minimizedView : expandedView, document.body);
}
