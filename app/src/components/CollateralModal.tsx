import { useCallback, useEffect, useState } from "react";
import BN from "bn.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import toast from "react-hot-toast";
import { createShadowPerpClient } from "../lib/create-client";
import { useAnchorWalletCompat } from "../lib/use-anchor-wallet";
import { getExplorerTxUrl } from "../lib/explorer";
import type {
  EnsureRelaySessionOptions,
  SessionRelayInfo,
} from "../hooks/useArcium";

type Tab = "deposit" | "withdraw";
const SESSION_DEPOSIT_ENABLED = process.env.NEXT_PUBLIC_SESSION_DEPOSIT_ENABLED === "1";

interface CollateralModalProps {
  isOpen: boolean;
  marginBalance: number | null;
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
}

export default function CollateralModal({
  isOpen,
  marginBalance,
  onClose,
  onSuccess,
  relayAvailable,
  relaySession,
  isRelaySessionActive,
  ensureRelaySession,
  invalidateRelaySession,
  refreshRelaySession,
}: CollateralModalProps) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWalletCompat();
  const { connection } = useConnection();
  const [tab, setTab] = useState<Tab>("deposit");
  const [amount, setAmount] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [visible, setVisible] = useState(false);

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
      rawMessage.includes("Authorization expiry exceeds session expiry")
    );
  }, []);

  const submitDelegatedCollateral = useCallback(
    async (
      endpoint: "/api/relay/deposit" | "/api/relay/withdraw",
      amountBN: BN,
      loadingMessage: string
    ): Promise<string> => {
      if (!publicKey) throw new Error("Connect your wallet");
      const owner = publicKey.toBase58();

      const submitWithSession = async (session: SessionRelayInfo): Promise<string> => {
        const authExpiresAt = session.authExpiresAt ?? session.expiresAt;
        toast.loading(loadingMessage, { id: "collateral" });
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            owner: session.owner,
            sessionId: session.sessionId,
            amountRaw: amountBN.toString(),
            auth: {
              expiresAt: authExpiresAt,
              signature: session.authSignature,
            },
          }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok || !payload?.txSignature) {
          throw new Error(
            payload?.error ||
              `Delegated ${
                endpoint === "/api/relay/deposit" ? "deposit" : "withdraw"
              } failed (${response.status}).`
          );
        }
        return payload.txSignature as string;
      };

      const existing =
        isRelaySessionActive && relaySession?.owner === owner ? relaySession : null;
      let session =
        existing ??
        (await ensureRelaySession({
          reason: endpoint === "/api/relay/deposit" ? "deposit" : "withdraw",
          userInitiated: true,
        }));
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
          reason: endpoint === "/api/relay/deposit" ? "deposit" : "withdraw",
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
      isRelaySessionActive,
      isSessionAuthError,
      publicKey,
      relaySession,
    ]
  );

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
            "/api/relay/deposit",
            amountBN,
            "Depositing via delegated session..."
          );
          await refreshRelaySession();
          toast.success(
            <div>
              <p className="font-medium">Deposited ${amt.toFixed(2)} USDC</p>
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
      const { client, runtime } = createShadowPerpClient(connection, anchorWallet);
      toast.loading("Depositing collateral...", { id: "collateral" });
      const tx = await client.depositCollateral(runtime.marketAddress, amountBN);
      toast.success(
        <div>
          <p className="font-medium">Deposited ${amt.toFixed(2)} USDC</p>
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
      const msg = error?.message ?? "Deposit failed";
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
    if (marginBalance !== null && amt > marginBalance) {
      toast.error("Amount exceeds available balance");
      return;
    }
    if (!relayAvailable) {
      toast.error("Delegated withdrawal unavailable: relay is offline.");
      return;
    }
    setIsBusy(true);
    try {
      const amountBN = new BN(Math.round(amt * 1_000_000));
      const tx = await submitDelegatedCollateral(
        "/api/relay/withdraw",
        amountBN,
        "Withdrawing via delegated session..."
      );
      await refreshRelaySession();
      toast.success(
        <div>
          <p className="font-medium">Withdrew ${amt.toFixed(2)} USDC</p>
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
      const msg = error?.message ?? "Withdraw failed";
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
    ensureRelaySession,
    getRuntimeErrorMessage,
    isRelaySessionActive,
    marginBalance,
    onSuccess,
    publicKey,
    refreshRelaySession,
    relayAvailable,
    submitDelegatedCollateral,
  ]);

  if (!isOpen) return null;

  const QUICK_AMOUNTS = tab === "deposit"
    ? ["10", "50", "100", "500"]
    : marginBalance
    ? [
        (marginBalance * 0.25).toFixed(2),
        (marginBalance * 0.5).toFixed(2),
        (marginBalance * 0.75).toFixed(2),
        marginBalance.toFixed(2),
      ]
    : ["10", "50", "100"];

  const QUICK_LABELS = tab === "withdraw" && marginBalance
    ? ["25%", "50%", "75%", "100%"]
    : QUICK_AMOUNTS.map((v) => `$${v}`);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-300 ${
        visible ? "bg-black/60 backdrop-blur-sm" : "bg-black/0"
      }`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`collateral-modal-panel w-full max-w-sm mx-4 rounded-2xl border border-shadow-500 overflow-hidden transition-all duration-300 ${
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-4"
        }`}
        style={{ background: "linear-gradient(135deg, #1a1a25 0%, #12121a 100%)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-shadow-600">
          <h3 className="text-base font-semibold">Manage Collateral</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Balance */}
        <div className="px-5 py-3 flex items-center justify-between bg-shadow-800/60 border-b border-shadow-700">
          <span className="text-xs text-gray-400">Margin Balance</span>
          <span className="text-sm font-semibold">
            {marginBalance !== null ? `$${marginBalance.toFixed(2)} USDC` : "--"}
          </span>
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
            <label className="block text-xs text-gray-400 mb-1.5">
              {tab === "deposit" ? "Deposit amount (USDC)" : "Withdraw amount (USDC)"}
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
                USDC
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
          </div>

          {/* Info row */}
          {tab === "withdraw" && marginBalance !== null && amount && parseFloat(amount) > 0 && (
            <div className="rounded-lg bg-shadow-700 px-3 py-2 text-xs text-gray-400">
              Remaining balance after:{" "}
              <span className="text-white font-medium">
                ${Math.max(0, marginBalance - parseFloat(amount)).toFixed(2)} USDC
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
            {isBusy
              ? tab === "deposit"
                ? "Depositing..."
                : "Withdrawing..."
              : tab === "deposit"
              ? `Deposit${amount ? ` $${parseFloat(amount).toFixed(2)}` : ""}`
              : `Withdraw${amount ? ` $${parseFloat(amount).toFixed(2)}` : ""}`}
          </button>

          <p className="text-[10px] text-center text-gray-600">
            Collateral is held on-chain in the Shadow vault
          </p>
        </div>
      </div>
    </div>
  );
}
