import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { createShadowPerpClient } from "../lib/create-client";
import { useAnchorWalletCompat } from "../lib/use-anchor-wallet";
import { fetchPrices } from "../lib/prices";
import {
  getOwnerPositionViews,
  removeOwnerPositionView,
} from "../lib/trade-automation";
import CollateralModal from "./CollateralModal";
import { useArciumPrivacy } from "../hooks/useArcium";

interface PortfolioData {
  marginBalance: number;
  openPositions: number;
  unrealizedPnl: number | null; // null = unavailable
  accountHealth: number; // 0-100
}

export default function PortfolioSummary() {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWalletCompat();
  const { connection } = useConnection();
  const [data, setData] = useState<PortfolioData | null>(null);
  const clientRef = useRef<ReturnType<typeof createShadowPerpClient> | null>(null);
  const [collateralModalOpen, setCollateralModalOpen] = useState(false);
  const {
    relayAvailable,
    relaySession,
    ensureRelaySession,
    invalidateRelaySession,
    refreshRelaySession,
  } = useArciumPrivacy();
  const isRelaySessionActive =
    !!relaySession &&
    relaySession.owner === publicKey?.toBase58() &&
    relaySession.usedActions < relaySession.maxActions &&
    relaySession.expiresAt - Math.floor(Date.now() / 1000) > 0;

  useEffect(() => {
    clientRef.current = null;
  }, [anchorWallet]);

  const loadPortfolio = useCallback(async () => {
    if (!publicKey || !anchorWallet) {
      setData(null);
      return;
    }

    try {
      if (!clientRef.current) {
        clientRef.current = createShadowPerpClient(connection, anchorWallet);
      }
      const { client, runtime } = clientRef.current;

      const [marginResult, positionsResult] = await Promise.allSettled([
        client.getMarginAccount(
          client.getMarginAccountAddress(runtime.marketAddress, publicKey)
        ),
        client.getUserPositionAccounts(runtime.marketAddress, publicKey),
      ]);
      const livePrices = await fetchPrices().catch(() => null);

      const marginBalance =
        marginResult.status === "fulfilled"
          ? new BN(marginResult.value.balance.toString()).toNumber() / 1_000_000
          : 0;

      let openPositions = 0;
      let ownerUnrealizedEstimate = 0;
      let ownerUnrealizedCount = 0;
      const ownerViews = getOwnerPositionViews();
      if (positionsResult.status === "fulfilled") {
        for (const p of positionsResult.value) {
          const account = p.account as any;
          const positionAddress = p.publicKey.toBase58();
          const status =
            typeof account.status === "number"
              ? account.status
              : Object.keys(account.status || {})[0]?.toLowerCase();
          const isOpen =
            status === "open" || status === 1 || status === "pending" || status === 0;
          if (status === "open" || status === 1 || status === "pending" || status === 0) {
            openPositions++;
          }

          const view = ownerViews[positionAddress];
          if (!isOpen && view) {
            removeOwnerPositionView(positionAddress);
          }

          if (!isOpen || !view) continue;
          const marketPrice = livePrices?.[view.pairLabel]?.price;
          if (!marketPrice || !Number.isFinite(marketPrice)) continue;

          const pnl =
            view.side === "long"
              ? (marketPrice - view.entryPrice) * view.sizeBase
              : (view.entryPrice - marketPrice) * view.sizeBase;
          if (!Number.isFinite(pnl)) continue;
          ownerUnrealizedEstimate += pnl;
          ownerUnrealizedCount += 1;
        }
      }

      // Health is based on margin utilization (simplified)
      const health = marginBalance > 0 ? Math.min(100, Math.max(0, (marginBalance / (marginBalance + 1)) * 100)) : 0;

      setData({
        marginBalance,
        openPositions,
        unrealizedPnl: ownerUnrealizedCount > 0 ? ownerUnrealizedEstimate : null,
        accountHealth: health,
      });
    } catch {
      // config/runtime errors
      setData(null);
    }
  }, [publicKey, anchorWallet, connection]);

  useEffect(() => {
    void loadPortfolio();
    const interval = setInterval(() => void loadPortfolio(), 15_000);
    return () => clearInterval(interval);
  }, [loadPortfolio]);

  if (!publicKey) return null;

  const healthColor =
    (data?.accountHealth ?? 0) > 70
      ? "text-accent-green"
      : (data?.accountHealth ?? 0) > 30
      ? "text-yellow-400"
      : "text-accent-red";

  const healthBarColor =
    (data?.accountHealth ?? 0) > 70
      ? "bg-accent-green"
      : (data?.accountHealth ?? 0) > 30
      ? "bg-yellow-400"
      : "bg-accent-red";

  return (
    <>
    <div className="trade-portfolio-inner bg-shadow-800 px-5 py-2.5">
      <div className="flex items-center justify-between gap-6 flex-wrap">
        {/* Left stats */}
        <div className="flex items-center gap-6 flex-wrap">
          {/* Open Positions */}
          <SummaryStat
            label="Open Positions"
            value={data ? `${data.openPositions}` : "--"}
          />

          <div className="w-px h-8 bg-shadow-500 hidden sm:block" />

          {/* Unrealized PnL */}
          <SummaryStat
            label="Unrealized PnL"
            value={
              (() => {
                const unrealized = data?.unrealizedPnl;
                if (unrealized === null || unrealized === undefined) {
                  return <span className="text-gray-400 text-sm">--</span>;
                }
                return (
                  <span className={unrealized >= 0 ? "text-accent-green text-sm" : "text-accent-red text-sm"}>
                    {unrealized >= 0 ? "+" : ""}${Math.abs(unrealized).toFixed(2)}
                  </span>
                );
              })()
            }
          />

          <div className="w-px h-8 bg-shadow-500 hidden sm:block" />

          {/* Account Health */}
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Account Health</p>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-shadow-600 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${healthBarColor}`}
                    style={{ width: `${data?.accountHealth ?? 0}%` }}
                  />
                </div>
                <span className={`text-sm font-semibold ${healthColor}`}>
                  {data ? `${data.accountHealth.toFixed(0)}%` : "--"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Margin Balance + Manage button */}
        <div className="flex items-center gap-3 shrink-0">
          <SummaryStat
            label="Margin Balance"
            value={data ? `$${data.marginBalance.toFixed(2)}` : "--"}
          />
          <button
            onClick={() => setCollateralModalOpen(true)}
            className="rounded-lg border border-accent-purple/35 bg-accent-purple/15 px-3 py-1.5 text-[11px] font-medium text-accent-purple transition-colors hover:bg-accent-purple/25"
          >
            {(data?.marginBalance ?? 0) === 0 ? "Deposit Collateral" : "Manage"}
          </button>
        </div>
      </div>
    </div>

    <CollateralModal
      isOpen={collateralModalOpen}
      marginBalance={data?.marginBalance ?? null}
      relayAvailable={relayAvailable}
      relaySession={relaySession}
      isRelaySessionActive={isRelaySessionActive}
      ensureRelaySession={ensureRelaySession}
      invalidateRelaySession={invalidateRelaySession}
      refreshRelaySession={refreshRelaySession}
      onClose={() => setCollateralModalOpen(false)}
      onSuccess={() => {
        setCollateralModalOpen(false);
        void loadPortfolio();
      }}
    />
    </>
  );
}

function SummaryStat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-200">
        {value}
      </p>
    </div>
  );
}
