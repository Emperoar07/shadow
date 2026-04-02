import { useEffect, useRef, useState } from "react";
import { TradingPair, TRADING_PAIRS } from "../lib/tokens";
import {
  getDefaultGrouping,
  formatPrice,
  formatSize,
  formatTime,
  getGroupingOptions,
  groupLevelsAdaptive,
  type ReferenceDepthSnapshot,
  type GroupedReferenceLevel,
  type ReferenceTrade,
} from "../lib/reference-depth";
import type { MarketSnapshot } from "../hooks/useMarketSnapshot";

interface PrivateOrderbookProps {
  pair?: TradingPair;
  marketSnapshot?: MarketSnapshot;
  referencePrice?: number | null;
  className?: string;
  activeTab?: "book" | "trades";
  onTabChange?: (tab: "book" | "trades") => void;
  animate?: boolean;
}

function priceForGrouping(snapshot: ReferenceDepthSnapshot | null, referencePrice?: number | null): number | null {
  if (snapshot?.lastTrade?.price) return snapshot.lastTrade.price;
  if (snapshot?.bids?.[0]?.price && snapshot?.asks?.[0]?.price) {
    return (snapshot.bids[0].price + snapshot.asks[0].price) / 2;
  }
  return referencePrice ?? null;
}

export default function PrivateOrderbook({
  pair,
  marketSnapshot,
  referencePrice,
  className = "",
  activeTab,
  onTabChange,
  animate = true,
}: PrivateOrderbookProps) {
  const [internalTab, setInternalTab] = useState<"book" | "trades">("book");
  const [bookLayout, setBookLayout] = useState<"both" | "bids" | "asks">("both");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [groupingOpen, setGroupingOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isMobile, setIsMobile] = useState(false);
  const groupingRef = useRef<HTMLDivElement>(null);

  const activePair = pair ?? TRADING_PAIRS[0];
  const tab = activeTab ?? internalTab;
  const snapshot: ReferenceDepthSnapshot | null = marketSnapshot?.depthSnapshot ?? null;
  const currentReferencePrice = priceForGrouping(snapshot, referencePrice);
  const groupingOptions = getGroupingOptions(currentReferencePrice);
  const [grouping, setGrouping] = useState(getDefaultGrouping(currentReferencePrice));

  useEffect(() => {
    setGrouping(getDefaultGrouping(priceForGrouping(snapshot, referencePrice)));
  }, [activePair.label]);

  useEffect(() => {
    if (!activeTab) {
      setInternalTab("book");
    }
  }, [activePair.label, activeTab]);

  useEffect(() => {
    const nextOptions = getGroupingOptions(currentReferencePrice);
    if (!nextOptions.includes(grouping)) {
      setGrouping(getDefaultGrouping(currentReferencePrice));
    }
  }, [currentReferencePrice, grouping]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (groupingRef.current && !groupingRef.current.contains(e.target as Node)) {
        setGroupingOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const syncViewport = () => setIsMobile(window.innerWidth < 640);
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    if (marketSnapshot?.depthSnapshot) {
      setFetchError(null);
      return;
    }
    if (marketSnapshot) {
      setFetchError("Reference depth unavailable");
    }
  }, [marketSnapshot]);

  const quoteSymbol = snapshot?.quoteSymbol ?? activePair.quote.symbol;
  const baseSymbol = activePair.base.symbol;
  const singleSide = bookLayout !== "both";
  const maxLevels = isMobile ? (singleSide ? 28 : 16) : singleSide ? 48 : 24;
  const minLevels = isMobile ? (singleSide ? 14 : 8) : singleSide ? 24 : 12;
  const groupedAsks = groupLevelsAdaptive(
    snapshot?.asks ?? [],
    groupingOptions,
    grouping,
    "asks",
    maxLevels,
    minLevels
  );
  const groupedBids = groupLevelsAdaptive(
    snapshot?.bids ?? [],
    groupingOptions,
    grouping,
    "bids",
    maxLevels,
    minLevels
  );
  const trades = snapshot?.trades ?? [];

  const bidTotal = groupedBids.length > 0 ? groupedBids[groupedBids.length - 1].total : 0;
  const askTotal = groupedAsks.length > 0 ? groupedAsks[groupedAsks.length - 1].total : 0;
  const bidPct = bidTotal + askTotal > 0 ? (bidTotal / (bidTotal + askTotal)) * 100 : 50;
  const ageMs = snapshot ? Math.max(0, nowMs - snapshot.fetchedAt) : null;
  const ageSeconds = ageMs !== null ? Math.floor(ageMs / 1000) : null;
  const isFresh = ageMs !== null && ageMs < 10_000;

  return (
    <div className={`trade-orderbook flex flex-col bg-shadow-900 h-full ${className}`}>
      <div className="flex items-center justify-between border-b border-shadow-600 px-2 shrink-0">
        <div className="flex items-center">
          {(["book", "trades"] as const).map((nextTab) => (
            <button
              key={nextTab}
              onClick={() => {
                if (activeTab) {
                  onTabChange?.(nextTab);
                } else {
                  setInternalTab(nextTab);
                }
              }}
              className={`relative mr-3 py-1 text-[11px] font-semibold transition-colors ${
                tab === nextTab ? "text-white" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {nextTab === "book" ? "Order Book" : "Trades"}
              {tab === nextTab && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-cyan-400" />
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {/* Layout toggle — always visible in header */}
          {tab === "book" && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setBookLayout("both")}
                title="Both"
                className={`flex flex-col gap-[2px] p-1 rounded transition-opacity ${bookLayout === "both" ? "opacity-100" : "opacity-30 hover:opacity-60"}`}
              >
                <span className="block w-[14px] h-[5px] rounded-[1px] bg-accent-red/80" />
                <span className="block w-[14px] h-[5px] rounded-[1px] bg-accent-green/80" />
              </button>
              <button
                onClick={() => setBookLayout("bids")}
                title="Bids only"
                className={`flex flex-col gap-[2px] p-1 rounded transition-opacity ${bookLayout === "bids" ? "opacity-100" : "opacity-30 hover:opacity-60"}`}
              >
                <span className="block w-[14px] h-[5px] rounded-[1px] bg-shadow-600" />
                <span className="block w-[14px] h-[5px] rounded-[1px] bg-accent-green/80" />
              </button>
              <button
                onClick={() => setBookLayout("asks")}
                title="Asks only"
                className={`flex flex-col gap-[2px] p-1 rounded transition-opacity ${bookLayout === "asks" ? "opacity-100" : "opacity-30 hover:opacity-60"}`}
              >
                <span className="block w-[14px] h-[5px] rounded-[1px] bg-accent-red/80" />
                <span className="block w-[14px] h-[5px] rounded-[1px] bg-shadow-600" />
              </button>
            </div>
          )}
          {snapshot && (
            <span
              className={`h-1.5 w-1.5 rounded-full ${isFresh ? "bg-emerald-400" : "bg-yellow-300"}`}
              style={{ animation: isFresh ? "pulse-dot 2s ease-in-out infinite" : undefined }}
            />
          )}
        </div>
      </div>

      {/* Buy / Sell pressure bar */}
      {tab === "book" && (
        <BuySellBar
          leftPct={bidPct}
          leftLabel="Bid"
          rightLabel="Ask"
          leftColor="green"
          rightColor="red"
        />
      )}
      {tab === "trades" && trades.length > 0 && (() => {
        const recent = trades.slice(0, 30);
        const buyVol = recent.filter((t) => t.side !== "sell").reduce((s, t) => s + t.size, 0);
        const totalVol = recent.reduce((s, t) => s + t.size, 0);
        const buyPctTrades = totalVol > 0 ? (buyVol / totalVol) * 100 : 50;
        return (
          <BuySellBar
            leftPct={buyPctTrades}
            leftLabel="Buy"
            rightLabel="Sell"
            leftColor="green"
            rightColor="red"
          />
        );
      })()}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex flex-col min-h-0 w-full">
          {tab === "book" ? (
            <>
              <div className="flex items-center px-2 py-[3px] border-b border-shadow-600 shrink-0 gap-2">
                <div className="relative shrink-0" ref={groupingRef}>
                  <button
                    onClick={() => setGroupingOpen((open) => !open)}
                    className="flex items-center gap-0.5 text-[11px] font-semibold text-gray-300 hover:text-white transition-colors"
                  >
                    <span>{grouping}</span>
                    <svg className="w-3 h-3 text-gray-500 mt-[1px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {groupingOpen && (
                    <div className="absolute left-0 top-full mt-1 w-24 rounded-lg border border-shadow-600 bg-shadow-800 shadow-xl z-[300] py-1">
                      {groupingOptions.map((option) => (
                        <button
                          key={option}
                          onClick={() => {
                            setGrouping(option);
                            setGroupingOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1 text-[11px] tabular-nums transition-colors ${
                            grouping === option
                              ? "text-accent-purple bg-accent-purple/10"
                              : "text-gray-400 hover:text-gray-200 hover:bg-shadow-700/60"
                          }`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
<div className="grid grid-cols-3 flex-1 text-[8px] uppercase tracking-[0.08em] text-gray-500">
                  <span>Price ({quoteSymbol})</span>
                  <span className="text-right">Size ({baseSymbol})</span>
                  <span className="text-right">Total ({baseSymbol})</span>
                </div>
              </div>

              {fetchError ? (
                <div className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-gray-500">
                  {fetchError}
                </div>
              ) : (
                <>
                  {bookLayout !== "bids" && <BookSide levels={groupedAsks} tone="ask" animate={animate} fullHeight={bookLayout === "asks"} />}
                  {bookLayout === "both" && <SpreadRow snapshot={snapshot} referencePrice={referencePrice} />}
                  {bookLayout !== "asks" && <BookSide levels={groupedBids} tone="bid" animate={animate} fullHeight={bookLayout === "bids"} />}
                </>
              )}
            </>
          ) : (
            <>
              <div className="grid grid-cols-3 px-2 py-[3px] text-[8px] uppercase tracking-[0.08em] text-gray-500 border-b border-shadow-600 shrink-0">
                <span>Price ({quoteSymbol})</span>
                <span className="text-right">Size ({baseSymbol})</span>
                <span className="text-right">Time</span>
              </div>
              {trades.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-[10px] text-gray-600">
                  External trades unavailable
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {trades.map((trade, index) => (
                    <TradeRow key={`${trade.timestamp}-${index}`} trade={trade} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BookSide({
  levels,
  tone,
  animate = true,
  fullHeight = false,
}: {
  levels: GroupedReferenceLevel[];
  tone: "bid" | "ask";
  animate?: boolean;
  fullHeight?: boolean;
}) {
  const maxTotal = levels.length > 0 ? levels[levels.length - 1].total : 0;
  const toneClass = tone === "ask" ? "text-accent-red" : "text-accent-green";
  const barClass = tone === "ask" ? "bg-red-500/10" : "bg-emerald-500/10";
  // In single-side mode, always start from top; in dual mode, asks push to bottom
  const alignmentClass = fullHeight ? "justify-start" : tone === "ask" ? "justify-end" : "justify-start";

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {levels.length === 0 ? (
        <div className="flex h-full items-center justify-center text-[10px] text-gray-600">
          Waiting for depth
        </div>
      ) : (
        <div className={`flex min-h-full flex-col ${alignmentClass}`}>
          {levels.map((level) => {
            const barWidth = maxTotal > 0 ? Math.max(6, (level.total / maxTotal) * 100) : 0;
            return (
              <div key={`${tone}-${level.price}`} className="relative grid grid-cols-3 px-2 py-[3px] text-[11px] tabular-nums">
                <div className={`absolute inset-y-0 right-0 ${barClass}`} style={{ width: `${barWidth}%`, transition: animate ? "width 150ms ease" : "none" }} />
                <span className={`relative z-10 ${toneClass}`}>{formatPrice(level.price)}</span>
                <span className="relative z-10 text-right text-gray-300">{formatSize(level.size)}</span>
                <span className="relative z-10 text-right text-gray-500">{formatSize(level.total)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SpreadRow({
  snapshot,
  referencePrice,
}: {
  snapshot: ReferenceDepthSnapshot | null;
  referencePrice?: number | null;
}) {
  const spreadLabel = snapshot?.spread !== null && snapshot?.spread !== undefined
    ? formatPrice(snapshot.spread)
    : "--";
  const percentLabel = snapshot?.spreadBps !== null && snapshot?.spreadBps !== undefined
    ? `${(snapshot.spreadBps / 100).toFixed(3)}%`
    : "--";
  const mid =
    snapshot?.lastTrade?.price ??
    (snapshot?.bids?.[0]?.price && snapshot?.asks?.[0]?.price
      ? (snapshot.bids[0].price + snapshot.asks[0].price) / 2
      : referencePrice ?? null);

  return (
    <div className="trade-orderbook-spread-row grid grid-cols-3 items-center px-2 py-[5px] border-y border-shadow-600 shrink-0 bg-shadow-800/60">
      <span className="text-center text-[10px] font-medium text-gray-300">Spread</span>
      <span className="text-center text-[11px] font-semibold text-white tabular-nums">
        {spreadLabel}
      </span>
      <span className="text-center text-[10px] text-gray-400 tabular-nums">
        {percentLabel}
      </span>
      {mid && (
        <span className="col-span-3 mt-1 text-center text-[9px] uppercase tracking-[0.08em] text-gray-500">
          Mid {formatPrice(mid)}
        </span>
      )}
    </div>
  );
}

function TradeRow({ trade }: { trade: ReferenceTrade }) {
  const toneClass = trade.side === "sell" ? "text-accent-red" : "text-accent-green";

  return (
    <div className="grid grid-cols-3 px-2 py-[3px] text-[11px] tabular-nums">
      <span className={toneClass}>{formatPrice(trade.price)}</span>
      <span className="text-right text-gray-300">{formatSize(trade.size)}</span>
      <span className="text-right text-gray-500">{formatTime(trade.timestamp)}</span>
    </div>
  );
}

function BuySellBar({
  leftPct,
  leftLabel,
  rightLabel,
  leftColor,
  rightColor,
}: {
  leftPct: number;
  leftLabel: string;
  rightLabel: string;
  leftColor: "green" | "red";
  rightColor: "green" | "red";
}) {
  const left = Math.min(100, Math.max(0, leftPct));
  const right = 100 - left;
  const leftBg = leftColor === "green" ? "rgba(20,241,149,0.18)" : "rgba(255,80,80,0.18)";
  const rightBg = rightColor === "red" ? "rgba(255,80,80,0.18)" : "rgba(20,241,149,0.18)";
  const leftText = leftColor === "green" ? "text-accent-green" : "text-accent-red";
  const rightText = rightColor === "red" ? "text-accent-red" : "text-accent-green";

  return (
    <div className="flex h-[22px] w-full shrink-0 overflow-hidden border-t border-shadow-700/60 text-[10px] font-semibold tabular-nums">
      <div
        className={`flex items-center pl-2 ${leftText} transition-all duration-500`}
        style={{ width: `${left}%`, background: leftBg }}
      >
        {left.toFixed(1)}% {leftLabel}
      </div>
      <div
        className={`flex flex-1 items-center justify-end pr-2 ${rightText} transition-all duration-500`}
        style={{ background: rightBg }}
      >
        {rightLabel} {right.toFixed(1)}%
      </div>
    </div>
  );
}
