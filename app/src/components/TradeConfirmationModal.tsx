import { useCallback, useEffect, useRef, useState } from "react";
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
  entryPrice: number;
  errorMessage?: string;
  txSignature?: string;
  onClose: () => void;
}

const STEPS: { key: TradeStep; label: string; sub: string }[] = [
  { key: "signing", label: "Sign", sub: "Wallet approval" },
  { key: "encrypting", label: "Encrypt", sub: "Arcium MPC" },
  { key: "submitting", label: "Submit", sub: "Solana network" },
  { key: "verifying", label: "Finalize", sub: "MPC callback" },
  { key: "confirmed", label: "Confirmed", sub: "Position opened" },
];

const PROGRESS_AUTO_MINIMIZE_MS = 1800;
const TERMINAL_AUTO_MINIMIZE_MS = 3500;
const TERMINAL_AUTO_DISMISS_MS = 20_000;

function stepIndex(step: TradeStep): number {
  if (step === "error") return -1;
  return STEPS.findIndex((s) => s.key === step);
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
}: TradeConfirmationModalProps) {
  const [visible, setVisible] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [stickyExpanded, setStickyExpanded] = useState(false);
  const minimizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMinimizeTimer = useCallback(() => {
    if (minimizeTimerRef.current) {
      clearTimeout(minimizeTimerRef.current);
      minimizeTimerRef.current = null;
    }
  }, []);

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const scheduleDismiss = useCallback(() => {
    clearDismissTimer();
    dismissTimerRef.current = setTimeout(() => {
      onClose();
    }, TERMINAL_AUTO_DISMISS_MS);
  }, [clearDismissTimer, onClose]);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setVisible(true));
      setMinimized(false);
      setStickyExpanded(false);
    } else {
      setVisible(false);
      setMinimized(false);
      setStickyExpanded(false);
      clearMinimizeTimer();
      clearDismissTimer();
    }
  }, [clearDismissTimer, clearMinimizeTimer, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const isTerminal = step === "confirmed" || step === "error";

    clearMinimizeTimer();

    if (isTerminal) {
      setStickyExpanded(false);
      scheduleDismiss();
      minimizeTimerRef.current = setTimeout(() => {
        setMinimized(true);
      }, TERMINAL_AUTO_MINIMIZE_MS);
      return;
    }

    clearDismissTimer();
    if (!stickyExpanded) {
      minimizeTimerRef.current = setTimeout(() => {
        setMinimized(true);
      }, PROGRESS_AUTO_MINIMIZE_MS);
    }
  }, [
    clearDismissTimer,
    clearMinimizeTimer,
    isOpen,
    scheduleDismiss,
    step,
    stickyExpanded,
  ]);

  useEffect(() => {
    return () => {
      clearMinimizeTimer();
      clearDismissTimer();
    };
  }, [clearDismissTimer, clearMinimizeTimer]);

  if (!isOpen) return null;

  const currentIdx = stepIndex(step);
  const isError = step === "error";
  const isComplete = step === "confirmed";
  const isTerminal = isError || isComplete;
  const hasQueuedTx = Boolean(txSignature);
  const isLong = direction === "long";
  const priceStr = entryPrice < 0.01 ? entryPrice.toFixed(8) : entryPrice.toFixed(2);
  const compactMessage =
    errorMessage && errorMessage.trim().length > 0
      ? errorMessage.trim()
      : isComplete
      ? "Position opened."
      : "Processing securely on Arcium.";
  const followUpMessage =
    hasQueuedTx && isError
      ? /already failed on-chain|aborted/i.test(errorMessage ?? "")
        ? "The callback already failed on-chain. Retry after the underlying issue is fixed."
        : "The request was already queued on Arcium. The callback may still settle."
      : null;
  const hasKnownOnChainCallbackFailure =
    isError && /callback already failed on-chain/i.test(errorMessage ?? "");
  const statusLabel = isError
    ? hasKnownOnChainCallbackFailure
      ? "Callback failed"
      : hasQueuedTx
      ? "Queued"
      : "Failed"
    : isComplete
    ? "Confirmed"
    : STEPS[Math.max(currentIdx, 0)]?.label ?? "Processing";
  const statusToneClass = isError
    ? "border-accent-red/30 bg-accent-red/8 text-accent-red"
    : isComplete
    ? "border-accent-green/30 bg-accent-green/8 text-accent-green"
    : "border-accent-purple/30 bg-accent-purple/8 text-accent-purple";

  const handleExpand = () => {
    setMinimized(false);
    setStickyExpanded(true);
    if (isTerminal) {
      scheduleDismiss();
    }
  };

  const handleMinimize = () => {
    setMinimized(true);
    setStickyExpanded(false);
    if (isTerminal) {
      scheduleDismiss();
    }
  };

  const handleCardInteraction = () => {
    if (!isTerminal) return;
    setStickyExpanded(true);
    scheduleDismiss();
  };

  if (minimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6">
        <button
          type="button"
          onClick={handleExpand}
          className={`pointer-events-auto flex min-w-[15rem] items-center gap-3 rounded-2xl border border-shadow-500 bg-shadow-800/95 px-4 py-3 shadow-2xl backdrop-blur transition-all hover:-translate-y-0.5 ${
            isError
              ? "shadow-red-500/10"
              : isComplete
              ? "shadow-emerald-500/10"
              : "shadow-purple-500/10"
          }`}
        >
          <span
            className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border ${statusToneClass}`}
          >
            {isTerminal ? (
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  isError ? "bg-accent-red" : "bg-accent-green"
                }`}
              />
            ) : (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" />
                <path className="opacity-100" d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            )}
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-[11px] font-semibold text-white">{statusLabel}</span>
            <span className="block truncate text-[10px] text-gray-500">
              {isTerminal ? compactMessage : `${direction.toUpperCase()} ${size} @ $${priceStr}`}
            </span>
          </span>
          <svg className="h-4 w-4 flex-shrink-0 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 pointer-events-none sm:bottom-6 sm:right-6">
      <div
        onMouseDown={handleCardInteraction}
        onTouchStart={handleCardInteraction}
        className={`pointer-events-auto w-[min(26rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-shadow-500/80 bg-shadow-800 shadow-2xl transition-all duration-300 ${
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-4 scale-95 opacity-0"
        }`}
      >
        <div
          className={`h-[2px] w-full ${
            isError ? "bg-accent-red" : isComplete ? "bg-accent-green" : "bg-accent-purple"
          }`}
        />

        <div className="flex items-start justify-between px-5 pb-4 pt-5">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span
                className={`rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wider ${
                  isLong ? "bg-accent-green/15 text-accent-green" : "bg-accent-red/15 text-accent-red"
                }`}
              >
                {direction.toUpperCase()}
              </span>
              <span className="text-[11px] font-medium text-gray-500">{leverage}x leverage</span>
            </div>
            <p className="text-xl font-semibold tabular-nums text-white">
              {size} <span className="text-sm font-normal text-gray-500">@ ${priceStr}</span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleMinimize}
              className="mt-0.5 text-gray-600 transition-colors hover:text-gray-300"
              aria-label="Minimize trade status"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
              </svg>
            </button>
            {(isComplete || isError) && (
              <button
                type="button"
                onClick={onClose}
                className="mt-0.5 text-gray-600 transition-colors hover:text-gray-300"
                aria-label="Dismiss trade status"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="px-5 pb-4">
          <div className="relative">
            {STEPS.map((s, idx) => {
              const isDone = !isError && currentIdx > idx;
              const isActive = !isError && currentIdx === idx;

              return (
                <div key={s.key} className="mb-0 flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-all duration-500 ${
                        isDone
                          ? "border border-accent-green/40 bg-accent-green/20"
                          : isActive
                          ? "border border-accent-purple bg-accent-purple/20"
                          : "border border-shadow-500 bg-shadow-800"
                      }`}
                    >
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
                      <div
                        className={`my-0.5 h-5 w-px transition-all duration-500 ${
                          isDone ? "bg-accent-green/30" : "bg-shadow-600"
                        }`}
                      />
                    )}
                  </div>

                  <div className={`pb-4 transition-all duration-500 ${isActive ? "opacity-100" : isDone ? "opacity-60" : "opacity-30"}`}>
                    <p className={`mb-0.5 text-sm font-medium leading-none ${isActive ? "text-white" : "text-gray-400"}`}>
                      {s.label}
                    </p>
                    <p className="text-[11px] text-gray-600">{s.sub}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {isError && (
            <div className="mt-1 rounded-xl border border-accent-red/20 bg-accent-red/8 p-3.5">
              <div className="mb-1.5 flex items-center gap-2">
                <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent-red/20">
                  <svg className="h-3 w-3 text-accent-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <span className="text-sm font-semibold text-accent-red">
                  {hasKnownOnChainCallbackFailure
                    ? "Callback failed on-chain"
                    : hasQueuedTx
                    ? "Queued but not finalized"
                    : "Transaction failed"}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-gray-500">
                {errorMessage || "An error occurred. Please try again."}
              </p>
              {followUpMessage ? (
                <p className="mt-2 text-[10px] text-gray-500">
                  {followUpMessage}
                </p>
              ) : null}
            </div>
          )}

          {isComplete && (
            <div className="mt-1 flex items-center gap-3 rounded-xl border border-accent-green/20 bg-accent-green/8 p-3.5">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent-green/20">
                <svg className="h-4 w-4 text-accent-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-accent-green">Position opened</p>
                <p className="text-[11px] text-gray-500">Secured via Arcium MPC</p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2 px-5 pb-5">
          {(isComplete || isError) && txSignature && (
            <a
              href={getExplorerTxUrl(txSignature)}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent-purple/15 py-2.5 text-sm font-medium text-accent-purple transition-colors hover:bg-accent-purple/25"
            >
              {isComplete ? "View on Explorer" : "View queued tx on Explorer"}
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
          {(isComplete || isError) && (
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-shadow-700 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-shadow-600 hover:text-white"
            >
              {isComplete ? "Done" : "Dismiss"}
            </button>
          )}
          {!isComplete && !isError && (
            <div className="flex items-center justify-center gap-1.5 pt-1 text-[10px] text-gray-600">
              <svg className="h-2.5 w-2.5 text-accent-purple/50" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              Secured by Arcium MPC
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
