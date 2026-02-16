import { useState, useEffect } from "react";

export default function MarketInfo() {
  const [price, setPrice] = useState(103.45);
  const [change24h, setChange24h] = useState(2.34);

  // Simulate price updates
  useEffect(() => {
    const interval = setInterval(() => {
      setPrice((p) => p + (Math.random() - 0.5) * 0.1);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="position-card rounded-xl p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-4">SOL-PERP</h2>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold">${price.toFixed(2)}</span>
          <span
            className={`text-sm ${
              change24h >= 0 ? "text-accent-green" : "text-accent-red"
            }`}
          >
            {change24h >= 0 ? "+" : ""}
            {change24h.toFixed(2)}%
          </span>
        </div>
      </div>

      <div className="space-y-3">
        <InfoRow label="24h Volume" value="$12.4M" />
        <InfoRow label="Open Interest" value="$8.2M" encrypted />
        <InfoRow label="Funding Rate" value="0.01%" />
        <InfoRow label="Max Leverage" value="20x" />
      </div>

      <div className="pt-4 border-t border-shadow-600">
        <h3 className="text-sm font-medium text-gray-400 mb-3">
          Privacy Status
        </h3>
        <div className="space-y-2">
          <PrivacyStatus label="Positions" status="encrypted" />
          <PrivacyStatus label="Liquidations" status="encrypted" />
          <PrivacyStatus label="Order Book" status="encrypted" />
          <PrivacyStatus label="Final PnL" status="revealed" />
        </div>
      </div>

      <div className="pt-4 border-t border-shadow-600">
        <h3 className="text-sm font-medium text-gray-400 mb-3">
          Arcium Network
        </h3>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent-green" />
          <span className="text-sm">MXE Cluster Active</span>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          3 nodes processing encrypted computations
        </p>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  encrypted,
}: {
  label: string;
  value: string;
  encrypted?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-400 text-sm">{label}</span>
      <div className="flex items-center gap-2">
        {encrypted && (
          <svg
            className="w-3 h-3 text-accent-purple"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
        <span className={encrypted ? "encrypted-blur" : ""}>{value}</span>
      </div>
    </div>
  );
}

function PrivacyStatus({
  label,
  status,
}: {
  label: string;
  status: "encrypted" | "revealed";
}) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-400">{label}</span>
      <span
        className={`px-2 py-0.5 rounded text-xs ${
          status === "encrypted"
            ? "bg-accent-purple/20 text-accent-purple"
            : "bg-accent-green/20 text-accent-green"
        }`}
      >
        {status === "encrypted" ? "🔒 Encrypted" : "👁 Revealed"}
      </span>
    </div>
  );
}
