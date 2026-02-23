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
      <div className="flex h-full items-center justify-center">
        <span
          className={`text-5xl font-semibold leading-none transition-colors duration-300 ${
            priceFlash === "up"
              ? "text-accent-green"
              : priceFlash === "down"
              ? "text-accent-red"
              : "text-white"
          }`}
        >
          ${formattedPrice}
        </span>
      </div>
    </div>
  );
}
