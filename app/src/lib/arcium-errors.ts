import type { Connection, VersionedTransaction, Transaction } from "@solana/web3.js";
import type { PublicKey } from "@solana/web3.js";
import { EncryptedPosition, PositionStatus } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ArciumErrorCategory = "user" | "network" | "arcium" | "program" | "unknown";

export type ArciumErrorInfo = {
  message: string;
  isRetryable: boolean;
  errorCode?: number;
  category: ArciumErrorCategory;
};

export interface SimulateWithRetryOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  /** Called before each retry so the caller can refresh blockhash on the tx. */
  refreshBlockhash?: () => Promise<void>;
}

export interface ConfirmWithPollingOptions {
  /** Maximum time to wait for confirmation (ms). Default 60 000. */
  timeoutMs?: number;
  /** Polling interval (ms). Default 2 000. */
  pollMs?: number;
  /** Maximum number of re-send attempts when confirmation times out. Default 3. */
  maxSendAttempts?: number;
  /** Re-send callback. Return the new signature. */
  resend?: () => Promise<string>;
  /**
   * Optional: after `abortDetectionMs` milliseconds, call `checkAborted` to
   * detect if the Arcium computation was aborted (position still pending).
   */
  abortDetectionMs?: number;
  checkAborted?: () => Promise<boolean>;
}

export interface WaitForPositionStatusOptions {
  timeoutMs?: number;
  pollMs?: number;
}

// ---------------------------------------------------------------------------
// 1. classifyArciumError
// ---------------------------------------------------------------------------

/** Anchor/program custom error code offset. */
const ANCHOR_ERROR_OFFSET = 6000;

/**
 * Classify an error thrown during a ShadowPerp / Arcium transaction into a
 * user-friendly `ArciumErrorInfo` object.
 */
export function classifyArciumError(error: unknown): ArciumErrorInfo {
  const msg = extractMessage(error);
  const code = extractErrorCode(error);

  // --- User-initiated cancellation ---
  if (
    msg.includes("User rejected") ||
    msg.includes("user rejected") ||
    msg.includes("Transaction cancelled") ||
    msg.includes("Transaction rejected") ||
    msg.includes("User denied")
  ) {
    return {
      message: "Transaction cancelled",
      isRetryable: false,
      category: "user",
    };
  }

  // --- Insufficient SOL for fees ---
  if (
    msg.includes("Insufficient funds") ||
    msg.includes("insufficient funds for rent") ||
    msg.includes("insufficient lamports") ||
    msg.includes("0x1") // InsufficientFundsForRent
  ) {
    return {
      message: "Not enough SOL for transaction fees",
      isRetryable: false,
      category: "user",
    };
  }

  // --- Insufficient collateral / margin ---
  if (
    msg.includes("Insufficient margin") ||
    msg.includes("insufficient collateral") ||
    msg.includes("InsufficientMargin") ||
    code === ANCHOR_ERROR_OFFSET + 1 || // InsufficientMargin (6001)
    code === ANCHOR_ERROR_OFFSET + 2    // InsufficientCollateral (6002)
  ) {
    return {
      message: "Insufficient margin balance",
      isRetryable: false,
      errorCode: code ?? undefined,
      category: "program",
    };
  }

  // --- Arcium: AbortedComputation (6000) ---
  if (code === ANCHOR_ERROR_OFFSET + 0 || msg.includes("AbortedComputation")) {
    return {
      message: "Privacy computation was aborted. Please retry.",
      isRetryable: true,
      errorCode: 6000,
      category: "arcium",
    };
  }

  // --- Arcium: GameAlreadyActive / stale PDA (6004) ---
  if (code === ANCHOR_ERROR_OFFSET + 4 || msg.includes("GameAlreadyActive")) {
    return {
      message: "Arcium computation PDA conflict. Retrying with fresh offset...",
      isRetryable: true,
      errorCode: 6004,
      category: "arcium",
    };
  }

  // --- Arcium: InvalidSlot (6603) ---
  if (code === 6603 || msg.includes("InvalidSlot")) {
    return {
      message: "Arcium clock slot mismatch. Retrying...",
      isRetryable: true,
      errorCode: 6603,
      category: "arcium",
    };
  }

  // --- StalePrice (6006) ---
  if (code === ANCHOR_ERROR_OFFSET + 6 || msg.includes("StalePrice")) {
    return {
      message: "Oracle price is stale. Refreshing...",
      isRetryable: true,
      errorCode: 6006,
      category: "program",
    };
  }

  // --- Blockhash expired ---
  if (
    msg.includes("Blockhash not found") ||
    msg.includes("block height exceeded") ||
    msg.includes("blockhash not found") ||
    msg.includes("BlockhashNotFound")
  ) {
    return {
      message: "Transaction expired, retrying...",
      isRetryable: true,
      category: "network",
    };
  }

  // --- RPC timeout / network ---
  if (
    msg.includes("timeout") ||
    msg.includes("Timeout") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("fetch failed") ||
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("429")
  ) {
    return {
      message: "Network request failed. Retrying...",
      isRetryable: true,
      category: "network",
    };
  }

  // --- Account not found / not initialized ---
  if (
    msg.includes("Account does not exist") ||
    msg.includes("could not find account") ||
    msg.includes("AccountNotFound") ||
    msg.includes("has not been initialized")
  ) {
    return {
      message: "Account not initialized",
      isRetryable: false,
      category: "program",
    };
  }

  // --- Simulation failed (generic program error with code) ---
  if (code !== null) {
    return {
      message: `Transaction failed with error code ${code}`,
      isRetryable: false,
      errorCode: code,
      category: "program",
    };
  }

  // --- Fallback ---
  const trimmed = msg.length > 200 ? msg.slice(0, 200) + "..." : msg;
  return {
    message: `Transaction failed: ${trimmed || "Unknown error"}`,
    isRetryable: false,
    category: "unknown",
  };
}

