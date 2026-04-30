import dynamic from "next/dynamic";
import PairSelector from "./PairSelector";
import type { MarketSnapshot } from "../hooks/useMarketSnapshot";
import type { TradingPair } from "../lib/tokens";

const PortfolioSummary = dynamic(() => import("./PortfolioSummary"), { ssr: false });

interface MarketInfoProps {
  pair?: TradingPair;
  snapshot: MarketSnapshot;
  onPairChange?: (pair: TradingPair) => void;
  onMarginReady?: (balance: number | null, openModal: () => void) => void;
  className?: string;
}

export default function MarketInfo({
  pair,
  snapshot,
  onPairChange,
  onMarginReady,
  className = "",
}: MarketInfoProps) {
  const activePair = pair;
  const price = snapshot.last;
  const formattedPrice = price < 0.01 ? price.toFixed(8) : price.toFixed(2);
  const formattedVolume24h = formatVolume(snapshot.volume24h);
  const formattedHigh24h = formatPriceStat(snapshot.high24h);
  const formattedLow24h = formatPriceStat(snapshot.low24h);
  const priceChange = snapshot.change24h;
  const changePositive = (priceChange ?? 0) >= 0;
  const priceDelta =
    priceChange != null ? (price * Math.abs(priceChange) / 100).toFixed(2) : null;
  const changeFormatted =
    priceDelta != null && priceChange != null
      ? `${changePositive ? "+" : "-"}$${priceDelta} / ${changePositive ? "+" : ""}${priceChange.toFixed(1)}%`
      : "--";

  return (
    <div
      className={`trade-market-bar relative flex flex-col gap-2 bg-shadow-900 px-4 pb-[7px] pt-[6px] overflow-visible sm:flex-row sm:items-center sm:gap-3 ${className}`}
    >
      <div className="flex items-center justify-between gap-3 sm:min-w-0">
        {activePair && (
          <PairSelector
            activePair={activePair}
            displayPrice={price}
            displayChange24h={priceChange}
            onSelect={(nextPair) => onPairChange?.(nextPair)}
          />
        )}

        <div className="min-w-0 text-right sm:hidden">
          <p className="text-[10px] uppercase tracking-[0.1em] text-gray-500">Price</p>
          <p className="text-sm font-semibold text-gray-100">${formattedPrice}</p>
          <p
            className={`text-[11px] font-medium ${changePositive ? "text-accent-green" : "text-accent-red"}`}
          >
            {changeFormatted}
          </p>
        </div>
      </div>

      <div className="hidden h-7 w-px shrink-0 bg-shadow-600 sm:block" />

      <div className="hidden min-w-0 flex-1 items-center gap-4 sm:flex">
        <MarketStat label="Price" value={`$${formattedPrice}`} />
        <div className="w-px h-5 bg-shadow-600 shrink-0" />
        <MarketStat
          label="24H Change"
          value={changeFormatted}
          valueClass={changePositive ? "text-accent-green" : "text-accent-red"}
        />
        <div className="w-px h-5 bg-shadow-600 shrink-0" />
        <MarketStat label="24H Volume" value={formattedVolume24h} />
        <div className="w-px h-5 bg-shadow-600 shrink-0" />
        <MarketStat label="24H High" value={formattedHigh24h} />
        <div className="w-px h-5 bg-shadow-600 shrink-0" />
        <MarketStat label="24H Low" value={formattedLow24h} />
      </div>

      <div className="overflow-x-auto pb-1 sm:hidden">
        <div className="flex min-w-max items-center gap-4 pr-4">
          <MarketStat label="24H High" value={formattedHigh24h} />
          <div className="w-px h-5 bg-shadow-600 shrink-0" />
          <MarketStat label="24H Low" value={formattedLow24h} />
        </div>
      </div>

      <PortfolioSummary pair={activePair} onMarginReady={onMarginReady} />
    </div>
  );
}

function MarketStat({
  label,
  value,
  valueClass = "text-gray-200",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex min-w-[96px] flex-col gap-1 rounded-lg border border-shadow-700/80 bg-shadow-800/65 px-3 py-[7px] shrink-0">
      <span className="text-[10px] uppercase tracking-[0.12em] text-gray-400">{label}</span>
      <span className={`text-[13px] font-semibold leading-none ${valueClass}`}>{value}</span>
    </div>
  );
}

function formatPriceStat(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "--";
  }
  if (value < 0.01) {
    return `$${value.toFixed(8)}`;
  }
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatVolume(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "--";
  }
  if (value < 1_000) {
    return `$${value.toFixed(2)}`;
  }
  return `$${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value)}`;
}
