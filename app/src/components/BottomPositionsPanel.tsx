import { useCallback, useEffect, useMemo, useState } from "react";
import BN from "bn.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import toast from "react-hot-toast";
import { createShadowPerpClient } from "../lib/create-client";
import { useAnchorWalletCompat } from "../lib/use-anchor-wallet";

type UiStatus = "open" | "closing" | "closed" | "pending" | "liquidated";

interface UiPosition {
  address: string;
  index: BN;
  status: UiStatus;
  margin: number;
  openedAt: Date;
  realizedPnl: number;
  hasEncryptedData: boolean;
}

function parseStatus(status: unknown): UiStatus {
  if (typeof status === "number") {
    if (status === 0) return "pending";
    if (status === 1) return "open";
    if (status === 2) return "closing";
    if (status === 3) return "closed";
    return "liquidated";
  }
  if (status && typeof status === "object") {
    const key = Object.keys(status as Record<string, unknown>)[0]?.toLowerCase();
    if (key === "pending") return "pending";
    if (key === "open") return "open";
    if (key === "closing") return "closing";
    if (key === "closed") return "closed";
    if (key === "liquidated") return "liquidated";
  }
  return "open";
}

const STATUS_COLORS: Record<UiStatus, string> = {
  pending: "text-yellow-400 bg-yellow-400/15",
  open: "text-accent-green bg-accent-green/15",
  closing: "text-yellow-400 bg-yellow-400/15",
  closed: "text-gray-400 bg-gray-400/15",
  liquidated: "text-accent-red bg-accent-red/15",
};

const STATUS_LABELS: Record<UiStatus, string> = {
  pending: "MPC Processing",
  open: "Open",
  closing: "Closing",
  closed: "Settled",
  liquidated: "Liquidated",
};

