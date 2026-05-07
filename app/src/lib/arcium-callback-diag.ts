import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

export function extractOpenCallbackFailureMessage(
  logs: string[],
  clusterOffset: number
): string | null {
  if (!logs.some((line) => line.includes("Instruction: OpenPositionProbeBCallback"))) {
    return null;
  }

  // 6204 = AlreadyCallbackedComputation — original callback already settled the trade.
  // This is NOT a failure; treat it as already-settled so the UI refreshes instead of retrying.
  const alreadyCallbacked = logs.find(
    (line) =>
      line.includes("AlreadyCallbackedComputation") ||
      line.includes("Callback computation already called")
  );
  if (alreadyCallbacked) {
    return `AlreadyCallbackedComputation: this order already settled on-chain (cluster ${clusterOffset}). Refresh to see the latest state.`;
  }

  const aborted = logs.find((line) => line.includes("AbortedComputation"));
  const invalidResult = logs.find((line) => line.includes("InvalidComputationResult"));

  if (aborted || invalidResult) {
    const stages = [
      aborted ? "AbortedComputation (6000)" : null,
      invalidResult ? "InvalidComputationResult (6010)" : null,
    ].filter(Boolean);
    return `Queued on Arcium cluster ${clusterOffset}, but the MPC callback already failed on-chain: ${stages.join(" -> ")}.`;
  }

  return `Queued on Arcium cluster ${clusterOffset}, but the MPC callback already failed on-chain.`;
}

export async function diagnoseOpenCallbackFailure(
  connection: Connection,
  positionAddress: PublicKey,
  pendingComputationAddress: PublicKey | null,
  clusterOffset: number
): Promise<string | null> {
  const addresses = [pendingComputationAddress, positionAddress].filter(
    (address): address is PublicKey => !!address
  );
  const seen = new Set<string>();
  const signatures: { signature: string; blockTime: number }[] = [];

  for (const address of addresses) {
    try {
      const recent = await connection.getSignaturesForAddress(address, { limit: 8 }, "confirmed");
      for (const entry of recent) {
        if (seen.has(entry.signature)) continue;
        seen.add(entry.signature);
        signatures.push({ signature: entry.signature, blockTime: entry.blockTime ?? 0 });
      }
    } catch {
      // Best-effort only.
    }
  }

  signatures.sort((a, b) => b.blockTime - a.blockTime);

  for (const { signature } of signatures.slice(0, 12)) {
    try {
      const tx = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      const logs = tx?.meta?.logMessages ?? [];
      if (!logs.length || !tx?.meta?.err) continue;
      const message = extractOpenCallbackFailureMessage(logs, clusterOffset);
      if (message) return message;
    } catch {
      // Ignore individual RPC misses.
    }
  }

  return null;
}

export function normalizePositionStatus(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (raw && typeof raw === "object") {
    const key = Object.keys(raw as Record<string, unknown>)[0];
    if (!key) return -1;
    const k = key.toLowerCase();
    if (k === "pending") return 0;
    if (k === "open") return 1;
    if (k === "closing") return 2;
    if (k === "closed") return 3;
    if (k === "liquidated") return 4;
    if (k === "closedpendingsettlement") return 5;
    if (k === "liquidatedpendingsettlement") return 6;
  }
  return -1;
}

export function getDummyWallet(owner: PublicKey) {
  return {
    publicKey: owner,
    signTransaction: async <T>(tx: T) => tx,
    signAllTransactions: async <T>(txs: T[]) => txs,
  };
}
