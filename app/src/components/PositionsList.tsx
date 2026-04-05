import { useCallback, useEffect, useMemo, useState } from "react";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import toast from "react-hot-toast";
import { createShadowPerpClient } from "../lib/create-client";
import { useAnchorWalletCompat } from "../lib/use-anchor-wallet";
import { getExplorerTxUrl } from "../lib/explorer";
import { TRADING_DISABLED } from "../lib/feature-flags";

type UiStatus = "open" | "closing" | "closed" | "pending" | "liquidated" | "settling";

interface UiPosition {
  address: string;
  marketAddress: string;
  index: BN;
  status: UiStatus;
  margin: number;
  openedAt: Date;
  realizedPnl?: number;
  hasEncryptedData: boolean;
}

function parseStatus(status: unknown): UiStatus {
  if (typeof status === "number") {
    if (status === 0) return "pending";
    if (status === 1) return "open";
    if (status === 2) return "closing";
    if (status === 3) return "closed";
    if (status === 5 || status === 6) return "settling";
    return "liquidated";
  }
  if (status && typeof status === "object") {
    const key = Object.keys(status as Record<string, unknown>)[0]?.toLowerCase();
    if (key === "pending") return "pending";
    if (key === "open") return "open";
    if (key === "closing") return "closing";
    if (key === "closed") return "closed";
    if (key === "closedpendingsettlement" || key === "liquidatedpendingsettlement") {
      return "settling";
    }
    if (key === "liquidated") return "liquidated";
  }
  return "open";
}

const STATUS_CONFIG: Record<UiStatus, { label: string; color: string; bgColor: string }> = {
  pending: { label: "MPC Processing", color: "text-yellow-400", bgColor: "bg-yellow-400/20" },
  open: { label: "Open", color: "text-accent-green", bgColor: "bg-accent-green/20" },
  closing: { label: "MPC Closing", color: "text-yellow-400", bgColor: "bg-yellow-400/20" },
  settling: { label: "Settling", color: "text-cyan-300", bgColor: "bg-cyan-400/15" },
  closed: { label: "Settled", color: "text-gray-400", bgColor: "bg-gray-400/20" },
  liquidated: { label: "Liquidated", color: "text-accent-red", bgColor: "bg-accent-red/20" },
};

