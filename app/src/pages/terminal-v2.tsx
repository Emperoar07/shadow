import { useMemo, useState } from "react";
import Head from "next/head";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  EyeOff,
  Lock,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

type Market = {
  symbol: string;
  price: number;
  change24h: number;
};

const MARKETS: Market[] = [
  { symbol: "SOL-PERP", price: 142.85, change24h: 5.23 },
  { symbol: "BTC-PERP", price: 67150, change24h: -1.45 },
  { symbol: "ETH-PERP", price: 3524.67, change24h: 2.18 },
  { symbol: "BONK-PERP", price: 0.000028, change24h: -8.32 },
  { symbol: "RAY-PERP", price: 3.41, change24h: 1.12 },
];

export default function TerminalV2Page() {
  const [market, setMarket] = useState<Market>(MARKETS[0]);
  const [isLong, setIsLong] = useState(true);
  const [size, setSize] = useState("0.1");
  const [leverage, setLeverage] = useState(10);

  const notional = useMemo(() => Number(size || 0) * market.price, [size, market.price]);
  const margin = useMemo(
    () => (leverage > 0 ? notional / leverage : 0),
    [leverage, notional]
  );

  return (
    <>
      <Head>
        <title>Shadow Terminal V2</title>
      </Head>
      <div className="min-h-screen bg-[#0b0b13] text-white">
        <header className="border-b border-white/10 bg-[#0b0b13]/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-violet-500/40 bg-violet-500/10 p-2">
                <Sparkles className="h-5 w-5 text-violet-400" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">Shadow</h1>
                <p className="text-xs text-slate-400">PRIVATE PERPS ON SOLANA</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs text-cyan-300">
              <Activity className="h-3.5 w-3.5" />
              Arcium MPC Active
            </div>
          </div>
        </header>

        <main className="mx-auto grid max-w-7xl gap-4 px-4 py-6 lg:grid-cols-[1fr,360px]">
          <section className="rounded-xl border border-white/10 bg-[#121222] p-4">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {MARKETS.map((m) => (
                <button
                  key={m.symbol}
                  onClick={() => setMarket(m)}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                    market.symbol === m.symbol
                      ? "border-violet-400/60 bg-violet-500/20 text-white"
                      : "border-white/10 text-slate-300 hover:border-white/20"
                  }`}
                >
                  {m.symbol}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={market.symbol}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="rounded-xl border border-white/10 bg-[#0f0f1b] p-5"
              >
                <div className="mb-1 text-2xl font-semibold">${market.price.toLocaleString()}</div>
                <div
                  className={`text-sm ${
                    market.change24h >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {market.change24h >= 0 ? "+" : ""}
                  {market.change24h}% (24h)
                </div>
                <div className="mt-8 flex h-56 items-center justify-center rounded-lg border border-dashed border-white/10 text-sm text-slate-400">
                  TradingView chart slot (safe preview route)
                </div>
              </motion.div>
            </AnimatePresence>
          </section>

          <section className="rounded-xl border border-white/10 bg-[#121222] p-4">
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setIsLong(true)}
                className={`rounded-lg py-2 text-sm font-semibold ${
                  isLong ? "bg-emerald-500 text-white" : "bg-white/5 text-slate-300"
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  <TrendingUp className="h-4 w-4" /> Long
                </span>
              </button>
              <button
                onClick={() => setIsLong(false)}
                className={`rounded-lg py-2 text-sm font-semibold ${
                  !isLong ? "bg-rose-500 text-white" : "bg-white/5 text-slate-300"
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  <TrendingDown className="h-4 w-4" /> Short
                </span>
              </button>
            </div>

            <label className="mb-1 block text-xs text-slate-400">Position Size</label>
            <input
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="mb-3 w-full rounded-lg border border-white/10 bg-[#0b0b13] px-3 py-2 outline-none focus:border-violet-400/50"
            />

            <label className="mb-1 block text-xs text-slate-400">Leverage: {leverage}x</label>
            <input
              type="range"
              min={1}
              max={20}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="mb-4 w-full"
            />

            <div className="mb-4 rounded-lg border border-white/10 bg-[#0b0b13] p-3 text-sm">
              <div className="mb-1 flex justify-between">
                <span className="text-slate-400">Notional</span>
                <span>${notional.toFixed(2)}</span>
              </div>
              <div className="mb-1 flex justify-between">
                <span className="text-slate-400">Required Margin</span>
                <span>${margin.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Privacy</span>
                <span className="inline-flex items-center gap-1 text-violet-300">
                  <EyeOff className="h-3.5 w-3.5" /> Encrypted
                </span>
              </div>
            </div>

            <button
              className={`w-full rounded-lg py-3 font-semibold ${
                isLong ? "bg-emerald-500 hover:bg-emerald-600" : "bg-rose-500 hover:bg-rose-600"
              }`}
            >
              Open {isLong ? "Long" : "Short"}
            </button>

            <div className="mt-4 rounded-lg border border-violet-400/25 bg-violet-500/10 p-3 text-xs text-slate-300">
              <div className="mb-1 inline-flex items-center gap-2 text-violet-300">
                <ShieldCheck className="h-4 w-4" />
                Arcium MPC Privacy
              </div>
              <p>Order fields are encrypted client-side and only processed in confidential compute.</p>
            </div>
          </section>
        </main>

        <footer className="px-4 pb-8 text-center text-sm text-slate-400">
          <p className="inline-flex items-center gap-2">
            <Lock className="h-4 w-4 text-violet-300" />
            Powered by Arcium - Built on Solana
          </p>
        </footer>
      </div>
    </>
  );
}