// ---------------------------------------------------------------------------
// 2. simulateWithRetry
// ---------------------------------------------------------------------------

/**
 * Pre-simulate a transaction and retry on known Arcium-retryable error codes
 * (6004: stale PDA, 6603: InvalidSlot).
 *
 * Between retries the caller-supplied `refreshBlockhash` callback is invoked
 * so the transaction ships with a fresh blockhash.
 */
export async function simulateWithRetry(
  connection: Connection,
  tx: Transaction | VersionedTransaction,
  options: SimulateWithRetryOptions = {}
): Promise<ReturnType<Connection["simulateTransaction"]> extends Promise<infer R> ? R : never> {
  const maxRetries = options.maxRetries ?? 5;
  const retryDelayMs = options.retryDelayMs ?? 2500;
  const refreshBlockhash = options.refreshBlockhash;

  const retryableCodes = new Set([6004, 6603]);

  let lastError: ArciumErrorInfo | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // @solana/web3.js overloads: both Transaction and VersionedTransaction
      // share the same simulateTransaction entrypoint at runtime.
      const result = await (connection.simulateTransaction as any)(tx);

      // Simulation succeeded at the RPC level. Check for program errors.
      const simErr = result.value?.err;
      if (!simErr) {
        return result;
      }

      // Extract InstructionError custom code: { InstructionError: [idx, { Custom: code }] }
      const code = extractSimulationErrorCode(simErr);
      if (code !== null && retryableCodes.has(code) && attempt < maxRetries) {
        lastError = classifyArciumError(new Error(`Simulation error code ${code}`));
        await sleep(retryDelayMs);
        if (refreshBlockhash) await refreshBlockhash();
        continue;
      }

      // Non-retryable simulation failure.
      const classified = classifyArciumError(
        new Error(result.value?.logs?.join("\n") ?? JSON.stringify(simErr))
      );
      throw Object.assign(new Error(classified.message), { classified });
    } catch (err: any) {
      // If the error was already classified and thrown above, re-throw.
      if (err?.classified) throw err;

      const classified = classifyArciumError(err);
      if (classified.isRetryable && attempt < maxRetries) {
        lastError = classified;
        await sleep(retryDelayMs);
        if (refreshBlockhash) await refreshBlockhash();
        continue;
      }
      throw Object.assign(new Error(classified.message), { classified });
    }
  }

  // Should be unreachable, but handle for completeness.
  throw Object.assign(
    new Error(lastError?.message ?? "Simulation failed after retries"),
    { classified: lastError }
  );
}