export default function PositionsList() {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWalletCompat();
  const { connection } = useConnection();
  const [positions, setPositions] = useState<UiPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [closingAddress, setClosingAddress] = useState<string | null>(null);

  const loadPositions = useCallback(async () => {
    if (!publicKey || !anchorWallet) return;
    setLoading(true);
    try {
      const { client, runtime } = createShadowPerpClient(connection, anchorWallet);
      const marketEntries = Array.from(
        new Map(
          Object.values(runtime.marketRegistry).map((address) => [address.toBase58(), address])
        ).values()
      );
      if (!marketEntries.some((address) => address.equals(runtime.marketAddress))) {
        marketEntries.unshift(runtime.marketAddress);
      }
      const onchain = await client.getUserPositionAccountsAcrossMarkets(marketEntries, publicKey);
      const mapped: UiPosition[] = onchain.map((p) => {
        const account = p.account as any;
        const marginBn = new BN(account.margin.toString());
        const openedAtBn = new BN(account.openedAt.toString());
        const pnlBn = new BN(account.realizedPnl.toString());
        const encData: number[] | Uint8Array = account.encryptedData ?? [];
        const hasEnc = Array.from(encData).some((b: number) => b !== 0);
        return {
          address: p.publicKey.toBase58(),
          marketAddress: new PublicKey(account.market).toBase58(),
          index: new BN(account.index.toString()),
          status: parseStatus(account.status),
          margin: marginBn.toNumber() / 1_000_000,
          openedAt: new Date(openedAtBn.toNumber() * 1000),
          realizedPnl: pnlBn.toNumber() / 1_000_000,
          hasEncryptedData: hasEnc,
        };
      });
      mapped.sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
      setPositions(mapped);
    } catch {
      // Config/runtime errors can occur during wallet/network transitions - fail silently
    } finally {
      setLoading(false);
    }
  }, [publicKey, anchorWallet, connection]);

  useEffect(() => {
    void loadPositions();
  }, [loadPositions]);

  const handleClose = useCallback(
    async (position: UiPosition) => {
      if (TRADING_DISABLED) {
        toast.error("Trading is temporarily disabled while Arcium devnet is being patched.");
        return;
      }
      if (!publicKey || !anchorWallet) return;
      setClosingAddress(position.address);
      try {
        const { client } = createShadowPerpClient(connection, anchorWallet);
        const marketAddress = new PublicKey(position.marketAddress);
        const ownerTokenAccount = await client.getOwnerCollateralTokenAccount(marketAddress);
        toast.loading("Queuing close via Arcium MPC...", { id: position.address });
        const tx = await client.closePosition(marketAddress, position.index);
        toast.loading("Awaiting MPC callback and settlement...", { id: position.address });
        const finalized = await client.finalizeClosePosition(
          marketAddress,
          publicKey,
          position.index,
          ownerTokenAccount
        );
        const txUrl = getExplorerTxUrl(tx);
        const settleUrl = finalized.settleTxSignature
          ? getExplorerTxUrl(finalized.settleTxSignature)
          : null;
        toast.success(
          <div>
            <p className="font-medium">Position closed and settled</p>
            <p className="text-xs text-gray-400 mt-1">PnL was revealed by MPC and settlement completed on-chain</p>
            <a
              href={txUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent-purple underline mt-1 block"
            >
              View close transaction
            </a>
            {settleUrl ? (
              <a
                href={settleUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent-purple underline mt-1 block"
              >
                View settlement transaction
              </a>
            ) : null}
          </div>,
          { id: position.address, duration: 10000 }
        );
        await loadPositions();
      } catch (error: any) {
        const msg = error?.message || "Failed to close position";
        if (msg.includes("env var")) return; // config/runtime error
        toast.error(msg, { id: position.address });
      } finally {
        setClosingAddress(null);
      }
    },
    [publicKey, anchorWallet, connection, loadPositions]
  );

  const openPositions = useMemo(
    () =>
      positions.filter(
        (p) =>
          p.status === "open" ||
          p.status === "pending" ||
          p.status === "closing" ||
          p.status === "settling"
      ),
    [positions]
  );
  const closedPositions = useMemo(
    () => positions.filter((p) => p.status === "closed" || p.status === "liquidated"),
    [positions]
  );

  return (
    <div className="space-y-6">
      <div className="position-card rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Open Positions</h2>
          <button
            onClick={() => void loadPositions()}
            disabled={loading}
            className="text-sm text-accent-purple hover:underline disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {loading && positions.length === 0 ? (
          <p className="text-gray-400 text-center py-8">Loading positions...</p>
        ) : openPositions.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-400">No open positions.</p>
            <p className="text-xs text-gray-500 mt-1">Open a position to trade privately via Arcium MPC</p>
          </div>
        ) : (
          <div className="space-y-4">
            {openPositions.map((position) => (
              <PositionCard
                key={position.address}
                position={position}
                onClose={() => void handleClose(position)}
                closing={closingAddress === position.address}
              />
            ))}
          </div>
        )}
      </div>

      <div className="position-card rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-4">Position History</h2>
        {closedPositions.length === 0 ? (
          <p className="text-gray-400 text-center py-8">No closed positions yet.</p>
        ) : (
          <div className="space-y-4">
            {closedPositions.map((position) => (
              <PositionCard key={position.address} position={position} />
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
  closing = false,
}: {
  position: UiPosition;
  onClose?: () => void;
  closing?: boolean;
}) {
  const isOpen = position.status === "open";
  const isPending = position.status === "pending";
  const isClosing = closing || position.status === "closing";
  const isSettling = position.status === "settling";
  const isFinal = position.status === "closed" || position.status === "liquidated";
  const statusCfg = STATUS_CONFIG[position.status];

  return (
    <div className="bg-shadow-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="px-2 py-1 rounded text-xs font-medium bg-shadow-600 text-gray-200">
            #{position.index.toString()}
          </span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusCfg.bgColor} ${statusCfg.color}`}>
            {isPending || isClosing ? (
              <span className="flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                {statusCfg.label}
              </span>
            ) : (
              statusCfg.label
            )}
          </span>
          <span className="text-sm text-gray-400">{position.openedAt.toLocaleString()}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div>
          <p className="text-xs text-gray-500 mb-1">Margin</p>
          <p className="text-sm font-medium">${position.margin.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Size & Direction</p>
          <p className="text-sm encrypted-blur">Encrypted</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Leverage</p>
          <p className="text-sm encrypted-blur">Encrypted</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Realized PnL</p>
          {isFinal && position.realizedPnl !== undefined ? (
            <p className={`text-sm font-medium ${position.realizedPnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
              {position.realizedPnl >= 0 ? "+" : ""}${position.realizedPnl.toFixed(2)}
            </p>
          ) : (
            <p className="text-sm encrypted-blur">Hidden until close</p>
          )}
        </div>
      </div>

      {position.hasEncryptedData && !isFinal && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-accent-purple/10 rounded-lg">
          <svg className="w-3.5 h-3.5 text-accent-purple" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-xs text-accent-purple">
            Position data encrypted via Arcium MPC — only you and the MXE cluster can decrypt
          </span>
        </div>
      )}

      {(isOpen || isPending || isClosing || isSettling) && onClose && (
        <div className="flex items-center justify-between pt-4 border-t border-shadow-500">
          <span className="text-xs text-gray-500">
            {isPending
              ? "MPC is validating your position..."
              : isSettling
              ? "MPC finalized. Waiting for the settlement transfer..."
              : isClosing
              ? "MPC is computing PnL..."
              : "Close to reveal PnL via MPC"}
          </span>
          <button
            onClick={onClose}
            disabled={TRADING_DISABLED || isClosing || isPending || isSettling}
            className="px-4 py-2 bg-accent-red/20 text-accent-red rounded-lg text-sm font-medium hover:bg-accent-red/30 transition-colors disabled:opacity-50"
          >
            {TRADING_DISABLED
              ? "Disabled"
              : isPending
              ? "MPC Processing..."
              : isSettling
              ? "Settling..."
              : isClosing
              ? "Computing PnL..."
              : "Close Position"}
          </button>
        </div>
      )}

      {isFinal && (
        <div className="flex items-center gap-2 pt-4 border-t border-shadow-500 text-xs text-gray-400">
          <svg className="w-3.5 h-3.5 text-accent-green" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span>
            {position.status === "liquidated" ? "Liquidated" : "Settled"} — only PnL was revealed, position details remain encrypted
          </span>
        </div>
      )}
    </div>
  );
}