function StatusBadge({ status, isClosing }: { status: UiStatus; isClosing: boolean }) {
  const animated = status === "pending" || status === "closing" || isClosing;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[status]}`}
    >
      {animated && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse flex-shrink-0" />
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? "border-accent-purple text-white"
          : "border-transparent text-gray-400 hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

export default function BottomPositionsPanel() {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWalletCompat();
  const { connection } = useConnection();
  const [positions, setPositions] = useState<UiPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [closingAddress, setClosingAddress] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"open" | "history">("open");

  const loadPositions = useCallback(async () => {
    if (!publicKey || !anchorWallet) return;
    setLoading(true);
    try {
      const { client, runtime } = createShadowPerpClient(connection, anchorWallet);
      const onchain = await client.getUserPositionAccounts(runtime.marketAddress, publicKey);
      const mapped: UiPosition[] = onchain.map((p) => {
        const account = p.account as any;
        const encData: number[] | Uint8Array = account.encryptedData ?? [];
        return {
          address: p.publicKey.toBase58(),
          index: new BN(account.index.toString()),
          status: parseStatus(account.status),
          margin: new BN(account.margin.toString()).toNumber() / 1_000_000,
          openedAt: new Date(new BN(account.openedAt.toString()).toNumber() * 1000),
          realizedPnl: new BN(account.realizedPnl.toString()).toNumber() / 1_000_000,
          hasEncryptedData: Array.from(encData).some((b: number) => b !== 0),
        };
      });
      mapped.sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
      setPositions(mapped);
    } catch {
      // silent in demo / config error
    } finally {
      setLoading(false);
    }
  }, [publicKey, anchorWallet, connection]);

  useEffect(() => {
    void loadPositions();
    const id = setInterval(() => void loadPositions(), 15_000);
    return () => clearInterval(id);
  }, [loadPositions]);

  const handleClose = useCallback(
    async (pos: UiPosition) => {
      if (!publicKey || !anchorWallet) return;
      setClosingAddress(pos.address);
      try {
        const { client, runtime } = createShadowPerpClient(connection, anchorWallet);
        const ownerTokenAccount = await client.getOwnerCollateralTokenAccount(
          runtime.marketAddress
        );
        toast.loading("Queuing close via Arcium MPC...", { id: pos.address });
        const tx = await client.closePosition(
          runtime.marketAddress,
          pos.index,
          ownerTokenAccount
        );
        toast.success(
          <div>
            <p className="font-medium">Close queued for MPC computation</p>
            <p className="text-xs text-gray-400 mt-0.5">PnL revealed after MPC completes</p>
            <a
              href={`https://explorer.solana.com/tx/${tx}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent-purple underline mt-1 block"
            >
              View transaction
            </a>
          </div>,
          { id: pos.address, duration: 10_000 }
        );
        await loadPositions();
      } catch (error: any) {
        const msg = error?.message ?? "Failed to close position";
        if (!msg.includes("env var")) toast.error(msg, { id: pos.address });
      } finally {
        setClosingAddress(null);
      }
    },
    [publicKey, anchorWallet, connection, loadPositions]
  );

  const openPositions = useMemo(
    () => positions.filter((p) => ["open", "pending", "closing"].includes(p.status)),
    [positions]
  );
  const historyPositions = useMemo(
    () => positions.filter((p) => ["closed", "liquidated"].includes(p.status)),
    [positions]
  );
  const displayed = activeTab === "open" ? openPositions : historyPositions;
  const showActionCol = activeTab === "open";

  return (
    <div className="position-card rounded-xl overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center justify-between border-b border-shadow-600 pl-1">
        <div className="flex">
          <TabBtn active={activeTab === "open"} onClick={() => setActiveTab("open")}>
            Open Positions
            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-shadow-600 text-[10px] text-gray-300">
              {openPositions.length}
            </span>
          </TabBtn>
          <TabBtn active={activeTab === "history"} onClick={() => setActiveTab("history")}>
            History
            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-shadow-600 text-[10px] text-gray-300">
              {historyPositions.length}
            </span>
          </TabBtn>
        </div>

        <div className="flex items-center gap-3 pr-4">
          {/* Privacy note */}
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-accent-purple">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                clipRule="evenodd"
              />
            </svg>
            Size, leverage & direction encrypted via Arcium MPC
          </div>
          <button
            onClick={() => void loadPositions()}
            disabled={loading}
            className="text-xs text-gray-500 hover:text-accent-purple transition-colors py-2.5 disabled:opacity-40"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto" style={{ maxHeight: 200, overflowY: "auto" }}>
        {displayed.length === 0 ? (
          <div className="py-7 text-center text-sm text-gray-500">
            {!publicKey
              ? "Connect wallet to view positions"
              : activeTab === "open"
              ? "No open positions — open a trade using the panel above"
              : "No closed positions yet"}
          </div>
        ) : (
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="text-gray-500 border-b border-shadow-700">
                <th className="text-left px-4 py-2 font-medium">#</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Opened</th>
                <th className="text-right px-3 py-2 font-medium">Margin</th>
                <th className="text-right px-3 py-2 font-medium">Size & Direction</th>
                <th className="text-right px-3 py-2 font-medium">Leverage</th>
                <th className="text-right px-3 py-2 font-medium">Realized PnL</th>
                {showActionCol && <th className="text-right px-4 py-2 font-medium">Action</th>}
              </tr>
            </thead>
            <tbody>
              {displayed.map((pos) => {
                const isOpen = pos.status === "open";
                const isPending = pos.status === "pending";
                const isClosing = closingAddress === pos.address || pos.status === "closing";
                const isFinal = pos.status === "closed" || pos.status === "liquidated";

                return (
                  <tr
                    key={pos.address}
                    className="border-b border-shadow-700 hover:bg-shadow-700/30 transition-colors"
                  >
                    {/* Index */}
                    <td className="px-4 py-2.5 text-gray-400">
                      #{pos.index.toString()}
                    </td>

                    {/* Status */}
                    <td className="px-3 py-2.5">
                      <StatusBadge status={pos.status} isClosing={isClosing} />
                    </td>

                    {/* Opened */}
                    <td className="px-3 py-2.5 text-gray-400 whitespace-nowrap">
                      {pos.openedAt.toLocaleDateString()}{" "}
                      {pos.openedAt.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>

                    {/* Margin */}
                    <td className="px-3 py-2.5 text-right font-medium">
                      ${pos.margin.toFixed(2)}
                    </td>

                    {/* Size & Direction — always encrypted */}
                    <td className="px-3 py-2.5 text-right">
                      <span className="encrypted-blur text-accent-purple text-[10px]">
                        Encrypted
                      </span>
                    </td>

                    {/* Leverage — always encrypted */}
                    <td className="px-3 py-2.5 text-right">
                      <span className="encrypted-blur text-accent-purple text-[10px]">
                        Encrypted
                      </span>
                    </td>

                    {/* PnL */}
                    <td className="px-3 py-2.5 text-right">
                      {isFinal ? (
                        <span
                          className={`font-medium ${
                            pos.realizedPnl >= 0 ? "text-accent-green" : "text-accent-red"
                          }`}
                        >
                          {pos.realizedPnl >= 0 ? "+" : ""}${pos.realizedPnl.toFixed(2)}
                        </span>
                      ) : (
                        <span className="encrypted-blur text-accent-purple text-[10px]">
                          Hidden until close
                        </span>
                      )}
                    </td>

                    {/* Action */}
                    {showActionCol && (
                      <td className="px-4 py-2.5 text-right">
                        {(isOpen || isPending || isClosing) && (
                          <button
                            onClick={() => void handleClose(pos)}
                            disabled={isClosing || isPending}
                            className="px-3 py-1 rounded text-[11px] font-medium bg-accent-red/15 text-accent-red hover:bg-accent-red/25 transition-colors disabled:opacity-40 whitespace-nowrap"
                          >
                            {isPending
                              ? "MPC Processing..."
                              : isClosing
                              ? "Closing..."
                              : "Close Position"}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
