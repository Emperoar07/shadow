import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BN from "bn.js";
import { useConnection } from "@solana/wallet-adapter-react";
import toast from "react-hot-toast";
import { createShadowPerpClient } from "../lib/create-client";
import { useAnchorWalletCompat } from "../lib/use-anchor-wallet";
import { getExplorerTxUrl } from "../lib/explorer";
import { classifyArciumError } from "../lib/arcium-errors";
import { relayUrl } from "../lib/feature-flags";
import type {
  EnsureRelaySessionOptions,
  SessionRelayInfo,
} from "../hooks/useArcium";

type Tab = "deposit" | "withdraw";
const SESSION_DEPOSIT_ENABLED = process.env.NEXT_PUBLIC_SESSION_DEPOSIT_ENABLED === "1";

interface CollateralModalProps {
  isOpen: boolean;
  marginBalance: number | null;
  freeCollateral?: number | null;
  lockedCollateral?: number | null;
  onClose: () => void;
  onSuccess: () => void;
  relayAvailable: boolean;
  relaySession: SessionRelayInfo | null;
  isRelaySessionActive: boolean;
  ensureRelaySession: (
    options?: EnsureRelaySessionOptions
  ) => Promise<SessionRelayInfo | null>;
  invalidateRelaySession: (owner?: string, market?: string) => void;
  refreshRelaySession: () => Promise<SessionRelayInfo | null>;
  pairLabel?: string;
}