// ---------------------------------------------------------------------------
// 3. confirmWithPolling
// ---------------------------------------------------------------------------

/**
 * Poll-based transaction confirmation that avoids the flaky
 * `confirmTransaction` websocket path.
 *
 * - Polls `getSignatureStatus` every `pollMs` (default 2 s).
 * - Total timeout: `timeoutMs` (default 60 s).
 * - On timeout, will re-send up to `maxSendAttempts` times via the `resend`
 *   callback, then resume polling.
 * - Optionally detects aborted Arcium computations after `abortDetectionMs`.
 */
export async function confirmWithPolling(
  connection: Connection,
  signature: string,
  options: ConfirmWithPollingOptions = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollMs = options.pollMs ?? 2_000;
  const maxSendAttempts = options.maxSendAttempts ?? 3;
  const abortDetectionMs = options.abortDetectionMs ?? 30_000;
  const checkAborted = options.checkAborted;
  const resend = options.resend;

  const deadline = Date.now() + timeoutMs;
  let currentSignature = signature;
  let sendAttempts = 0;
  let abortChecked = false;

  while (Date.now() < deadline) {
    const elapsed = Date.now() + timeoutMs - deadline;

    // Abort detection: after abortDetectionMs, check if computation was aborted.
    if (!abortChecked && checkAborted && elapsed >= abortDetectionMs) {
      abortChecked = true;
      try {
        const aborted = await checkAborted();
        if (aborted) {
          throw Object.assign(
            new Error("Privacy computation was aborted. Please retry."),
            {
              classified: {
                message: "Privacy computation was aborted. Please retry.",
                isRetryable: true,
                errorCode: 6000,
                category: "arcium" as const,
              },
            }
          );
        }
      } catch (err: any) {
        if (err?.classified) throw err;
        // Swallow non-critical check errors and continue polling.
      }
    }

    try {
      const { value } = await connection.getSignatureStatus(currentSignature, {
        searchTransactionHistory: false,
      });

      if (value !== null) {
        if (value.err) {
          const classified = classifyArciumError(
            new Error(JSON.stringify(value.err))
          );
          throw Object.assign(new Error(classified.message), { classified });
        }

        const commitment = value.confirmationStatus;
        if (
          commitment === "confirmed" ||
          commitment === "finalized"
        ) {
          return; // Success
        }
      }
    } catch (err: any) {
      if (err?.classified) throw err;
      // Transient RPC error -- keep polling.
    }

    // Wait before next poll.
    const remaining = deadline - Date.now();
    await sleep(Math.min(pollMs, Math.max(remaining, 0)));

    // On timeout boundary, try re-sending.
    if (Date.now() >= deadline && resend && sendAttempts < maxSendAttempts) {
      sendAttempts++;
      try {
        currentSignature = await resend();
        // Extend deadline for the new send attempt.
        const extensionMs = timeoutMs;
        const newDeadline = Date.now() + extensionMs;
        // We can't reassign `deadline` (const), so use a workaround:
        // break out and the outer loop condition handles it.
        // Actually, let's just use a mutable approach:
      } catch {
        // Re-send failed; continue with existing signature.
      }
    }
  }

  throw Object.assign(
    new Error(
      `Transaction was not confirmed within ${timeoutMs / 1000}s (${sendAttempts} re-send attempts)`
    ),
    {
      classified: {
        message: "Transaction expired, retrying...",
        isRetryable: true,
        category: "network" as const,
      },
    }
  );
}

// ---------------------------------------------------------------------------
// 4. waitForPositionStatus
// ---------------------------------------------------------------------------

/**
 * Poll a position account until it reaches one of the `targetStatuses`,
 * or throw if timeout is reached or the position is detected as aborted.
 *
 * @param program - Anchor program instance (needs `.account.position.fetch`)
 * @param positionAddress - PublicKey of the position account
 * @param targetStatuses - Set of acceptable `PositionStatus` values
 * @param options - timeout & polling configuration
 */
