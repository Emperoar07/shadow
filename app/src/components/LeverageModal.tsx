import { useState, useEffect, useCallback } from "react";

const LEVERAGE_MARKERS = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50] as const;
const MIN_LEVERAGE = 1;
const MAX_LEVERAGE = 50;

interface LeverageModalProps {
  isOpen: boolean;
  leverage: number;
  onClose: () => void;
  onConfirm: (leverage: number) => void;
}

export default function LeverageModal({
  isOpen,
  leverage,
  onClose,
  onConfirm,
}: LeverageModalProps) {
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState(leverage);
  const [inputValue, setInputValue] = useState(String(leverage));

  useEffect(() => {
    if (isOpen) {
      setDraft(leverage);
      setInputValue(String(leverage));
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [isOpen, leverage]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter") {
        onConfirm(draft);
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, draft, onClose, onConfirm]);

  const handleSlider = useCallback((val: number) => {
    const clamped = Math.max(MIN_LEVERAGE, Math.min(MAX_LEVERAGE, val));
    setDraft(clamped);
    setInputValue(String(clamped));
  }, []);

  const handleInputChange = useCallback((raw: string) => {
    setInputValue(raw);
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= MIN_LEVERAGE && parsed <= MAX_LEVERAGE) {
      setDraft(parsed);
    }
  }, []);

  const handleInputBlur = useCallback(() => {
    setInputValue(String(draft));
  }, [draft]);

  if (!isOpen) return null;

  const pct = ((draft - MIN_LEVERAGE) / (MAX_LEVERAGE - MIN_LEVERAGE)) * 100;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-300 ${
        visible ? "bg-black/60 backdrop-blur-sm" : "bg-black/0"
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full max-w-xs mx-4 rounded-2xl border border-shadow-500 overflow-hidden transition-all duration-300 ${
          visible
            ? "opacity-100 scale-100 translate-y-0"
            : "opacity-0 scale-95 translate-y-4"
        }`}
        style={{
          background: "linear-gradient(135deg, #1a1a25 0%, #12121a 100%)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-white">Adjust Leverage</h3>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-500 hover:bg-shadow-600 hover:text-white transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Leverage display */}
        <div className="px-5 pt-2 pb-1 text-center">
          <div className="inline-flex items-baseline gap-1">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => handleInputChange(e.target.value)}
              onBlur={handleInputBlur}
              className="w-14 bg-transparent text-center text-3xl font-bold text-accent-purple outline-none border-b-2 border-accent-purple/30 focus:border-accent-purple transition-colors"
            />
            <span className="text-lg font-semibold text-gray-400">x</span>
          </div>
        </div>

        {/* Slider */}
        <div className="px-5 pt-3 pb-1">
          <input
            type="range"
            min={MIN_LEVERAGE}
            max={MAX_LEVERAGE}
            value={draft}
            onChange={(e) => handleSlider(parseInt(e.target.value, 10))}
            className="h-2 w-full cursor-pointer appearance-none rounded-full accent-accent-purple"
            style={{
              background: `linear-gradient(to right, #8b5cf6 ${pct}%, var(--range-track-empty, #2d2d3d) ${pct}%)`,
            }}
          />
        </div>

        {/* Quick-select grid */}
        <div className="px-5 pt-2 pb-3">
          <div className="grid grid-cols-6 gap-1.5">
            {LEVERAGE_MARKERS.map((m) => (
              <button
                key={m}
                onClick={() => handleSlider(m)}
                className={`rounded-md py-1.5 text-[11px] font-semibold transition-all ${
                  draft === m
                    ? "bg-accent-purple text-white shadow-md shadow-accent-purple/25"
                    : "bg-shadow-700 text-gray-400 hover:bg-shadow-600 hover:text-white border border-shadow-500"
                }`}
              >
                {m}x
              </button>
            ))}
          </div>
        </div>

        {/* Risk indicator */}
        <div className="mx-5 mb-3 rounded-lg bg-shadow-800/50 border border-shadow-600 px-3 py-2">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-gray-500">Risk Level</span>
            <span
              className={`font-semibold ${
                draft <= 5
                  ? "text-accent-green"
                  : draft <= 15
                  ? "text-yellow-400"
                  : draft <= 30
                  ? "text-orange-400"
                  : "text-accent-red"
              }`}
            >
              {draft <= 5
                ? "Low"
                : draft <= 15
                ? "Medium"
                : draft <= 30
                ? "High"
                : "Very High"}
            </span>
          </div>
          <div className="mt-1.5 h-1 w-full rounded-full bg-shadow-600 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                draft <= 5
                  ? "bg-accent-green"
                  : draft <= 15
                  ? "bg-yellow-400"
                  : draft <= 30
                  ? "bg-orange-400"
                  : "bg-accent-red"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Confirm button */}
        <div className="px-5 pb-4">
          <button
            onClick={() => {
              onConfirm(draft);
              onClose();
            }}
            className="w-full rounded-xl bg-accent-purple py-2.5 text-sm font-semibold text-white hover:bg-accent-purple/90 transition-colors"
          >
            Confirm {draft}x Leverage
          </button>
        </div>
      </div>
    </div>
  );
}
