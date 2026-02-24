import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { createShadowPerpClient } from "../lib/create-client";
import { TradingPair, TRADING_PAIRS } from "../lib/tokens";
import { fetchPrices, PriceData } from "../lib/prices";
import { useAnchorWalletCompat } from "../lib/use-anchor-wallet";
import PairSelector from "./PairSelector";
import {
  RELAY_SESSION_RENEW_BEFORE_SECONDS,
  useArciumPrivacy,
} from "../hooks/useArcium";

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
  className?: string;
}

export default function MarketInfo({
  pair,
  onPairChange,
  onPriceUpdate,
  className = "",
}: MarketInfoProps) {
  const activePair = pair ?? TRADING_PAIRS[0];
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWalletCompat();
  const { connection } = useConnection();
  const { relaySession, relayAvailable } = useArciumPrivacy();
  const [market, setMarket] = useState<{ oraclePrice: number } | null>(null);
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));
  const previousPriceRef = useRef<number | null>(null);
  const clientRef = useRef<ReturnType<typeof createShadowPerpClient> | null>(null);

  useEffect(() => {
    clientRef.current = null;
  }, [anchorWallet]);

  useEffect(() => {
    const interval = setInterval(() => setNowTs(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(interval);
  }, []);

  const setFallbackData = useCallback(
    (livePrice?: PriceData) => {
      const price = livePrice?.price ?? activePair.mockPrice;
      const change = livePrice?.change24h ?? activePair.mockPriceChange;
      setMarket({ oraclePrice: price });
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
      setMarket({ oraclePrice: uiDisplayPrice });
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
    onPriceUpdate({ pairLabel: activePair.label, price, change24h: priceChange });
  }, [onPriceUpdate, activePair.label, price, priceChange]);

  const isRelaySessionActive =
    !!relaySession &&
    !!publicKey &&
    relaySession.owner === publicKey.toBase58() &&
    relaySession.expiresAt - nowTs > RELAY_SESSION_RENEW_BEFORE_SECONDS &&
    relaySession.usedActions < relaySession.maxActions;
  const relayMinutesLeft = isRelaySessionActive
    ? Math.max(0, Math.floor((relaySession.expiresAt - nowTs) / 60))
    : 0;

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
      className={`trade-market-bar flex items-center gap-3 px-4 py-2 border-b border-shadow-600 bg-shadow-900 overflow-x-auto ${className}`}
    >
      {/* Pair selector */}
      <PairSelector
        activePair={activePair}
        displayPrice={price}
        displayChange24h={priceChange}
        onSelect={(p) => onPairChange?.(p)}
      />

      <div className="w-px h-6 bg-shadow-600 shrink-0" />

      {/* Market stats */}
      <div className="flex items-center gap-4 flex-1">
        <MarketStat label="Oracle Price" value={`$${formattedPrice}`} />
        <div className="w-px h-5 bg-shadow-600 shrink-0" />
        <MarketStat
          label="24H Change"
          value={changeFormatted}
          valueClass={changePositive ? "text-accent-green" : "text-accent-red"}
        />
        <div className="w-px h-5 bg-shadow-600 shrink-0" />
        <MarketStat label="24H Volume" value="--" />
        <div className="w-px h-5 bg-shadow-600 shrink-0" />
        <MarketStat label="24H High" value="--" />
        <div className="w-px h-5 bg-shadow-600 shrink-0" />
        <MarketStat label="24H Low" value="--" />
      </div>

      {/* Right badges */}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-accent-purple/15 border border-accent-purple/30">
          <svg className="w-3 h-3 text-accent-purple" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-xs text-accent-purple">Positions Encrypted</span>
        </div>

        {publicKey && (
          <div
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs ${
              isRelaySessionActive
                ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-300"
                : relayAvailable
                ? "border-cyan-400/35 bg-cyan-500/10 text-cyan-200"
                : "border-yellow-500/35 bg-yellow-500/10 text-yellow-300"
            }`}
          >
            <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
              <circle
                cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                strokeDasharray="37.7" strokeDashoffset="37.7" transform="rotate(-90 8 8)"
              >
                <animate attributeName="stroke-dashoffset" from="37.7" to="0" dur="3s" repeatCount="indefinite" />
              </circle>
            </svg>
            {isRelaySessionActive ? (
              <span>Session · {relayMinutesLeft}m left</span>
            ) : relayAvailable ? (
              <span>Session required</span>
            ) : (
              <span>Relay unavailable</span>
            )}
          </div>
        )}
      </div>
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