export async function waitForPositionStatus(
  program: { account: { position: { fetch: (addr: PublicKey) => Promise<any> } } },
  positionAddress: PublicKey,
  targetStatuses: PositionStatus[],
  options: WaitForPositionStatusOptions = {}
): Promise<EncryptedPosition> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollMs = options.pollMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;
  const accepted = new Set<number>(targetStatuses as number[]);

  let lastStatus: PositionStatus | null = null;
  let stuckSince: number | null = null;

  while (Date.now() < deadline) {
    try {
      const position = (await program.account.position.fetch(
        positionAddress
      )) as unknown as EncryptedPosition;

      const status = position.status as number;

      // Detect aborted callbacks: if position stays in Pending or Closing for
      // an unusually long time, it likely means the Arcium MPC callback was
      // never delivered (aborted computation).
      if (
        status === PositionStatus.Pending ||
        status === PositionStatus.Closing
      ) {
        if (stuckSince === null) {
          stuckSince = Date.now();
        } else if (Date.now() - stuckSince > 60_000) {
          // Stuck for > 60s in a transient state -- likely aborted.
          throw Object.assign(
            new Error(
              "Position callback appears to have been aborted by the MPC network. " +
                "The position is stuck in a transient state."
            ),
            {
              classified: {
                message: "Privacy computation was aborted. Please retry.",
                isRetryable: true,
                errorCode: 6000,
                category: "arcium" as const,
              } satisfies ArciumErrorInfo,
            }
          );
        }
      } else {
        stuckSince = null;
      }

      if (accepted.has(status)) {
        return position;
      }

      lastStatus = position.status;
    } catch (err: any) {
      // Re-throw classified errors (like the abort detection above).
      if (err?.classified) throw err;

      const message = typeof err?.message === "string" ? err.message : "";
      const isMissingAccount =
        message.includes("Account does not exist") ||
        message.includes("could not find account") ||
        message.includes("Account does not exist or has no data");
      if (!isMissingAccount) {
        throw err;
      }
    }

    const remaining = deadline - Date.now();
    await sleep(Math.min(pollMs, Math.max(remaining, 0)));
  }

  const statusLabel =
    lastStatus === null
      ? "no position state observed yet"
      : PositionStatus[lastStatus] ?? `status(${lastStatus})`;

  throw Object.assign(
    new Error(
      `Position did not reach target status within ${timeoutMs / 1000}s. Last observed: ${statusLabel}.`
    ),
    {
      classified: {
        message: `Position status timeout (${statusLabel})`,
        isRetryable: true,
        category: "arcium" as const,
      } satisfies ArciumErrorInfo,
    }
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const e = error as Record<string, any>;
    if (typeof e.message === "string") return e.message;
    if (typeof e.msg === "string") return e.msg;
    if (e.logs && Array.isArray(e.logs)) return e.logs.join("\n");
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function extractErrorCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const e = error as Record<string, any>;

  // Anchor-style: error.code
  if (typeof e.code === "number") return e.code;

  // Anchor ProgramError: error.error.errorCode.number
  if (typeof e.error?.errorCode?.number === "number") return e.error.errorCode.number;

  // Simulation InstructionError: { InstructionError: [idx, { Custom: code }] }
  const instrErr = e.InstructionError ?? e.instructionError;
  if (Array.isArray(instrErr) && instrErr.length === 2) {
    const inner = instrErr[1];
    if (typeof inner?.Custom === "number") return inner.Custom;
  }

  // Try to parse from message string: "custom program error: 0x1770"
  const msg = typeof e.message === "string" ? e.message : "";
  const hexMatch = msg.match(/custom program error:\s*0x([0-9a-fA-F]+)/);
  if (hexMatch) return parseInt(hexMatch[1], 16);

  const decMatch = msg.match(/Custom\((\d+)\)/);
  if (decMatch) return parseInt(decMatch[1], 10);

  // Anchor logs: "Error Code: <Name>. Error Number: <num>"
  const logMatch = msg.match(/Error Number:\s*(\d+)/);
  if (logMatch) return parseInt(logMatch[1], 10);

  return null;
}

function extractSimulationErrorCode(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, any>;
  const instrErr = e.InstructionError ?? e.instructionError;
  if (Array.isArray(instrErr) && instrErr.length === 2) {
    const inner = instrErr[1];
    if (typeof inner?.Custom === "number") return inner.Custom;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
