/**
 * Error message substrings that indicate a relay session is no longer valid.
 * Used by both useArcium relay calls and CollateralModal delegated collateral.
 */
export const SESSION_INVALID_PATTERNS: readonly string[] = [
  "Invalid session authorization signature",
  "Session authorization expired",
  "Authorization expiry exceeds session expiry",
  "Authorization action mismatch",
  "session has expired or was not created",
  "Session revoked",
  "session is revoked",
  "Account does not exist",
  "could not find account",
];

/** Check if an error message indicates an invalid/revoked session. */
export function isSessionInvalidError(message: string): boolean {
  return SESSION_INVALID_PATTERNS.some((p) => message.includes(p));
}
