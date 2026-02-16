import { useState } from "react";
import toast from "react-hot-toast";

interface Position {
  id: string;
  direction: "long" | "short";
  status: "open" | "closing" | "closed";
  margin: number;
  openedAt: Date;
  realizedPnl?: number;
}

// Mock positions for demo
const mockPositions: Position[] = [
  {
    id: "pos_1",
    direction: "long",
    status: "open",
    margin: 500,
    openedAt: new Date(Date.now() - 3600000),
  },
  {
    id: "pos_2",
    direction: "short",
    status: "open",
    margin: 250,
    openedAt: new Date(Date.now() - 7200000),
  },
  {
    id: "pos_3",
    direction: "long",
    status: "closed",
    margin: 1000,
    openedAt: new Date(Date.now() - 86400000),
    realizedPnl: 127.5,
  },
];

export default function PositionsList() {
  const [positions, setPositions] = useState<Position[]>(mockPositions);

  const handleClose = async (positionId: string) => {
    toast.loading("Initiating position close...", { id: positionId });

    // Update status to closing
    setPositions((prev) =>
      prev.map((p) => (p.id === positionId ? { ...p, status: "closing" as const } : p))
    );

    // Simulate MPC computation
    await new Promise((r) => setTimeout(r, 2000));

    toast.loading("Computing final PnL...", { id: positionId });
    await new Promise((r) => setTimeout(r, 1500));

    // Generate random PnL
    const pnl = (Math.random() - 0.4) * 200;

    setPositions((prev) =>
      prev.map((p) =>
        p.id === positionId
          ? { ...p, status: "closed" as const, realizedPnl: pnl }
          : p
      )
    );

    toast.success(
      <div>
        <p className="font-medium">Position Closed!</p>
        <p className={`text-sm ${pnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
          PnL: {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
        </p>
      </div>,
      { id: positionId, duration: 5000 }
    );
  };

  const openPositions = positions.filter((p) => p.status !== "closed");
  const closedPositions = positions.filter((p) => p.status === "closed");

  return (
    <div className="space-y-6">
      {/* Open Positions */}
      <div className="position-card rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-4">Open Positions</h2>

        {openPositions.length === 0 ? (
          <p className="text-gray-400 text-center py-8">
            No open positions. Start trading!
          </p>
        ) : (
          <div className="space-y-4">
            {openPositions.map((position) => (
              <PositionCard
                key={position.id}
                position={position}
                onClose={() => handleClose(position.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Closed Positions */}
      <div className="position-card rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-4">Position History</h2>

        {closedPositions.length === 0 ? (
          <p className="text-gray-400 text-center py-8">
            No closed positions yet.
          </p>
        ) : (
          <div className="space-y-4">
            {closedPositions.map((position) => (
              <PositionCard key={position.id} position={position} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PositionCard({
  position,
  onClose,
}: {
  position: Position;
  onClose?: () => void;
}) {
  const isOpen = position.status === "open";
  const isClosing = position.status === "closing";

  return (
    <div className="bg-shadow-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span
            className={`px-2 py-1 rounded text-xs font-medium ${
              position.direction === "long"
                ? "bg-accent-green/20 text-accent-green"
                : "bg-accent-red/20 text-accent-red"
            }`}
          >
            {position.direction.toUpperCase()}
          </span>
          <span className="text-sm text-gray-400">
            {position.openedAt.toLocaleDateString()}
          </span>
        </div>

        {position.status === "closed" && position.realizedPnl !== undefined && (
          <span
            className={`font-semibold ${
              position.realizedPnl >= 0 ? "text-accent-green" : "text-accent-red"
            }`}
          >
            {position.realizedPnl >= 0 ? "+" : ""}$
            {position.realizedPnl.toFixed(2)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-xs text-gray-500 mb-1">Size</p>
          <p className="encrypted-blur text-sm">Hidden</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Leverage</p>
          <p className="encrypted-blur text-sm">Hidden</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Margin</p>
          <p className="text-sm">${position.margin.toFixed(2)}</p>
        </div>
      </div>

      {isOpen && (
        <div className="flex items-center justify-between pt-4 border-t border-shadow-500">
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 text-accent-purple"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-xs text-gray-400">
              Position data encrypted
            </span>
          </div>

          <button
            onClick={onClose}
            disabled={isClosing}
            className="px-4 py-2 bg-accent-red/20 text-accent-red rounded-lg text-sm font-medium hover:bg-accent-red/30 transition-colors disabled:opacity-50"
          >
            {isClosing ? "Closing..." : "Close Position"}
          </button>
        </div>
      )}

      {position.status === "closed" && (
        <div className="flex items-center gap-2 pt-4 border-t border-shadow-500">
          <svg
            className="w-4 h-4 text-accent-green"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-xs text-gray-400">
            Settled - Only PnL revealed
          </span>
        </div>
      )}
    </div>
  );
}
