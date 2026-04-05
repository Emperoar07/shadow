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
import type { TradingPair } from "../lib/tokens";

interface PortfolioData {
  marginBalance: number;
  openPositions: number;
  accountEquity: number | null;
  unrealizedPnl: number | null; // null = unavailable
  estimatedNotional: number;
  maintenanceMargin: number;
  crossAccountLeverage: number | null;
  accountHealth: number; // 0-100
}

interface PortfolioSummaryProps {
  onMarginReady?: (balance: number | null, openModal: () => void) => void;
  pair?: TradingPair;
}

export default function PortfolioSummary({ onMarginReady, pair }: PortfolioSummaryProps = {}) {
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
      const marketEntries = Array.from(
        new Map(
          Object.entries(runtime.marketRegistry).map(([label, address]) => [
            address.toBase58(),
            { label, address },
          ])
        ).values()
      );
      if (!marketEntries.some((entry) => entry.address.equals(runtime.marketAddress))) {
        marketEntries.unshift({
          label: pair?.label ?? "SOL-USD",
          address: runtime.marketAddress,
        });
      }

      const [marginResult, positionsResult] = await Promise.allSettled([
        client.getMarginAccount(client.getMarginAccountAddress(publicKey)),
        client.getUserPositionAccountsAcrossMarkets(
          marketEntries.map(({ address }) => address),
          publicKey
        ),
      ]);
      const livePrices = await fetchPrices().catch(() => null);

      const marginBalance =
        marginResult.status === "fulfilled"
          ? new BN(marginResult.value.balance.toString()).toNumber() / 1_000_000
          : 0;

      let openPositions = 0;
      let ownerUnrealizedEstimate = 0;
      let ownerUnrealizedCount = 0;
      let estimatedNotional = 0;
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
          const notional = Math.abs(view.sizeBase * marketPrice);
          if (Number.isFinite(notional) && notional > 0) {
            estimatedNotional += notional;
          }
          ownerUnrealizedEstimate += pnl;
          ownerUnrealizedCount += 1;
        }
      }

      const unrealizedPnl = ownerUnrealizedCount > 0 ? ownerUnrealizedEstimate : null;
      const equityRaw = marginBalance + (unrealizedPnl ?? 0);
      const accountEquity =
        Number.isFinite(equityRaw) ? Math.max(0, equityRaw) : null;
      const maintenanceMargin = estimatedNotional * 0.05;
      const crossAccountLeverage =
        accountEquity && accountEquity > 0
          ? estimatedNotional / accountEquity
          : null;

      // Health estimate: equity relative to posted margin.
      // 100% means equity ~= posted margin; <100% means drawdown, >100% is clamped.
      const health =
        marginBalance > 0 && accountEquity !== null
          ? Math.min(100, Math.max(0, (accountEquity / marginBalance) * 100))
          : marginBalance > 0
          ? 100
          : 0;

      setData({
        marginBalance,
        openPositions,
        accountEquity,
        unrealizedPnl,
        estimatedNotional,
        maintenanceMargin,
        crossAccountLeverage,
        accountHealth: health,
      });
    } catch {
      // config/runtime errors
      setData(null);
    }
  }, [publicKey, anchorWallet, connection, pair]);

  useEffect(() => {
    void loadPortfolio();
    const interval = setInterval(() => void loadPortfolio(), 15_000);
    return () => clearInterval(interval);
  }, [loadPortfolio]);

  useEffect(() => {
    onMarginReady?.(data?.marginBalance ?? null, () => setCollateralModalOpen(true));
  }, [data, onMarginReady]);


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
    <div className="flex items-center gap-4 shrink-0">
      {/* Open Positions */}
      <SummaryStat
        label="Open Positions"
        value={data ? `${data.openPositions}` : "--"}
      />


      {/* Unrealized PnL */}
      <SummaryStat
        label="Unrealized PnL"
        value={
          (() => {
            const unrealized = data?.unrealizedPnl;
            if (unrealized === null || unrealized === undefined) {
              return <span className="text-gray-400 text-xs">--</span>;
            }
            return (
              <span className={unrealized >= 0 ? "text-accent-green text-xs" : "text-accent-red text-xs"}>
                {unrealized >= 0 ? "+" : ""}${Math.abs(unrealized).toFixed(2)}
              </span>
            );
          })()
        }
      />

      <div className="w-px h-5 bg-shadow-600 shrink-0" />

      {/* Account Health */}
      <div className="flex flex-col gap-0.5 shrink-0">
        <span className="text-[10px] uppercase tracking-[0.1em] text-gray-500">Account Health</span>
        <div className="flex items-center gap-2">
          <div className="w-16 h-1.5 bg-shadow-600 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${healthBarColor}`}
              style={{ width: `${data?.accountHealth ?? 0}%` }}
            />
          </div>
          <span className={`text-xs font-semibold ${healthColor}`}>
            {data ? `${data.accountHealth.toFixed(0)}%` : "--"}
          </span>
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
      pairLabel={pair?.label}
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
    <div className="flex flex-col gap-0.5 shrink-0">
      <span className="text-[10px] uppercase tracking-[0.1em] text-gray-500">{label}</span>
      <span className="text-xs font-semibold text-gray-200">{value}</span>
    </div>
  );
}

function EquityRow({
  label,
  value,
  valueClass = "text-gray-200",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-gray-400">{label}</span>
      <span className={`text-sm font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `$${value.toFixed(2)}`;
}

function formatSignedUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value.toFixed(2)}%`;
}

function formatLeverage(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value.toFixed(2)}x`;
}
