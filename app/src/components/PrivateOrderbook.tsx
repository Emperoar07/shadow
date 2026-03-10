import { useEffect, useRef, useState } from "react";
import { TradingPair, TRADING_PAIRS } from "../lib/tokens";
import {
  getDefaultGrouping,
  formatPrice,
  formatSize,
  formatTime,
  getGroupingOptions,
  groupLevels,
  type ReferenceDepthSnapshot,
  type GroupedReferenceLevel,
  type ReferenceTrade,
} from "../lib/reference-depth";

interface PrivateOrderbookProps {
  pair?: TradingPair;
  referencePrice?: number | null;
  className?: string;
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
  referencePrice,
  className = "",
}: PrivateOrderbookProps) {
  const [tab, setTab] = useState<"book" | "trades">("book");
  const [snapshot, setSnapshot] = useState<ReferenceDepthSnapshot | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [groupingOpen, setGroupingOpen] = useState(false);
  const groupingRef = useRef<HTMLDivElement>(null);

  const activePair = pair ?? TRADING_PAIRS[0];
  const currentReferencePrice = priceForGrouping(snapshot, referencePrice);
  const groupingOptions = getGroupingOptions(currentReferencePrice);
  const [grouping, setGrouping] = useState(getDefaultGrouping(currentReferencePrice));

  useEffect(() => {
    setGrouping(getDefaultGrouping(priceForGrouping(snapshot, referencePrice)));
  }, [activePair.label]);

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
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/reference-depth?pair=${encodeURIComponent(activePair.label)}`, {
          signal: AbortSignal.timeout(6_000),
        });
        if (!response.ok) {
          throw new Error("Reference depth unavailable");
        }

        const payload = (await response.json()) as ReferenceDepthSnapshot;
        if (cancelled) return;
        setSnapshot(payload);
        setFetchError(null);
      } catch (error: any) {
        if (cancelled) return;
        setFetchError(typeof error?.message === "string" ? error.message : "Reference depth unavailable");
      }
    };

    load();
    const id = window.setInterval(load, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [activePair.label]);

  const quoteSymbol = snapshot?.quoteSymbol ?? activePair.quote.symbol;
  const baseSymbol = activePair.base.symbol;
  const groupedAsks = groupLevels(snapshot?.asks ?? [], grouping, "asks");
  const groupedBids = groupLevels(snapshot?.bids ?? [], grouping, "bids");
  const trades = snapshot?.trades ?? [];

  return (
    <div className={`trade-orderbook flex flex-col bg-shadow-900 h-full ${className}`}>
      <div className="flex items-center justify-between border-b border-shadow-600 px-2 shrink-0">
        <div className="flex items-center">
          {(["book", "trades"] as const).map((nextTab) => (
            <button
              key={nextTab}
              onClick={() => setTab(nextTab)}
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
        <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.08em] text-gray-500">
          {snapshot ? <span className="text-gray-500">Live</span> : <span>Loading</span>}
        </div>
      </div>

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
                  <BookSide levels={groupedAsks} tone="ask" />
                  <SpreadRow snapshot={snapshot} referencePrice={referencePrice} />
                  <BookSide levels={groupedBids} tone="bid" />
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
}: {
  levels: GroupedReferenceLevel[];
  tone: "bid" | "ask";
}) {
  const maxTotal = levels.length > 0 ? levels[levels.length - 1].total : 0;
  const toneClass = tone === "ask" ? "text-accent-red" : "text-accent-green";
  const barClass = tone === "ask" ? "bg-red-500/10" : "bg-emerald-500/10";

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {levels.length === 0 ? (
        <div className="flex h-full items-center justify-center text-[10px] text-gray-600">
          Waiting for depth
        </div>
      ) : (
        levels.map((level) => {
          const barWidth = maxTotal > 0 ? Math.max(6, (level.total / maxTotal) * 100) : 0;
          return (
            <div key={`${tone}-${level.price}`} className="relative grid grid-cols-3 px-2 py-[3px] text-[11px] tabular-nums">
              <div className={`absolute inset-y-0 right-0 ${barClass}`} style={{ width: `${barWidth}%` }} />
              <span className={`relative z-10 ${toneClass}`}>{formatPrice(level.price)}</span>
              <span className="relative z-10 text-right text-gray-300">{formatSize(level.size)}</span>
              <span className="relative z-10 text-right text-gray-500">{formatSize(level.total)}</span>
            </div>
          );
        })
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
