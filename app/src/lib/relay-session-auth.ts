export const RELAY_SESSION_AUTH_SCOPE = "shadowperp:relay-open:v1";

export interface RelaySessionAuthPayload {
  owner: string;
  market: string;
  sessionId: string;
  expiresAt: number;
}

export function buildRelaySessionAuthMessage(payload: RelaySessionAuthPayload): string {
  return [
    "ShadowPerp Delegated Session Authorization",
    `Scope: ${RELAY_SESSION_AUTH_SCOPE}`,
    `Owner: ${payload.owner}`,
    `Market: ${payload.market}`,
    `Session ID: ${payload.sessionId}`,
    `Expires At (unix): ${payload.expiresAt}`,
  ].join("\n");
}

export function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToUint8(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
