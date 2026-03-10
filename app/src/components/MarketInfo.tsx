import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
import BN from "bn.js";
import { createShadowPerpClient } from "../lib/create-client";
import { TradingPair, TRADING_PAIRS } from "../lib/tokens";
import { fetchPrices, PriceData } from "../lib/prices";
import { useAnchorWalletCompat } from "../lib/use-anchor-wallet";
import PairSelector from "./PairSelector";

const PortfolioSummary = dynamic(() => import("./PortfolioSummary"), { ssr: false });

interface MarketInfoProps {
  pair?: TradingPair;
  onPairChange?: (pair: TradingPair) => void;
  displayPrice?: number | null;
  displayChange24h?: number | null;
  onPriceUpdate?: (update: {
    pairLabel: string;
    price: number;
    change24h: number | null;
  }) => void;
  onMarginReady?: (balance: number | null, openModal: () => void) => void;
  className?: string;
}

interface ReferenceDepthPayload {
  lastTrade?: { price?: number | null } | null;
  bids?: Array<{ price?: number | null }> | null;
  asks?: Array<{ price?: number | null }> | null;
}

export default function MarketInfo({
  pair,
  onPairChange,
  onPriceUpdate,
  onMarginReady,
  className = "",
}: MarketInfoProps) {
  const activePair = pair ?? TRADING_PAIRS[0];
  const anchorWallet = useAnchorWalletCompat();
  const { connection } = useConnection();
  const [market, setMarket] = useState<{
    oraclePrice: number;
    volume24h: number | null;
    high24h: number | null;
    low24h: number | null;
  } | null>(null);
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const previousPriceRef = useRef<number | null>(null);
  const clientRef = useRef<ReturnType<typeof createShadowPerpClient> | null>(null);

  useEffect(() => {
    clientRef.current = null;
  }, [anchorWallet]);

  const setFallbackData = useCallback(
    (livePrice?: PriceData, referencePrice?: number | null) => {
      const price = referencePrice ?? livePrice?.price ?? activePair.mockPrice;
      const change = livePrice?.change24h ?? activePair.mockPriceChange;
      const volume24h =
        typeof livePrice?.volume24h === "number" && Number.isFinite(livePrice.volume24h)
          ? livePrice.volume24h
          : null;
      const high24h =
        typeof livePrice?.high24h === "number" && Number.isFinite(livePrice.high24h) && livePrice.high24h > 0
          ? livePrice.high24h
          : null;
      const low24h =
        typeof livePrice?.low24h === "number" && Number.isFinite(livePrice.low24h) && livePrice.low24h > 0
          ? livePrice.low24h
          : null;
      setMarket({
        oraclePrice: price,
        volume24h,
        high24h,
        low24h,
      });
      setPriceChange(change);
    },
    [activePair]
  );

  const loadMarket = useCallback(async () => {
      const [livePrices, referenceDepth] = await Promise.all([
        fetchPrices().catch(() => null),
        fetch(`/api/reference-depth?pair=${encodeURIComponent(activePair.label)}`, {
          signal: AbortSignal.timeout(6_000),
        })
          .then(async (res) => (res.ok ? ((await res.json()) as ReferenceDepthPayload) : null))
          .catch(() => null),
      ]);
      const livePrice = livePrices?.[activePair.label] ?? undefined;
      const bestBid =
        typeof referenceDepth?.bids?.[0]?.price === "number" &&
        Number.isFinite(referenceDepth.bids[0].price)
          ? referenceDepth.bids[0].price
          : null;
      const bestAsk =
        typeof referenceDepth?.asks?.[0]?.price === "number" &&
        Number.isFinite(referenceDepth.asks[0].price)
          ? referenceDepth.asks[0].price
          : null;
      const referencePriceValue =
        typeof referenceDepth?.lastTrade?.price === "number" &&
        Number.isFinite(referenceDepth.lastTrade.price) &&
        referenceDepth.lastTrade.price > 0
          ? referenceDepth.lastTrade.price
          : bestBid !== null && bestAsk !== null
          ? (bestBid + bestAsk) / 2
          : null;
      const livePriceValue =
        typeof livePrice?.price === "number" && Number.isFinite(livePrice.price) && livePrice.price > 0
          ? livePrice.price
        : null;
    const liveChangeValue =
      typeof livePrice?.change24h === "number" && Number.isFinite(livePrice.change24h)
        ? livePrice.change24h
        : null;
    const liveVolumeValue =
      typeof livePrice?.volume24h === "number" && Number.isFinite(livePrice.volume24h)
        ? livePrice.volume24h
        : null;
    const liveHighValue =
      typeof livePrice?.high24h === "number" && Number.isFinite(livePrice.high24h) && livePrice.high24h > 0
        ? livePrice.high24h
        : null;
    const liveLowValue =
      typeof livePrice?.low24h === "number" && Number.isFinite(livePrice.low24h) && livePrice.low24h > 0
        ? livePrice.low24h
        : null;

      if (!anchorWallet) {
        setFallbackData(livePrice, referencePriceValue);
        return;
      }

    try {
      if (!clientRef.current) {
        clientRef.current = createShadowPerpClient(connection, anchorWallet);
      }
      const { client, runtime } = clientRef.current;
      const data = await client.getMarket(runtime.marketAddress);
      const oraclePriceOnchain = new BN(data.oraclePrice.toString()).toNumber() / 1_000_000;
      const uiDisplayPrice = referencePriceValue ?? livePriceValue ?? oraclePriceOnchain;
      const previousPrice = previousPriceRef.current;
      if (liveChangeValue !== null) {
        setPriceChange(liveChangeValue);
      } else if (previousPrice !== null && previousPrice > 0) {
        setPriceChange(((uiDisplayPrice - previousPrice) / previousPrice) * 100);
      }
      previousPriceRef.current = uiDisplayPrice;
      setMarket((previous) => ({
        oraclePrice: uiDisplayPrice,
        volume24h: liveVolumeValue ?? previous?.volume24h ?? null,
        high24h: liveHighValue ?? previous?.high24h ?? null,
        low24h: liveLowValue ?? previous?.low24h ?? null,
      }));
    } catch {
      setFallbackData(livePrice, referencePriceValue);
    }
  }, [anchorWallet, connection, activePair, setFallbackData]);

  useEffect(() => {
    void loadMarket();
    const interval = setInterval(() => void loadMarket(), 15_000);
    return () => clearInterval(interval);
  }, [loadMarket]);

  const price = market?.oraclePrice ?? activePair.mockPrice;
  const formattedPrice = price < 0.01 ? price.toFixed(8) : price.toFixed(2);
  const formattedVolume24h = formatVolume(market?.volume24h);
  const formattedHigh24h = formatPriceStat(market?.high24h);
  const formattedLow24h = formatPriceStat(market?.low24h);

  useEffect(() => {
    if (!onPriceUpdate) return;
    onPriceUpdate({ pairLabel: activePair.label, price, change24h: priceChange });
  }, [onPriceUpdate, activePair.label, price, priceChange]);

  const changePositive = (priceChange ?? 0) >= 0;
  const priceDelta =
    priceChange != null
      ? (price * Math.abs(priceChange) / 100).toFixed(2)
      : null;
  const changeFormatted =
    priceDelta != null && priceChange != null
      ? `${changePositive ? "+" : "-"}$${priceDelta} / ${changePositive ? "+" : ""}${priceChange.toFixed(1)}%`
      : "--";

  return (
    <div
      className={`trade-market-bar relative z-[120] flex flex-col gap-2 border-b border-shadow-600 bg-shadow-900 px-4 py-2 overflow-visible sm:flex-row sm:items-center sm:gap-3 ${className}`}
    >
      <div className="flex items-center justify-between gap-3 sm:min-w-0">
        <PairSelector
          activePair={activePair}
          displayPrice={price}
          displayChange24h={priceChange}
          onSelect={(p) => onPairChange?.(p)}
        />

        <div className="min-w-0 text-right sm:hidden">
          <p className="text-[10px] uppercase tracking-[0.1em] text-gray-500">Price</p>
          <p className="text-sm font-semibold text-gray-100">${formattedPrice}</p>
          <p className={`text-[11px] font-medium ${changePositive ? "text-accent-green" : "text-accent-red"}`}>
            {changeFormatted}
          </p>
        </div>
      </div>

      <div className="hidden h-6 w-px shrink-0 bg-shadow-600 sm:block" />

      {/* Market stats */}
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

      {/* Portfolio stats — renders only when wallet is connected */}
      <div className="overflow-x-auto pb-1 sm:hidden">
        <div className="flex min-w-max items-center gap-4 pr-4">
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
      </div>

      <div className="hidden h-6 w-px shrink-0 bg-shadow-600 sm:block" />
      <PortfolioSummary onMarginReady={onMarginReady} />
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
    <div className="flex flex-col gap-0.5 shrink-0">
      <span className="text-[10px] uppercase tracking-[0.1em] text-gray-500">{label}</span>
      <span className={`text-xs font-semibold ${valueClass}`}>{value}</span>
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
