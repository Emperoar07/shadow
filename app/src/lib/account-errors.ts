export function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.msg === "string") return record.msg;
    if (Array.isArray(record.logs)) {
      return record.logs
        .filter((entry): entry is string => typeof entry === "string")
        .join("\n");
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

export function isMissingAccountError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  return (
    message.includes("Account does not exist") ||
    message.includes("Account does not exist or has no data") ||
    message.includes("could not find account") ||
    message.includes("AccountNotFound") ||
    message.includes("has not been initialized")
  );
}

export function extractMissingAccountContext(error: unknown): string | null {
  const message = extractErrorMessage(error);

  const anchorAccount = message.match(/caused by account:\s*([A-Za-z0-9_]+)/i)?.[1];
  if (anchorAccount) {
    return anchorAccount.replace(/_/g, " ");
  }

  const pubkey = message.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/)?.[0];
  if (pubkey) {
    return pubkey;
  }

  if (message.includes("AccountNotInitialized") || message.includes("has not been initialized")) {
    return "one required Solana account is not initialized";
  }

  return null;
}
