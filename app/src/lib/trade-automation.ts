import { PositionDirection } from "../types";

export type PendingOrderStatus =
  | "pending"
  | "triggered"
  | "filled"
  | "failed"
  | "cancelled";

export interface PendingLimitOrder {
  id: string;
  pairLabel: string;
  side: PositionDirection;
  sizeBase: number;
  leverage: number;
  limitPrice: number;
  takeProfit: number | null;
  stopLoss: number | null;
  createdAt: number;
  updatedAt: number;
  status: PendingOrderStatus;
  txSignature?: string;
  positionAddress?: string;
  error?: string;
}

export interface PositionProtectionRule {
  positionAddress: string;
  pairLabel: string;
  side: PositionDirection;
  takeProfit: number | null;
  stopLoss: number | null;
  updatedAt: number;
}

export interface OwnerPositionView {
  positionAddress: string;
  pairLabel: string;
  side: PositionDirection;
  sizeBase: number;
  entryPrice: number;
  leverage: number;
  openedAt: number;
  updatedAt: number;
}

const UPDATE_EVENT = "shadowperp:automation-updated";
const STORAGE_KEY_PREFIX = "shadowperp:automation:v1:";
const ENVELOPE_VERSION = 1;
const KEY_DERIVATION_LABEL = "shadowperp-automation-key-v1";
const SIGN_MESSAGE_PREFIX = "ShadowPerp automation unlock";

interface AutomationSnapshot {
  limitOrders: PendingLimitOrder[];
  positionRules: Record<string, PositionProtectionRule>;
  ownerPositionViews: Record<string, OwnerPositionView>;
}

interface PersistedEnvelopeV1 {
  version: number;
  owner: string;
  savedAt: number;
  ivB64: string;
  cipherB64: string;
}

interface PersistenceState {
  owner: string | null;
  key: CryptoKey | null;
  readyPromise: Promise<void> | null;
  persistQueue: Promise<void>;
}

let limitOrdersState: PendingLimitOrder[] = [];
let positionRulesState: Record<string, PositionProtectionRule> = {};
let ownerPositionViewsState: Record<string, OwnerPositionView> = {};
const persistenceState: PersistenceState = {
  owner: null,
  key: null,
  readyPromise: null,
  persistQueue: Promise.resolve(),
};
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function canUseEncryptedStorage(): boolean {
  return hasWindow() && !!window.crypto?.subtle && !!window.localStorage;
}

function emitUpdate(): void {
  if (!hasWindow()) return;
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
}

