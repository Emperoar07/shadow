import { useEffect, useState } from "react";
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
  { key: "signing",    label: "Sign",     sub: "Wallet approval" },
  { key: "encrypting", label: "Encrypt",  sub: "Arcium MPC" },
  { key: "submitting", label: "Submit",   sub: "Solana network" },
  { key: "verifying",  label: "Finalize", sub: "MPC callback" },
  { key: "confirmed",  label: "Confirmed", sub: "Position opened" },
];

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

  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => setVisible(true));
    else setVisible(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const currentIdx = stepIndex(step);
  const isError = step === "error";
  const isComplete = step === "confirmed";
  const hasQueuedTx = Boolean(txSignature);
  const isLong = direction === "long";
  const priceStr = entryPrice < 0.01 ? entryPrice.toFixed(8) : entryPrice.toFixed(2);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-300 ${
        visible ? "bg-black/70 backdrop-blur-sm" : "bg-black/0"
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget && (isComplete || isError)) onClose();
      }}
    >
      <div
        className={`w-full max-w-sm mx-4 rounded-2xl overflow-hidden border border-shadow-500/80 transition-all duration-300 ${
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-4"
        }`}
        style={{ background: "#0f1018" }}
      >
        {/* Top accent line */}
        <div className={`h-[2px] w-full ${isError ? "bg-accent-red" : isComplete ? "bg-accent-green" : "bg-accent-purple"}`} />

        {/* Header */}
        <div className="px-5 pt-5 pb-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[11px] font-bold tracking-wider px-2 py-0.5 rounded-md ${
                isLong ? "bg-accent-green/15 text-accent-green" : "bg-accent-red/15 text-accent-red"
              }`}>
                {direction.toUpperCase()}
              </span>
              <span className="text-[11px] text-gray-500 font-medium">{leverage}x leverage</span>
            </div>
            <p className="text-xl font-semibold text-white tabular-nums">
              {size} <span className="text-gray-500 text-sm font-normal">@ ${priceStr}</span>
            </p>
          </div>
          {(isComplete || isError) && (
            <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors mt-0.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Steps */}
        <div className="px-5 pb-4">
          {/* Connecting track */}
          <div className="relative">
            {STEPS.map((s, idx) => {
              const isDone = !isError && currentIdx > idx;
              const isActive = !isError && currentIdx === idx;

              return (
                <div key={s.key} className="flex items-start gap-3 mb-0">
                  {/* Icon + connector */}
                  <div className="flex flex-col items-center">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500 ${
                      isDone
                        ? "bg-accent-green/20 border border-accent-green/40"
                        : isActive
                        ? "bg-accent-purple/20 border border-accent-purple"
                        : "bg-shadow-800 border border-shadow-500"
                    }`}>
                      {isDone ? (
                        <svg className="w-3 h-3 text-accent-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : isActive ? (
                        <div className="w-2 h-2 rounded-full bg-accent-purple animate-pulse" />
                      ) : (
                        <div className="w-1.5 h-1.5 rounded-full bg-shadow-500" />
                      )}
                    </div>
                    {idx < STEPS.length - 1 && (
                      <div className={`w-px flex-1 my-0.5 transition-all duration-500 ${
                        isDone ? "bg-accent-green/30 h-5" : "bg-shadow-600 h-5"
                      }`} />
                    )}
                  </div>

                  {/* Label */}
                  <div className={`pb-4 transition-all duration-500 ${
                    isActive ? "opacity-100" : isDone ? "opacity-60" : "opacity-30"
                  }`}>
                    <p className={`text-sm font-medium leading-none mb-0.5 ${isActive ? "text-white" : "text-gray-400"}`}>
                      {s.label}
                    </p>
                    <p className="text-[11px] text-gray-600">{s.sub}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Error block */}
          {isError && (
            <div className="mt-1 rounded-xl border border-accent-red/20 bg-accent-red/8 p-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-5 h-5 rounded-full bg-accent-red/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-accent-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <span className="text-sm font-semibold text-accent-red">
                  {hasQueuedTx ? "Queued but not finalized" : "Transaction failed"}
                </span>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed">
                {errorMessage || "An error occurred. Please try again."}
              </p>
            </div>
          )}

          {/* Success block */}
          {isComplete && (
            <div className="mt-1 rounded-xl border border-accent-green/20 bg-accent-green/8 p-3.5 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-accent-green/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-accent-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
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

        {/* Footer */}
        <div className="px-5 pb-5 space-y-2">
          {(isComplete || isError) && txSignature && (
            <a
              href={getExplorerTxUrl(txSignature)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl bg-accent-purple/15 text-accent-purple text-sm font-medium hover:bg-accent-purple/25 transition-colors"
            >
              {isComplete ? "View on Explorer" : "View queued tx on Explorer"}
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
          {(isComplete || isError) && (
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-shadow-700 text-gray-300 text-sm font-medium hover:bg-shadow-600 hover:text-white transition-colors"
            >
              {isComplete ? "Done" : "Dismiss"}
            </button>
          )}
          {!isComplete && !isError && (
            <div className="flex items-center justify-center gap-1.5 text-[10px] text-gray-600 pt-1">
              <svg className="w-2.5 h-2.5 text-accent-purple/50" fill="currentColor" viewBox="0 0 20 20">
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
