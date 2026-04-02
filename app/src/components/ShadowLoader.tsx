interface ShadowLoaderProps {
  message?: string;
  size?: "sm" | "md" | "lg";
  fullScreen?: boolean;
}

export default function ShadowLoader({
  message = "Loading...",
  size = "md",
  fullScreen = false,
}: ShadowLoaderProps) {
  const dims = size === "sm" ? "w-12 h-12" : size === "lg" ? "w-20 h-20" : "w-16 h-16";
  // Animation durations: staggered but unhurried so each layer is visible long enough
  const dur1 = "3.2s";
  const dur2 = "3.2s";
  const dur3 = "3.2s";

  return (
    <div
      className={`flex flex-col items-center justify-center gap-5 ${
        fullScreen
          ? "fixed inset-0 z-[9999] bg-shadow-900"
          : "absolute inset-0 flex items-center justify-center bg-shadow-900/80"
      }`}
    >
      <svg viewBox="0 0 100 100" className={dims} aria-hidden="true">
        <defs>
          <linearGradient id="loader-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        <path
          style={{ animation: `stackReveal1 ${dur1} ease-in-out infinite` }}
          d="M50 15 L85 35 L50 55 L15 35 Z"
          fill="url(#loader-grad)"
        />
        <path
          style={{ animation: `stackReveal2 ${dur2} ease-in-out infinite` }}
          d="M50 25 L85 45 L50 65 L15 45 Z"
          fill="url(#loader-grad)"
        />
        <path
          style={{ animation: `stackReveal3 ${dur3} ease-in-out infinite` }}
          d="M50 35 L85 55 L50 75 L15 55 Z"
          fill="url(#loader-grad)"
        />
      </svg>
      {message && (
        <span className="text-[11px] font-semibold tracking-[0.15em] uppercase bg-gradient-to-r from-accent-purple to-accent-blue bg-clip-text text-transparent animate-pulse">
          {message}
        </span>
      )}
    </div>
  );
}
