import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { createShadowPerpClient } from "../lib/create-client";
import { TradingPair, TRADING_PAIRS } from "../lib/tokens";
import { fetchPrices, PriceData } from "../lib/prices";
import { useAnchorWalletCompat } from "../lib/use-anchor-wallet";

interface MarketInfoProps {
  pair?: TradingPair;
  className?: string;
  onPriceUpdate?: (update: {
    pairLabel: string;
    price: number;
    change24h: number | null;
  }) => void;
}

interface MarketData {
  oraclePrice: number;
  maxLeverage: number;
  liquidationThreshold: number;
  tradingFee: number;
  activePositions: number;
  totalFeesCollected: number;
  lastPriceUpdate: Date;
}

export default function MarketInfo({ pair, className = "", onPriceUpdate }: MarketInfoProps) {
  const activePair = pair ?? TRADING_PAIRS[0];
  const anchorWallet = useAnchorWalletCompat();
  const { connection } = useConnection();
  const [market, setMarket] = useState<MarketData | null>(null);
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const [priceFlash, setPriceFlash] = useState<"up" | "down" | null>(null);
  const previousPriceRef = useRef<number | null>(null);
  const clientRef = useRef<ReturnType<typeof createShadowPerpClient> | null>(null);

  useEffect(() => {
    clientRef.current = null;
  }, [anchorWallet]);

  const setFallbackData = useCallback(
    (livePrice?: PriceData) => {
      const price = livePrice?.price ?? activePair.mockPrice;
      const change = livePrice?.change24h ?? activePair.mockPriceChange;
      setMarket({
        oraclePrice: price,
        maxLeverage: 50,
        liquidationThreshold: 5,
        tradingFee: 0.1,
        activePositions: 0,
        totalFeesCollected: 0,
        lastPriceUpdate: new Date(),
      });
      setPriceChange(change);
    },
    [activePair]
  );

  const loadMarket = useCallback(async () => {
    const livePrices = await fetchPrices().catch(() => null);
    const livePrice = livePrices?.[activePair.label] ?? undefined;
    const livePriceValue =
      typeof livePrice?.price === "number" && Number.isFinite(livePrice.price) && livePrice.price > 0
        ? livePrice.price
        : null;
    const liveChangeValue =
      typeof livePrice?.change24h === "number" && Number.isFinite(livePrice.change24h)
        ? livePrice.change24h
        : null;

    if (!anchorWallet) {
      setFallbackData(livePrice);
      return;
    }

    try {
      if (!clientRef.current) {
        clientRef.current = createShadowPerpClient(connection, anchorWallet);
      }
      const { client, runtime } = clientRef.current;
      const data = await client.getMarket(runtime.marketAddress);
      const oraclePriceOnchain = new BN(data.oraclePrice.toString()).toNumber() / 1_000_000;
      const uiDisplayPrice = livePriceValue ?? oraclePriceOnchain;
      const previousPrice = previousPriceRef.current;
      if (liveChangeValue !== null) {
        setPriceChange(liveChangeValue);
      } else if (previousPrice !== null && previousPrice > 0) {
        setPriceChange(((uiDisplayPrice - previousPrice) / previousPrice) * 100);
      }
      previousPriceRef.current = uiDisplayPrice;
      setMarket({
        oraclePrice: uiDisplayPrice,
        maxLeverage: data.maxLeverage,
        liquidationThreshold: data.liquidationThreshold / 100,
        tradingFee: data.tradingFee / 100,
        activePositions: new BN(data.activePositions.toString()).toNumber(),
        totalFeesCollected: new BN(data.totalFeesCollected.toString()).toNumber() / 1_000_000,
        lastPriceUpdate: new Date(new BN(data.lastPriceUpdate.toString()).toNumber() * 1000),
      });
    } catch {
      setFallbackData(livePrice);
    }
  }, [anchorWallet, connection, activePair, setFallbackData]);

  useEffect(() => {
    void loadMarket();
    const interval = setInterval(() => void loadMarket(), 15_000);
    return () => clearInterval(interval);
  }, [loadMarket]);

  const price = market?.oraclePrice ?? activePair.mockPrice;
  const openInterest = market ? market.activePositions * price : 0;
  const notionalTraded =
    market && market.tradingFee > 0
      ? market.totalFeesCollected / (market.tradingFee / 100)
      : 0;
  const formattedPrice = price < 0.01 ? price.toFixed(8) : price.toFixed(2);

  useEffect(() => {
    if (!onPriceUpdate) return;
    onPriceUpdate({
      pairLabel: activePair.label,
      price,
      change24h: priceChange,
    });
  }, [onPriceUpdate, activePair.label, price, priceChange]);

  useEffect(() => {
    const prev = previousPriceRef.current;
    if (prev === null || prev === price) return;
    const dir = price > prev ? "up" : "down";
    setPriceFlash(dir);
    const t = setTimeout(() => setPriceFlash(null), 600);
    return () => clearTimeout(t);
  }, [price]);

  return (
    <div
      className={`position-card flex h-full min-h-0 flex-col rounded-xl border border-accent-purple/20 bg-[#0a0f1f]/85 p-4 ${className}`}
    >
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">
            {activePair.label} - Oracle
          </p>
          <div className="mt-1.5 flex items-end gap-2.5">
            <span
              className={`text-4xl font-semibold leading-none transition-colors duration-300 ${
                priceFlash === "up"
                  ? "text-accent-green"
                  : priceFlash === "down"
                  ? "text-accent-red"
                  : "text-white"
              }`}
            >
              ${formattedPrice}
            </span>
            {priceChange !== null && (
              <span
                className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                  priceChange >= 0
                    ? "bg-accent-green/20 text-accent-green"
                    : "bg-accent-red/20 text-accent-red"
                }`}
              >
                {priceChange >= 0 ? "+" : ""}
                {priceChange.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
        {market && (
          <span className="pt-0.5 text-[11px] text-gray-500">
            {market.activePositions} active position{market.activePositions !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="grid flex-1 grid-cols-2 gap-2">
        <InfoTile label="Open Interest" value={formatCompactUsd(openInterest)} />
        <InfoTile label="Notional Traded" value={formatCompactUsd(notionalTraded)} />
        <InfoTile label="Trading Fee" value={market ? `${market.tradingFee.toFixed(2)}%` : "0.10%"} />
        <InfoTile label="Max Leverage" value={market ? `${market.maxLeverage}x` : "50x"} />
        <InfoTile
          label="Liq. Threshold"
          value={market ? `${market.liquidationThreshold.toFixed(0)}%` : "5%"}
        />
        <InfoTile
          label="Fees Collected"
          value={market ? formatCompactUsd(market.totalFeesCollected) : "--"}
        />
      </div>
    </div>
  );
}

function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "--";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  if (value > 0 && value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(2)}`;
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-shadow-500 bg-shadow-700/65 p-2.5">
      <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-gray-500">{label}</p>
      <p className="text-xl font-semibold leading-tight text-white">{value}</p>
    </div>
  );
}