export default function CollateralModal({
  isOpen,
  marginBalance,
  freeCollateral,
  lockedCollateral,
  onClose,
  onSuccess,
  relayAvailable,
  relaySession,
  isRelaySessionActive,
  ensureRelaySession,
  invalidateRelaySession,
  refreshRelaySession,
  pairLabel = "SOL-USD",
}: CollateralModalProps) {
  const anchorWallet = useAnchorWalletCompat();
  const publicKey = anchorWallet?.publicKey ?? null;
  const { connection } = useConnection();
  const [tab, setTab] = useState<Tab>("deposit");
  const [amount, setAmount] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [nextClaimAt, setNextClaimAt] = useState<number | null>(null);
  const faucetCooldownKey = publicKey ? `mockusdc_faucet_${publicKey.toBase58()}` : null;

  // Load persisted cooldown from localStorage
  useEffect(() => {
    if (!faucetCooldownKey) return;
    try {
      const stored = localStorage.getItem(faucetCooldownKey);
      if (stored) setNextClaimAt(parseInt(stored, 10));
    } catch {}
  }, [faucetCooldownKey]);

  const handleClaimMockUsdc = useCallback(async () => {
    if (!publicKey || isClaiming) return;
    const now = Date.now();
    if (nextClaimAt && now < nextClaimAt) return;
    setIsClaiming(true);
    const toastId = "faucet-claim";
    toast.loading("Claiming 20,000 mUSDC...", { id: toastId });
    try {
      const res = await fetch("/api/faucet-mock-usdc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58() }),
      });
      const data = await res.json() as { success: boolean; amount?: number; error?: string; nextClaimAt?: number };
      if (data.success) {
        toast.success(`Claimed ${data.amount?.toLocaleString()} mUSDC!`, { id: toastId });
        const nextAt = now + 7 * 24 * 60 * 60 * 1000;
        setNextClaimAt(nextAt);
        if (faucetCooldownKey) {
          try { localStorage.setItem(faucetCooldownKey, String(nextAt)); } catch {}
        }
        onSuccess();
      } else {
        if (data.nextClaimAt) {
          setNextClaimAt(data.nextClaimAt);
          if (faucetCooldownKey) {
            try { localStorage.setItem(faucetCooldownKey, String(data.nextClaimAt)); } catch {}
          }
        }
        toast.error(data.error ?? "Claim failed", { id: toastId });
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Claim failed", { id: toastId });
    } finally {
      setIsClaiming(false);
    }
  }, [publicKey, isClaiming, nextClaimAt, faucetCooldownKey, onSuccess]);
  const availableCollateral = freeCollateral ?? marginBalance;
  const reservedCollateral =
    lockedCollateral ??
    (marginBalance !== null && freeCollateral != null
      ? Math.max(0, marginBalance - freeCollateral)
      : null);

  const getSelectedMarketAddress = useCallback(() => {
    if (!anchorWallet) {
      throw new Error("Connect your wallet");
    }
    const { runtime } = createShadowPerpClient(connection, anchorWallet);
    if (!pairLabel) {
      return runtime.marketAddress;
    }
    const marketAddress = runtime.marketRegistry[pairLabel];
    if (!marketAddress) {
      throw new Error(`Unknown trading pair: ${pairLabel}`);
    }
    return marketAddress;
  }, [anchorWallet, connection, pairLabel]);

  const getRuntimeErrorMessage = useCallback((rawMessage: string, action: "deposit" | "withdraw") => {
    if (!rawMessage.includes("env var")) return null;
    const matched = rawMessage.match(/env var:\s*([A-Z0-9_]+)/i);
    if (matched?.[1]) {
      return `${action === "deposit" ? "Deposits" : "Withdrawals"} unavailable: missing ${matched[1]}. Set it in app/.env.local and restart Next.js.`;
    }
    return `${action === "deposit" ? "Deposits" : "Withdrawals"} unavailable. Check app/.env.local and restart Next.js.`;
  }, []);

  const isSessionAuthError = useCallback((rawMessage: string) => {
    return (
      rawMessage.includes("Invalid session authorization signature") ||
      rawMessage.includes("Session authorization expired") ||
      rawMessage.includes("Authorization expiry exceeds session expiry") ||
      rawMessage.includes("Authorization action mismatch")
    );
  }, []);

  const submitDelegatedCollateral = useCallback(
    async (
      endpoint: "deposit" | "withdraw",
      amountBN: BN,
      loadingMessage: string
    ): Promise<string> => {
      if (!publicKey) throw new Error("Connect your wallet");
      const owner = publicKey.toBase58();

      const submitWithSession = async (session: SessionRelayInfo): Promise<string> => {
        const authExpiresAt = session.authExpiresAt ?? session.expiresAt;
        toast.loading(loadingMessage, { id: "collateral" });
        const response = await fetch(relayUrl(`/api/relay/${endpoint}`), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            owner: session.owner,
            sessionId: session.sessionId,
            amountRaw: amountBN.toString(),
            pairLabel,
            auth: {
              action: endpoint,
              expiresAt: authExpiresAt,
              signature: session.authSignature,
            },
          }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok || !payload?.txSignature) {
          throw new Error(
            payload?.error ||
              `Delegated ${endpoint} failed (${response.status}).`
          );
        }
        return payload.txSignature as string;
      };

      let session = await ensureRelaySession({
        reason: endpoint,
        userInitiated: true,
      });
      if (!session || session.owner !== owner) {
        throw new Error("Delegated session required. Please sign a new session.");
      }

      try {
        return await submitWithSession(session);
      } catch (error: any) {
        const message =
          typeof error?.message === "string" ? error.message : "Delegated session failure";
        if (!isSessionAuthError(message)) {
          throw error;
        }
        invalidateRelaySession(session.owner, session.market);
        session = await ensureRelaySession({
          reason: endpoint,
          userInitiated: true,
        });
        if (!session || session.owner !== owner) {
          throw new Error("Delegated session required. Please sign a new session.");
        }
        return submitWithSession(session);
      }
    },
    [
      ensureRelaySession,
      invalidateRelaySession,
      isSessionAuthError,
      publicKey,
    ]
  );

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setAmount("");
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const handleDeposit = useCallback(async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!publicKey) { toast.error("Connect your wallet"); return; }
    setIsBusy(true);
    try {
      const amountBN = new BN(Math.round(amt * 1_000_000));
      let delegatedDepositComplete = false;

      if (SESSION_DEPOSIT_ENABLED && relayAvailable) {
        try {
          const tx = await submitDelegatedCollateral(
            "deposit",
            amountBN,
            "Depositing via delegated session..."
          );
          await refreshRelaySession();
          toast.success(
            <div>
              <p className="font-medium">Deposited ${amt.toFixed(2)} mUSDC</p>
              <a
                href={getExplorerTxUrl(tx)}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent-purple underline"
              >
                View transaction
              </a>
            </div>,
            { id: "collateral", duration: 8000 }
          );
          setAmount("");
          onSuccess();
          delegatedDepositComplete = true;
        } catch (sessionDepositError: any) {
          const delegatedMsg =
            typeof sessionDepositError?.message === "string"
              ? sessionDepositError.message
              : "Delegated deposit failed";
          const unsupportedDelegatedPath =
            delegatedMsg.includes("depositCollateralWithSession is unavailable") ||
            delegatedMsg.includes("InstructionFallbackNotFound") ||
            delegatedMsg.includes("Method not found");
          if (!unsupportedDelegatedPath) {
            throw sessionDepositError;
          }
          toast(
            "Delegated deposit not active on current deployment, using wallet deposit.",
            { id: "collateral" }
          );
        }
      }

      if (delegatedDepositComplete) return;

      if (!anchorWallet || !publicKey) { throw new Error("Connect your wallet"); }
      const { client } = createShadowPerpClient(connection, anchorWallet);
      const marketAddress = getSelectedMarketAddress();
      toast.loading("Depositing collateral...", { id: "collateral" });
      const tx = await client.depositCollateral(marketAddress, amountBN);
      toast.success(
        <div>
          <p className="font-medium">Deposited ${amt.toFixed(2)} mUSDC</p>
          <a
            href={getExplorerTxUrl(tx)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent-purple underline"
          >
            View transaction
          </a>
        </div>,
        { id: "collateral", duration: 8000 }
      );
      setAmount("");
      onSuccess();
    } catch (error: any) {
      const classified = error?.classified ?? classifyArciumError(error);
      const msg = classified.message || "Deposit failed";
      const runtimeError = getRuntimeErrorMessage(msg, "deposit");
      if (runtimeError) {
        toast.error(runtimeError, { id: "collateral" });
      } else {
        toast.error(msg, { id: "collateral" });
      }
    } finally {
      setIsBusy(false);
    }
  }, [
    amount,
    anchorWallet,
    connection,
    ensureRelaySession,
    getSelectedMarketAddress,
    getRuntimeErrorMessage,
    isRelaySessionActive,
    onSuccess,
    publicKey,
    refreshRelaySession,
    relayAvailable,
    relaySession,
    submitDelegatedCollateral,
  ]);

  const handleWithdraw = useCallback(async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!publicKey) { toast.error("Connect your wallet"); return; }
    if (availableCollateral !== null && amt > availableCollateral) {
      toast.error("Amount exceeds free collateral");
      return;
    }
    setIsBusy(true);
    try {
      const amountBN = new BN(Math.round(amt * 1_000_000));
      let delegatedWithdrawComplete = false;

      if (relayAvailable) {
        try {
          const tx = await submitDelegatedCollateral(
            "withdraw",
            amountBN,
            "Withdrawing via delegated session..."
          );
          await refreshRelaySession();
          toast.success(
            <div>
              <p className="font-medium">Withdrew ${amt.toFixed(2)} mUSDC</p>
              <a
                href={getExplorerTxUrl(tx)}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent-purple underline"
              >
                View transaction
              </a>
            </div>,
            { id: "collateral", duration: 8000 }
          );
          setAmount("");
          onSuccess();
          delegatedWithdrawComplete = true;
        } catch (sessionWithdrawError: any) {
          const delegatedMsg =
            typeof sessionWithdrawError?.message === "string"
              ? sessionWithdrawError.message
              : "Delegated withdraw failed";
          const unsupportedDelegatedPath =
            delegatedMsg.includes("withdrawCollateralWithSession is unavailable") ||
            delegatedMsg.includes("InstructionFallbackNotFound") ||
            delegatedMsg.includes("Method not found");
          if (!unsupportedDelegatedPath) {
            throw sessionWithdrawError;
          }
          toast(
            "Delegated withdraw not active on current deployment, using wallet withdraw.",
            { id: "collateral" }
          );
        }
      }

      if (delegatedWithdrawComplete) return;

      if (!anchorWallet || !publicKey) {
        throw new Error("Connect your wallet");
      }
      const { client } = createShadowPerpClient(connection, anchorWallet);
      const marketAddress = getSelectedMarketAddress();
      toast.loading("Withdrawing collateral...", { id: "collateral" });
      const tx = await client.withdrawCollateral(marketAddress, amountBN);
      toast.success(
        <div>
          <p className="font-medium">Withdrew ${amt.toFixed(2)} mUSDC</p>
          <a
            href={getExplorerTxUrl(tx)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent-purple underline"
          >
            View transaction
          </a>
        </div>,
        { id: "collateral", duration: 8000 }
      );
      setAmount("");
      onSuccess();
    } catch (error: any) {
      const classified = error?.classified ?? classifyArciumError(error);
      const msg = classified.message || "Withdraw failed";
      const runtimeError = getRuntimeErrorMessage(msg, "withdraw");
      if (runtimeError) {
        toast.error(runtimeError, { id: "collateral" });
      } else {
        toast.error(msg, { id: "collateral" });
      }
    } finally {
      setIsBusy(false);
    }
  }, [
    amount,
    anchorWallet,
    connection,
    getSelectedMarketAddress,
    getRuntimeErrorMessage,
    availableCollateral,
    onSuccess,
    publicKey,
    refreshRelaySession,
    relayAvailable,
    submitDelegatedCollateral,
  ]);

  if (!isOpen || !mounted) return null;

  const QUICK_AMOUNTS = tab === "deposit"
    ? ["10", "50", "100", "500"]
    : availableCollateral
    ? [
        (availableCollateral * 0.25).toFixed(2),
        (availableCollateral * 0.5).toFixed(2),
        (availableCollateral * 0.75).toFixed(2),
        availableCollateral.toFixed(2),
      ]
    : ["10", "50", "100"];

  const QUICK_LABELS = tab === "withdraw" && availableCollateral
    ? ["25%", "50%", "75%", "100%"]
    : QUICK_AMOUNTS.map((v) => `$${v}`);
  const actionHelperText =
    relayAvailable
      ? "Shadow will use your trading session when it can. If not, it will fall back to a normal wallet transaction."
      : "This action will open a normal wallet transaction on Solana devnet.";
  const actionLabel = tab === "deposit" ? "Deposit to trading account" : "Withdraw to wallet";
  const actionButtonLabel = isBusy
    ? tab === "deposit"
      ? "Preparing deposit..."
      : "Preparing withdrawal..."
    : tab === "deposit"
    ? `Deposit${amount ? ` $${parseFloat(amount).toFixed(2)}` : ""}`
    : `Withdraw${amount ? ` $${parseFloat(amount).toFixed(2)}` : ""}`;

  return createPortal(
    <div
      className={`fixed inset-0 z-[500] flex items-center justify-center overflow-y-auto p-4 transition-all duration-300 sm:top-20 sm:bottom-0 sm:inset-x-0 ${
        visible ? "bg-black/60 backdrop-blur-sm" : "bg-black/0"
      }`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`collateral-modal-panel w-full max-w-sm rounded-2xl border border-shadow-500 overflow-hidden transition-all duration-300 ${
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-4"
        }`}
        style={{ background: "linear-gradient(135deg, #1a1a25 0%, #12121a 100%)" }}
      >
        {/* Header */}
        <div className="border-b border-shadow-600 px-5 pb-4 pt-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">Manage Collateral</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                Move mUSDC between your wallet and your Shadow trading account.
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 transition-colors hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="mt-3 rounded-xl border border-shadow-600/80 bg-shadow-800/55 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-gray-500">
              Trading account
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
              Token transfers are public on Solana. Your position details stay separate and encrypted from the transfer itself.
            </p>
          </div>
        </div>

        {/* Balance */}
        <div className="grid grid-cols-3 gap-3 bg-shadow-800/60 border-b border-shadow-700 px-5 py-3">
          <BalanceMetric
            label="Account total"
            value={marginBalance !== null ? `$${marginBalance.toFixed(2)}` : "--"}
          />
          <BalanceMetric
            label="Available now"
            value={availableCollateral !== null ? `$${availableCollateral.toFixed(2)}` : "--"}
            valueClass="text-accent-green"
          />
          <BalanceMetric
            label="Locked"
            value={reservedCollateral !== null ? `$${reservedCollateral.toFixed(2)}` : "--"}
            valueClass="text-yellow-300"
          />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-shadow-600">
          {(["deposit", "withdraw"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setAmount(""); }}
              className={`flex-1 py-2.5 text-xs font-medium border-b-2 transition-colors capitalize ${
                tab === t
                  ? "border-accent-purple text-white"
                  : "border-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs text-gray-400">
              {actionLabel} (mUSDC)
            </label>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-shadow-700 border border-shadow-500 rounded-lg px-4 py-2.5 text-base focus:outline-none focus:border-accent-purple transition-colors pr-14"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">
                mUSDC
              </span>
            </div>

            {/* Quick amounts */}
            <div className="flex gap-1.5 mt-2">
              {QUICK_AMOUNTS.map((v, i) => (
                <button
                  key={v}
                  onClick={() => setAmount(v)}
                  className="flex-1 py-1 text-[11px] rounded bg-shadow-600 text-gray-400 hover:text-accent-purple hover:bg-shadow-500 transition-colors"
                >
                  {QUICK_LABELS[i]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
              {actionHelperText}
            </p>
          </div>

          {/* Info row */}
          {tab === "withdraw" && availableCollateral !== null && amount && parseFloat(amount) > 0 && (
            <div className="rounded-lg bg-shadow-700 px-3 py-2 text-xs text-gray-400">
              Free collateral after this withdrawal:{" "}
              <span className="text-white font-medium">
                ${Math.max(0, availableCollateral - parseFloat(amount)).toFixed(2)} mUSDC
              </span>
            </div>
          )}

          {/* Action button */}
          <button
            onClick={tab === "deposit" ? handleDeposit : handleWithdraw}
            disabled={isBusy || !amount || parseFloat(amount) <= 0}
            className={`w-full py-2.5 rounded-lg font-semibold text-sm transition-all ${
              tab === "deposit"
                ? "bg-accent-purple hover:bg-accent-purple/80"
                : "bg-shadow-600 hover:bg-shadow-500 border border-shadow-500"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {actionButtonLabel}
          </button>

          <p className="text-center text-[10px] leading-relaxed text-gray-600">
            mUSDC is Shadow&apos;s devnet collateral token. Your position details stay encrypted through Arcium MPC.
          </p>

          {/* MockUSDC faucet claim */}
          {publicKey && (() => {
            const now = Date.now();
            const canClaim = !nextClaimAt || now >= nextClaimAt;
            const daysLeft = nextClaimAt
              ? Math.ceil((nextClaimAt - now) / (1000 * 60 * 60 * 24))
              : 0;
            return (
              <div className="rounded-xl border border-shadow-600/70 bg-shadow-800/50 px-4 py-3 text-center">
                <p className="text-[10px] text-gray-500 mb-2">
                  {canClaim
                    ? "Claim free mUSDC to start trading"
                    : `Next claim in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`}
                </p>
                <button
                  type="button"
                  onClick={handleClaimMockUsdc}
                  disabled={!canClaim || isClaiming}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold bg-accent-purple/20 border border-accent-purple/40 text-accent-purple hover:bg-accent-purple/30 hover:border-accent-purple/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  {isClaiming ? "Claiming..." : canClaim ? "Claim 20,000 mUSDC" : "Already Claimed"}
                </button>
              </div>
            );
          })()}

        </div>
      </div>
    </div>,
    document.body
  );
}

function BalanceMetric({
  label,
  value,
  valueClass = "text-white",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.1em] text-gray-500">{label}</span>
      <span className={`text-sm font-semibold ${valueClass}`}>
        {value} <span className="text-[10px] font-medium text-gray-500">mUSDC</span>
      </span>
    </div>
  );
}
