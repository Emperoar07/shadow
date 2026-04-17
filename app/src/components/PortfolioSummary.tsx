import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { createShadowPerpClient } from "../lib/create-client";
import {
  useAnchorWalletCompat,
  useWalletConnectionState,
} from "../lib/use-anchor-wallet";
import { fetchPrices } from "../lib/prices";
import {
  getOwnerPositionViews,
  removeOwnerPositionView,
} from "../lib/trade-automation";
import CollateralModal from "./CollateralModal";
import type { TradingPair } from "../lib/tokens";

interface PortfolioData {
  marginBalance: number;
  freeCollateral: number;
  lockedCollateral: number;
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

const PORTFOLIO_CACHE_KEY = "shadow:portfolio:v1";

function readCachedPortfolio(walletKey: string): PortfolioData | null {
  try {
    const raw = localStorage.getItem(`${PORTFOLIO_CACHE_KEY}:${walletKey}`);
    if (!raw) return null;
    return JSON.parse(raw) as PortfolioData;
  } catch {
    return null;
  }
}

function writeCachedPortfolio(walletKey: string, data: PortfolioData) {
  try {
    localStorage.setItem(`${PORTFOLIO_CACHE_KEY}:${walletKey}`, JSON.stringify(data));
  } catch {
    // storage quota exceeded — not fatal
  }
}

export default function PortfolioSummary({ onMarginReady, pair }: PortfolioSummaryProps = {}) {
  const anchorWallet = useAnchorWalletCompat();
  const { connected } = useWalletConnectionState();
  const publicKey = anchorWallet?.publicKey ?? null;
  const { connection } = useConnection();
  const [data, setData] = useState<PortfolioData | null>(null);
  const clientRef = useRef<ReturnType<typeof createShadowPerpClient> | null>(null);
  const [collateralModalOpen, setCollateralModalOpen] = useState(false);

  // Seed from cache as soon as the wallet key is known (autoconnect flash window)
  useEffect(() => {
    if (!publicKey) return;
    const cached = readCachedPortfolio(publicKey.toBase58());
    if (cached && !data) setData(cached);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  useEffect(() => {
    clientRef.current = null;
  }, [anchorWallet]);

  const loadPortfolio = useCallback(async () => {
    if (!publicKey || !anchorWallet) {
      // Wallet disconnected entirely — clear display
      if (!connected) setData(null);
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
      const lockedCollateral =
        marginResult.status === "fulfilled"
          ? new BN(marginResult.value.lockedBalance.toString()).toNumber() / 1_000_000
          : 0;
      const freeCollateral = Math.max(0, marginBalance - lockedCollateral);

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

      const next: PortfolioData = {
        marginBalance,
        freeCollateral,
        lockedCollateral,
        openPositions,
        accountEquity,
        unrealizedPnl,
        estimatedNotional,
        maintenanceMargin,
        crossAccountLeverage,
        accountHealth: health,
      };
      setData(next);
      // Persist so next refresh shows data immediately before wallet reconnects
      const walletKey = publicKey.toBase58();
      writeCachedPortfolio(walletKey, next);
      try { localStorage.setItem(`${PORTFOLIO_CACHE_KEY}:last`, walletKey); } catch { /* noop */ }
    } catch {
      // config/runtime errors — keep showing cached data, don't clear
    }
  }, [publicKey, anchorWallet, connection, pair, connected]);

  useEffect(() => {
    void loadPortfolio();
    const interval = setInterval(() => void loadPortfolio(), 15_000);
    return () => clearInterval(interval);
  }, [loadPortfolio]);

  useEffect(() => {
    onMarginReady?.(data?.marginBalance ?? null, () => setCollateralModalOpen(true));
  }, [data, onMarginReady]);


  // Hide when no wallet is connected (not even autoconnecting)
  if (!publicKey && !connected) return null;

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
    <div className="flex items-center gap-2 shrink-0 overflow-x-auto pb-1 sm:overflow-visible sm:pb-0">
      <SummaryStat
        label="Free Collateral"
        value={data ? `$${data.freeCollateral.toFixed(2)}` : "--"}
      />

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

      {/* Account Health */}
      <div className="flex min-w-[132px] flex-col gap-1 rounded-lg border border-shadow-700/80 bg-shadow-800/65 px-3 py-[7px] shrink-0">
        <span className="text-[10px] uppercase tracking-[0.12em] text-gray-400">Account Health</span>
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
      freeCollateral={data?.freeCollateral ?? null}
      lockedCollateral={data?.lockedCollateral ?? null}
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
    <div className="flex min-w-[120px] flex-col gap-1 rounded-lg border border-shadow-700/80 bg-shadow-800/65 px-3 py-[7px] shrink-0">
      <span className="text-[10px] uppercase tracking-[0.12em] text-gray-400">{label}</span>
      <span className="text-[13px] font-semibold leading-none text-gray-100">{value}</span>
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
