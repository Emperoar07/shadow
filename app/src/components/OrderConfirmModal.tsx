import { useEffect, useState } from "react";

interface OrderConfirmModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  details?: { label: string; value: string }[];
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  doubleConfirm?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function OrderConfirmModal({
  isOpen,
  title,
  description,
  details,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  doubleConfirm = false,
  onConfirm,
  onCancel,
}: OrderConfirmModalProps) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") handleConfirm();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, step]);

  if (!isOpen) return null;

  const isDanger = variant === "danger";
  const accentBorder = isDanger ? "border-accent-red/30" : "border-accent-purple/30";
  const accentBg = isDanger ? "bg-accent-red" : "bg-accent-purple";
  const accentBgLight = isDanger ? "bg-accent-red/15" : "bg-accent-purple/15";
  const accentText = isDanger ? "text-accent-red" : "text-accent-purple";
  const accentHover = isDanger ? "hover:bg-accent-red/90" : "hover:bg-accent-purple/90";

  const handleConfirm = () => {
    if (doubleConfirm && step === 1) {
      setStep(2);
      return;
    }
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center pointer-events-none">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] pointer-events-auto"
        onClick={onCancel}
      />
      <div
        className={`pointer-events-auto relative w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border ${accentBorder} bg-shadow-800 shadow-2xl transition-all duration-200 ${
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-95 opacity-0"
        }`}
      >
        {/* Top accent bar */}
        <div className={`h-[2px] w-full ${accentBg}`} />

        <div className="px-5 pt-5 pb-2">
          {/* Icon */}
          <div className={`mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full ${accentBgLight}`}>
            {isDanger ? (
              <svg className="h-5 w-5 text-accent-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-accent-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>

          <h3 className="text-center text-sm font-semibold text-white mb-1">
            {doubleConfirm && step === 2 ? "Are you absolutely sure?" : title}
          </h3>
          {description && (
            <p className="text-center text-[11px] text-gray-500 mb-3">{description}</p>
          )}
          {doubleConfirm && step === 2 && (
            <p className="text-center text-[11px] text-amber-400/80 mb-3">
              This action cannot be undone.
            </p>
          )}

          {/* Details */}
          {details && details.length > 0 && (
            <div className="rounded-xl border border-shadow-600 bg-shadow-900/60 p-3 mb-3">
              {details.map((d, i) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <span className="text-[11px] text-gray-500">{d.label}</span>
                  <span className="text-[11px] font-medium text-gray-200 tabular-nums">{d.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl bg-shadow-700 py-2.5 text-[12px] font-medium text-gray-300 transition-colors hover:bg-shadow-600 hover:text-white"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={`flex-1 rounded-xl ${accentBg} py-2.5 text-[12px] font-semibold text-white transition-colors ${accentHover}`}
          >
            {doubleConfirm && step === 2 ? "Yes, confirm" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
