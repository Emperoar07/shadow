import { useEffect, useRef, useState } from "react";
import { TradingPair, TRADING_PAIRS } from "../lib/tokens";

const GROUPINGS = [0.01, 0.1, 1, 10, 50, 100];

interface PrivateOrderbookProps {
  pair?: TradingPair;
  referencePrice?: number | null;
  className?: string;
}

export default function PrivateOrderbook({
  pair,
  referencePrice,
  className = "",
}: PrivateOrderbookProps) {
  const [tab, setTab] = useState<"book" | "trades">("book");
  const [grouping, setGrouping] = useState(1);
  const [groupingOpen, setGroupingOpen] = useState(false);
  const groupingRef = useRef<HTMLDivElement>(null);

  const activePair = pair ?? TRADING_PAIRS[0];
  const baseSymbol = activePair.base.symbol;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (groupingRef.current && !groupingRef.current.contains(e.target as Node)) {
        setGroupingOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className={`trade-orderbook flex flex-col bg-shadow-900 h-full ${className}`}>

      {/* ── Header tabs ── */}
      <div className="flex items-center border-b border-shadow-600 px-2 shrink-0">
        {(["book", "trades"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative mr-3 py-1 text-[11px] font-semibold transition-colors ${
              tab === t ? "text-white" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {t === "book" ? "Order Book" : "Trades"}
            {tab === t && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-cyan-400" />
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex flex-col min-h-0 w-full">

          {tab === "book" ? (
            <>
              {/* Grouping + column headers */}
              <div className="flex items-center px-2 py-[3px] border-b border-shadow-600 shrink-0 gap-2">
                <div className="relative shrink-0" ref={groupingRef}>
                  <button
                    onClick={() => setGroupingOpen((o) => !o)}
                    className="flex items-center gap-0.5 text-[11px] font-semibold text-gray-300 hover:text-white transition-colors"
                  >
                    <span>{grouping}</span>
                    <svg className="w-3 h-3 text-gray-500 mt-[1px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {groupingOpen && (
                    <div className="absolute left-0 top-full mt-1 w-20 rounded-lg border border-shadow-600 bg-shadow-800 shadow-xl z-[300] py-1">
                      {GROUPINGS.map((g) => (
                        <button
                          key={g}
                          onClick={() => { setGrouping(g); setGroupingOpen(false); }}
                          className={`w-full text-left px-3 py-1 text-[11px] tabular-nums transition-colors ${
                            grouping === g
                              ? "text-accent-purple bg-accent-purple/10"
                              : "text-gray-400 hover:text-gray-200 hover:bg-shadow-700/60"
                          }`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-3 flex-1 text-[8px] uppercase tracking-[0.08em] text-gray-500">
                  <span>Price ({activePair.quote.symbol})</span>
                  <span className="text-right">Size ({baseSymbol})</span>
                  <span className="text-right">Total ({activePair.quote.symbol})</span>
                </div>
              </div>

              {/* Asks */}
              <div className="flex-1 min-h-0" />
              <SpreadRow referencePrice={referencePrice} />
              {/* Bids */}
              <div className="flex-1 min-h-0" />
            </>
          ) : (
            <>
              <div className="grid grid-cols-3 px-2 py-[3px] text-[8px] uppercase tracking-[0.08em] text-gray-500 border-b border-shadow-600 shrink-0">
                <span>Price ({activePair.quote.symbol})</span>
                <span className="text-right">Size ({baseSymbol})</span>
                <span className="text-right">Time</span>
              </div>
              <div className="flex-1 flex items-center justify-center text-[10px] text-gray-600">
                No trades
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

function SpreadRow({ referencePrice }: { referencePrice?: number | null }) {
  void referencePrice;
  return (
    <div className="flex items-center gap-2 px-2 py-[5px] border-y border-shadow-600 shrink-0">
      <span className="text-[9px] uppercase tracking-[0.08em] text-gray-500 shrink-0">Spread</span>
      <span className="text-[11px] font-semibold text-gray-600 tabular-nums">--</span>
      <span className="text-[10px] text-gray-500 tabular-nums ml-auto">--</span>
    </div>
  );
}