function cloneLimitOrder(order: PendingLimitOrder): PendingLimitOrder {
  return {
    ...order,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = parseFiniteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function parseOptionalPositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return parsePositiveNumber(value);
}

function parseDirection(value: unknown): PositionDirection | null {
  if (value === "long" || value === "short") return value;
  return null;
}

function parseStatus(value: unknown): PendingOrderStatus | null {
  if (
    value === "pending" ||
    value === "triggered" ||
    value === "filled" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return null;
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeLimitOrder(value: unknown): PendingLimitOrder | null {
  if (!isRecord(value)) return null;
  const id = parseOptionalString(value.id);
  const pairLabel = parseOptionalString(value.pairLabel);
  const side = parseDirection(value.side);
  const sizeBase = parsePositiveNumber(value.sizeBase);
  const leverageRaw = parseFiniteNumber(value.leverage);
  const limitPrice = parsePositiveNumber(value.limitPrice);
  const status = parseStatus(value.status);
  const createdAt = parsePositiveNumber(value.createdAt);
  const updatedAt = parsePositiveNumber(value.updatedAt);

  if (
    !id ||
    !pairLabel ||
    !side ||
    sizeBase === null ||
    leverageRaw === null ||
    !Number.isInteger(leverageRaw) ||
    leverageRaw < 1 ||
    leverageRaw > 100 ||
    limitPrice === null ||
    !status ||
    createdAt === null ||
    updatedAt === null
  ) {
    return null;
  }

  return {
    id,
    pairLabel,
    side,
    sizeBase,
    leverage: leverageRaw,
    limitPrice,
    takeProfit: parseOptionalPositiveNumber(value.takeProfit),
    stopLoss: parseOptionalPositiveNumber(value.stopLoss),
    createdAt,
    updatedAt,
    status,
    txSignature: parseOptionalString(value.txSignature),
    positionAddress: parseOptionalString(value.positionAddress),
    error: parseOptionalString(value.error),
  };
}

function sanitizePositionRule(value: unknown): PositionProtectionRule | null {
  if (!isRecord(value)) return null;
  const positionAddress = parseOptionalString(value.positionAddress);
  const pairLabel = parseOptionalString(value.pairLabel);
  const side = parseDirection(value.side);
  const updatedAt = parsePositiveNumber(value.updatedAt);
  if (!positionAddress || !pairLabel || !side || updatedAt === null) return null;
  return {
    positionAddress,
    pairLabel,
    side,
    takeProfit: parseOptionalPositiveNumber(value.takeProfit),
    stopLoss: parseOptionalPositiveNumber(value.stopLoss),
    updatedAt,
  };
}

function sanitizeOwnerPositionView(value: unknown): OwnerPositionView | null {
  if (!isRecord(value)) return null;
  const positionAddress = parseOptionalString(value.positionAddress);
  const pairLabel = parseOptionalString(value.pairLabel);
  const side = parseDirection(value.side);
  const sizeBase = parsePositiveNumber(value.sizeBase);
  const entryPrice = parsePositiveNumber(value.entryPrice);
  const leverageRaw = parseFiniteNumber(value.leverage);
  const openedAt = parsePositiveNumber(value.openedAt);
  const updatedAt = parsePositiveNumber(value.updatedAt);

  if (
    !positionAddress ||
    !pairLabel ||
    !side ||
    sizeBase === null ||
    entryPrice === null ||
    leverageRaw === null ||
    !Number.isInteger(leverageRaw) ||
    leverageRaw < 1 ||
    leverageRaw > 100 ||
    openedAt === null ||
    updatedAt === null
  ) {
    return null;
  }

  return {
    positionAddress,
    pairLabel,
    side,
    sizeBase,
    entryPrice,
    leverage: leverageRaw,
    openedAt,
    updatedAt,
  };
}

function sanitizeSnapshot(value: unknown): AutomationSnapshot | null {
  if (!isRecord(value)) return null;

  const limitOrdersRaw = Array.isArray(value.limitOrders) ? value.limitOrders : [];
  const limitOrders = limitOrdersRaw
    .map((item) => sanitizeLimitOrder(item))
    .filter((item): item is PendingLimitOrder => item !== null);

  const positionRules: Record<string, PositionProtectionRule> = {};
  if (isRecord(value.positionRules)) {
    for (const [address, ruleRaw] of Object.entries(value.positionRules)) {
      const rule = sanitizePositionRule(ruleRaw);
      if (!rule) continue;
      positionRules[address] = rule;
    }
  }

  const ownerPositionViews: Record<string, OwnerPositionView> = {};
  if (isRecord(value.ownerPositionViews)) {
    for (const [address, viewRaw] of Object.entries(value.ownerPositionViews)) {
      const view = sanitizeOwnerPositionView(viewRaw);
      if (!view) continue;
      ownerPositionViews[address] = view;
    }
  }

  return {
    limitOrders,
    positionRules,
    ownerPositionViews,
  };
}

function sanitizeEnvelope(value: unknown): PersistedEnvelopeV1 | null {
  if (!isRecord(value)) return null;
  const version = parseFiniteNumber(value.version);
  const owner = parseOptionalString(value.owner);
  const savedAt = parsePositiveNumber(value.savedAt);
  const ivB64 = parseOptionalString(value.ivB64);
  const cipherB64 = parseOptionalString(value.cipherB64);
  if (
    version === null ||
    version !== ENVELOPE_VERSION ||
    !owner ||
    savedAt === null ||
    !ivB64 ||
    !cipherB64
  ) {
    return null;
  }
  return { version, owner, savedAt, ivB64, cipherB64 };
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function toBase64(data: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.subarray(i, Math.min(i + chunkSize, data.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function getStorageKey(owner: string): string {
  return `${STORAGE_KEY_PREFIX}${owner}`;
}

function getSnapshot(): AutomationSnapshot {
  return {
    limitOrders: getLimitOrders(),
    positionRules: getPositionRules(),
    ownerPositionViews: getOwnerPositionViews(),
  };
}

function setSnapshot(snapshot: AutomationSnapshot): void {
  limitOrdersState = snapshot.limitOrders.map((row) => cloneLimitOrder(row));
  positionRulesState = { ...snapshot.positionRules };
  ownerPositionViewsState = { ...snapshot.ownerPositionViews };
}

async function derivePersistenceKey(
  owner: string,
  signature: Uint8Array
): Promise<CryptoKey> {
  const material = concatBytes([
    textEncoder.encode(KEY_DERIVATION_LABEL),
    textEncoder.encode(owner),
    signature,
  ]);
  const digest = await window.crypto.subtle.digest("SHA-256", material);
  return window.crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function persistSnapshot(
  owner: string,
  key: CryptoKey,
  snapshot: AutomationSnapshot
): Promise<void> {
  if (!canUseEncryptedStorage()) return;
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = textEncoder.encode(
    JSON.stringify({
      owner,
      snapshot,
      savedAt: Date.now(),
    })
  );
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );
  const envelope: PersistedEnvelopeV1 = {
    version: ENVELOPE_VERSION,
    owner,
    savedAt: Date.now(),
    ivB64: toBase64(iv),
    cipherB64: toBase64(new Uint8Array(ciphertext)),
  };
  window.localStorage.setItem(getStorageKey(owner), JSON.stringify(envelope));
}

async function restoreSnapshot(
  owner: string,
  key: CryptoKey
): Promise<AutomationSnapshot | null> {
  if (!canUseEncryptedStorage()) return null;
  const raw = window.localStorage.getItem(getStorageKey(owner));
  if (!raw) return null;

  let parsedEnvelope: unknown;
  try {
    parsedEnvelope = JSON.parse(raw);
  } catch {
    return null;
  }

  const envelope = sanitizeEnvelope(parsedEnvelope);
  if (!envelope || envelope.owner !== owner) return null;

  try {
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(envelope.ivB64) },
      key,
      fromBase64(envelope.cipherB64)
    );
    const payloadRaw = JSON.parse(textDecoder.decode(new Uint8Array(decrypted)));
    if (!isRecord(payloadRaw) || payloadRaw.owner !== owner) return null;
    return sanitizeSnapshot(payloadRaw.snapshot);
  } catch {
    return null;
  }
}

function queuePersist(): void {
  if (!canUseEncryptedStorage()) return;
  if (!persistenceState.owner || !persistenceState.key) return;

  const owner = persistenceState.owner;
  const key = persistenceState.key;
  const snapshot = getSnapshot();

  persistenceState.persistQueue = persistenceState.persistQueue
    .then(() => persistSnapshot(owner, key, snapshot))
    .catch(() => undefined);
}

export function subscribeAutomationUpdates(onUpdate: () => void): () => void {
  if (!hasWindow()) return () => undefined;
  window.addEventListener(UPDATE_EVENT, onUpdate);
  return () => window.removeEventListener(UPDATE_EVENT, onUpdate);
}

export function createLimitOrderId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `lo_${Date.now()}_${random}`;
}

export function getLimitOrders(): PendingLimitOrder[] {
  return [...limitOrdersState]
    .map((row) => cloneLimitOrder(row))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function setLimitOrders(rows: PendingLimitOrder[]): void {
  limitOrdersState = rows.map((row) => cloneLimitOrder(row));
  queuePersist();
  emitUpdate();
}

export function upsertLimitOrder(row: PendingLimitOrder): void {
  const rows = getLimitOrders();
  const idx = rows.findIndex((item) => item.id === row.id);
  if (idx >= 0) {
    rows[idx] = cloneLimitOrder(row);
  } else {
    rows.push(cloneLimitOrder(row));
  }
  setLimitOrders(rows);
}

export function updateLimitOrder(
  orderId: string,
  patch: Partial<PendingLimitOrder>
): PendingLimitOrder | null {
  const rows = getLimitOrders();
  const idx = rows.findIndex((item) => item.id === orderId);
  if (idx < 0) return null;

  const next: PendingLimitOrder = {
    ...rows[idx],
    ...patch,
    updatedAt: Date.now(),
  };
  rows[idx] = next;
  setLimitOrders(rows);
  return cloneLimitOrder(next);
}

export function removeLimitOrder(orderId: string): void {
  const rows = getLimitOrders().filter((item) => item.id !== orderId);
  setLimitOrders(rows);
}

export function getPositionRules(): Record<string, PositionProtectionRule> {
  return { ...positionRulesState };
}

export function getPositionRule(positionAddress: string): PositionProtectionRule | null {
  const rules = getPositionRules();
  return rules[positionAddress] ?? null;
}

export function setPositionRule(rule: PositionProtectionRule): void {
  positionRulesState = {
    ...positionRulesState,
    [rule.positionAddress]: {
      ...rule,
      updatedAt: Date.now(),
    },
  };
  queuePersist();
  emitUpdate();
}

export function removePositionRule(positionAddress: string): void {
  if (!positionRulesState[positionAddress]) return;
  const next = { ...positionRulesState };
  delete next[positionAddress];
  positionRulesState = next;
  queuePersist();
  emitUpdate();
}

export function getOwnerPositionViews(): Record<string, OwnerPositionView> {
  return { ...ownerPositionViewsState };
}

export function getOwnerPositionView(positionAddress: string): OwnerPositionView | null {
  const views = getOwnerPositionViews();
  return views[positionAddress] ?? null;
}

export function setOwnerPositionView(
  payload: Omit<OwnerPositionView, "updatedAt" | "openedAt"> & { openedAt?: number }
): void {
  const existing = ownerPositionViewsState[payload.positionAddress];
  ownerPositionViewsState = {
    ...ownerPositionViewsState,
    [payload.positionAddress]: {
      ...payload,
      openedAt: payload.openedAt ?? existing?.openedAt ?? Date.now(),
      updatedAt: Date.now(),
    },
  };
  queuePersist();
  emitUpdate();
}

export function removeOwnerPositionView(positionAddress: string): void {
  if (!ownerPositionViewsState[positionAddress]) return;
  const next = { ...ownerPositionViewsState };
  delete next[positionAddress];
  ownerPositionViewsState = next;
  queuePersist();
  emitUpdate();
}

export function isEncryptedAutomationPersistenceEnabled(): boolean {
  return !!persistenceState.owner && !!persistenceState.key;
}

export async function enableEncryptedAutomationPersistence(params: {
  owner: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<boolean> {
  if (!canUseEncryptedStorage()) return false;
  const owner = params.owner.trim();
  if (!owner) return false;

  if (
    persistenceState.owner === owner &&
    persistenceState.key &&
    !persistenceState.readyPromise
  ) {
    return true;
  }

  if (persistenceState.owner === owner && persistenceState.readyPromise) {
    await persistenceState.readyPromise;
    return !!persistenceState.key;
  }

  if (persistenceState.owner && persistenceState.owner !== owner) {
    disableEncryptedAutomationPersistence();
  }

  const initPromise = (async () => {
    const origin = hasWindow() ? window.location.origin : "unknown-origin";
    const challenge = textEncoder.encode(
      `${SIGN_MESSAGE_PREFIX}\nwallet:${owner}\norigin:${origin}\nversion:${ENVELOPE_VERSION}`
    );
    const signature = await params.signMessage(challenge);
    if (!(signature instanceof Uint8Array) || signature.length === 0) {
      throw new Error("Wallet signature unavailable for encrypted persistence.");
    }

    const key = await derivePersistenceKey(owner, signature);
    persistenceState.owner = owner;
    persistenceState.key = key;

    const restored = await restoreSnapshot(owner, key);
    if (restored) {
      setSnapshot(restored);
      emitUpdate();
    } else {
      queuePersist();
    }
  })();

  persistenceState.readyPromise = initPromise.finally(() => {
    if (persistenceState.readyPromise === initPromise) {
      persistenceState.readyPromise = null;
    }
  });

  await initPromise;
  return true;
}

export function disableEncryptedAutomationPersistence(): void {
  persistenceState.owner = null;
  persistenceState.key = null;
  persistenceState.readyPromise = null;
  persistenceState.persistQueue = Promise.resolve();
}

export function clearEncryptedAutomationPersistence(owner: string): void {
  if (!canUseEncryptedStorage()) return;
  window.localStorage.removeItem(getStorageKey(owner));
}
