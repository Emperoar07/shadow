import { useEffect, useState } from "react";
import { getExplorerTxUrl } from "../lib/explorer";

export type TradeStep = "signing" | "encrypting" | "submitting" | "confirmed" | "error";

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

const STEPS: { key: TradeStep; label: string; description: string }[] = [
  { key: "signing", label: "Signing", description: "Approve transaction in wallet" },
  { key: "encrypting", label: "Encrypting", description: "Encrypting position via Arcium MPC" },
  { key: "submitting", label: "Submitting", description: "Broadcasting to Solana network" },
  { key: "confirmed", label: "Confirmed", description: "Position opened successfully" },
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
    if (isOpen) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const currentIdx = stepIndex(step);
  const isError = step === "error";
  const isComplete = step === "confirmed";
  const dirColor = direction === "long" ? "text-accent-green" : "text-accent-red";
  const dirBg = direction === "long" ? "from-accent-green/20 to-emerald-600/10" : "from-accent-red/20 to-rose-600/10";

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-300 ${
        visible ? "bg-black/60 backdrop-blur-sm" : "bg-black/0"
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget && (isComplete || isError)) onClose();
      }}
    >
      <div
        className={`w-full max-w-md mx-4 rounded-2xl border border-shadow-500 overflow-hidden transition-all duration-300 ${
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-4"
        }`}
        style={{ background: "linear-gradient(135deg, #1a1a25 0%, #12121a 100%)" }}
      >
        {/* Header */}
        <div className={`px-6 pt-6 pb-4 bg-gradient-to-br ${dirBg}`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">
              {isError ? "Trade Failed" : isComplete ? "Trade Confirmed" : "Processing Trade"}
            </h3>
            {(isComplete || isError) && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className={`font-semibold ${dirColor}`}>
              {direction.toUpperCase()}
            </span>
            <span className="text-gray-300">{size} @ ${entryPrice < 0.01 ? entryPrice.toFixed(8) : entryPrice.toFixed(2)}</span>
            <span className="px-2 py-0.5 rounded bg-shadow-600 text-xs text-gray-300">{leverage}x</span>
          </div>
        </div>

        {/* Steps */}
        <div className="px-6 py-5 space-y-1">
          {STEPS.map((s, idx) => {
            const isDone = !isError && currentIdx > idx;
            const isActive = !isError && currentIdx === idx;
            const isPending = !isError && currentIdx < idx;

            return (
              <div
                key={s.key}
                className={`flex items-center gap-3 py-2.5 transition-all duration-500 ${
                  isActive ? "opacity-100" : isDone ? "opacity-70" : "opacity-40"
                }`}
              >
                {/* Icon */}
                <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                  {isDone ? (
                    <div className="w-7 h-7 rounded-full bg-accent-green/20 flex items-center justify-center animate-in">
                      <svg className="w-4 h-4 text-accent-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : isActive ? (
                    <div className="w-7 h-7 rounded-full border-2 border-accent-purple border-t-transparent animate-spin" />
                  ) : (
                    <div className="w-7 h-7 rounded-full border-2 border-shadow-500 flex items-center justify-center">
                      <span className="text-xs text-gray-500">{idx + 1}</span>
                    </div>
                  )}
                </div>

                {/* Text */}
                <div>
                  <p className={`text-sm font-medium ${isActive ? "text-white" : isDone ? "text-gray-300" : "text-gray-500"}`}>
                    {s.label}
                  </p>
                  <p className="text-xs text-gray-500">{s.description}</p>
                </div>
              </div>
            );
          })}

          {/* Error state */}
          {isError && (
            <div className="flex items-center gap-3 py-3 px-3 mt-2 rounded-lg bg-accent-red/10 border border-accent-red/20 animate-in">
              <div className="w-7 h-7 rounded-full bg-accent-red/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-accent-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-sm text-accent-red">{errorMessage || "Transaction failed"}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          {isComplete && txSignature && (
            <a
              href={getExplorerTxUrl(txSignature)}
              target="_blank"
              rel="noreferrer"
              className="block w-full text-center py-3 rounded-lg bg-accent-purple/20 text-accent-purple text-sm font-medium hover:bg-accent-purple/30 transition-colors mb-3"
            >
              View on Solana Explorer
            </a>
          )}
          {(isComplete || isError) && (
            <button
              onClick={onClose}
              className="w-full py-3 rounded-lg bg-shadow-600 text-white text-sm font-medium hover:bg-shadow-500 transition-colors"
            >
              {isComplete ? "Done" : "Close"}
            </button>
          )}
          {!isComplete && !isError && (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
              <svg className="w-3 h-3 text-accent-purple" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                  clipRule="evenodd"
                />
              </svg>
              Secured by Arcium MPC
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
