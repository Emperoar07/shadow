import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { createShadowPerpClient } from "../lib/create-client";
import { useAnchorWalletCompat } from "../lib/use-anchor-wallet";
import { fetchPrices } from "../lib/prices";
import {
  RELAY_SESSION_RENEW_BEFORE_SECONDS,
  useArciumPrivacy,
} from "../hooks/useArcium";
import {
  getOwnerPositionViews,
  removeOwnerPositionView,
} from "../lib/trade-automation";

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
  const { relaySession, relayAvailable, refreshRelaySession } = useArciumPrivacy();
  const [data, setData] = useState<PortfolioData | null>(null);
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));
  const clientRef = useRef<ReturnType<typeof createShadowPerpClient> | null>(null);

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

  useEffect(() => {
    const interval = setInterval(() => setNowTs(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!publicKey) return;
    void refreshRelaySession();
    const interval = setInterval(() => void refreshRelaySession(), 30_000);
    return () => clearInterval(interval);
  }, [publicKey, refreshRelaySession]);

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

  const isRelaySessionActive =
    !!relaySession &&
    relaySession.owner === publicKey.toBase58() &&
    relaySession.expiresAt - nowTs > RELAY_SESSION_RENEW_BEFORE_SECONDS &&
    relaySession.usedActions < relaySession.maxActions;
  const relayMinutesLeft = isRelaySessionActive
    ? Math.max(0, Math.floor((relaySession.expiresAt - nowTs) / 60))
    : 0;

  return (
    <div className="gradient-border-card rounded-xl p-[1px] mb-6 animate-in">
      <div className="bg-shadow-800 rounded-xl px-5 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-6 flex-wrap">
          {/* Margin Balance */}
          <SummaryStat
            label="Margin Balance"
            value={data ? `$${data.marginBalance.toFixed(2)}` : "--"}
            icon={
              <svg className="w-4 h-4 text-accent-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
            }
          />

          {/* Divider */}
          <div className="w-px h-8 bg-shadow-500 hidden sm:block" />

          {/* Open Positions */}
          <SummaryStat
            label="Open Positions"
            value={data ? `${data.openPositions}` : "--"}
            icon={
              <svg className="w-4 h-4 text-accent-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            }
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
            icon={
              <svg className="w-4 h-4 text-accent-purple" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                  clipRule="evenodd"
                />
              </svg>
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

          <div className="ml-auto flex items-center">
            <div
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                isRelaySessionActive
                  ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-300"
                  : relayAvailable
                  ? "border-cyan-400/35 bg-cyan-500/10 text-cyan-200"
                  : "border-yellow-500/35 bg-yellow-500/10 text-yellow-300"
              }`}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M10 2a4 4 0 00-4 4v2H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-1V6a4 4 0 00-4-4zm2 6V6a2 2 0 10-4 0v2h4z"
                  clipRule="evenodd"
                />
              </svg>
              {isRelaySessionActive ? (
                <span>Delegated session active - {relayMinutesLeft}m left</span>
              ) : relayAvailable ? (
                <span>Session required</span>
              ) : (
                <span>Relay unavailable</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-shadow-700 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm font-semibold text-gray-200">
          {typeof value === "string" ? value : value}
        </p>
      </div>
    </div>
  );
}
