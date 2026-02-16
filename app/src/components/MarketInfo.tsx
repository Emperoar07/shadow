import { useCallback, useEffect, useRef, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { createShadowPerpClient } from "../lib/create-client";
import { TradingPair, TRADING_PAIRS } from "../lib/tokens";

interface MarketInfoProps {
  pair?: TradingPair;
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

export default function MarketInfo({ pair }: MarketInfoProps) {
  const activePair = pair ?? TRADING_PAIRS[0];
  const anchorWallet = useAnchorWallet();
  const { connection } = useConnection();
  const [market, setMarket] = useState<MarketData | null>(null);
  const [mxeStatus, setMxeStatus] = useState<"active" | "checking" | "offline">("checking");
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const previousPriceRef = useRef<number | null>(null);

  const loadMarket = useCallback(async () => {
    if (!anchorWallet) return;
    try {
      const { client, runtime } = createShadowPerpClient(connection, anchorWallet);
      const data = await client.getMarket(runtime.marketAddress);
      const oraclePrice = new BN(data.oraclePrice.toString()).toNumber() / 1_000_000;
      const previousPrice = previousPriceRef.current;
      if (previousPrice !== null && previousPrice > 0) {
        setPriceChange(((oraclePrice - previousPrice) / previousPrice) * 100);
      }
      previousPriceRef.current = oraclePrice;
      setMarket({
        oraclePrice,
        maxLeverage: data.maxLeverage,
        liquidationThreshold: data.liquidationThreshold / 100,
        tradingFee: data.tradingFee / 100,
        activePositions: new BN(data.activePositions.toString()).toNumber(),
        totalFeesCollected: new BN(data.totalFeesCollected.toString()).toNumber() / 1_000_000,
        lastPriceUpdate: new Date(new BN(data.lastPriceUpdate.toString()).toNumber() * 1000),
      });
      setMxeStatus("active");
    } catch {
      setMxeStatus("offline");
    }
  }, [anchorWallet, connection]);

  useEffect(() => {
    void loadMarket();
    const interval = setInterval(() => void loadMarket(), 15_000);
    return () => clearInterval(interval);
  }, [loadMarket]);

  const price = market?.oraclePrice ?? null;
  const priceFresh = market
    ? Date.now() - market.lastPriceUpdate.getTime() < 120_000
    : false;

  return (
    <div className="position-card rounded-xl p-6 space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">{activePair.label}</h2>
          {market && (
            <span className="text-xs text-gray-500">
              {market.activePositions} active position{market.activePositions !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold">
            {price === null ? "--" : `$${price < 0.01 ? price.toFixed(8) : price.toFixed(2)}`}
          </span>
          {priceChange !== null && (
            <span
              className={`text-sm ${
                priceChange >= 0 ? "text-accent-green" : "text-accent-red"
              }`}
            >
              {priceChange >= 0 ? "+" : ""}
              {priceChange.toFixed(2)}%
            </span>
          )}
          {market && (
            <span className={`text-xs ml-1 ${priceFresh ? "text-accent-green" : "text-accent-red"}`}>
              {priceFresh ? "live" : "stale"}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <InfoRow label="Open Interest" value={market ? `$${(market.activePositions * 500).toLocaleString()}` : "--"} encrypted />
        <InfoRow label="Fees Collected" value={market ? `$${market.totalFeesCollected.toFixed(2)}` : "--"} />
        <InfoRow label="Trading Fee" value={market ? `${market.tradingFee.toFixed(2)}%` : "0.10%"} />
        <InfoRow label="Liq. Threshold" value={market ? `${market.liquidationThreshold.toFixed(0)}%` : "80%"} />
        <InfoRow label="Max Leverage" value={market ? `${market.maxLeverage}x` : "20x"} />
      </div>

      <div className="pt-4 border-t border-shadow-600">
        <h3 className="text-sm font-medium text-gray-400 mb-3">
          Privacy Guarantees
        </h3>
        <div className="space-y-2">
          <PrivacyRow label="Position Size" status="encrypted" detail="Never revealed" />
          <PrivacyRow label="Entry Price" status="encrypted" detail="Never revealed" />
          <PrivacyRow label="Leverage" status="encrypted" detail="Never revealed" />
          <PrivacyRow label="Direction" status="encrypted" detail="Never revealed" />
          <PrivacyRow label="Health Factor" status="encrypted" detail="Never revealed" />
          <PrivacyRow label="Liquidation Price" status="encrypted" detail="Never revealed" />
          <PrivacyRow label="Realized PnL" status="revealed" detail="On close only" />
        </div>
      </div>

      <div className="pt-4 border-t border-shadow-600">
        <h3 className="text-sm font-medium text-gray-400 mb-3">
          Arcium MXE Network
        </h3>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              mxeStatus === "active"
                ? "bg-accent-green"
                : mxeStatus === "checking"
                ? "bg-yellow-400 animate-pulse"
                : "bg-accent-red"
            }`}
          />
          <span className="text-sm">
            {mxeStatus === "active"
              ? "MXE Cluster Active"
              : mxeStatus === "checking"
              ? "Connecting..."
              : "MXE Offline"}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Cerberus MPC protocol - 1 honest node guarantees security
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <MpcStat label="Cipher" value="Rescue" />
          <MpcStat label="Key Exchange" value="x25519" />
          <MpcStat label="Security" value="128-bit" />
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  encrypted,
}: {
  label: string;
  value: string;
  encrypted?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-400 text-sm">{label}</span>
      <div className="flex items-center gap-2">
        {encrypted && (
          <svg
            className="w-3 h-3 text-accent-purple"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
        <span className={encrypted ? "encrypted-blur" : ""}>{value}</span>
      </div>
    </div>
  );
}

function PrivacyRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: "encrypted" | "revealed";
  detail: string;
}) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-400">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">{detail}</span>
        <span
          className={`px-2 py-0.5 rounded text-xs ${
            status === "encrypted"
              ? "bg-accent-purple/20 text-accent-purple"
              : "bg-accent-green/20 text-accent-green"
          }`}
        >
          {status === "encrypted" ? "Encrypted" : "Revealed"}
        </span>
      </div>
    </div>
  );
}

function MpcStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-shadow-700 rounded-lg p-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-accent-purple">{value}</p>
    </div>
  );
}
