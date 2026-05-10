export interface HistoryTxType {
  label: string;
  color: string;
  icon: "down" | "up" | "open" | "close" | "ref" | "generic";
  amount?: number;
  symbol?: string;
  detail?: string;
}

export interface IndexedRecentTx {
  sig: string;
  slot: number;
  err: boolean;
  blockTime: number | null;
  memo: string | null;
  txType?: HistoryTxType;
}

export interface IndexedHistoryPosition {
  address: string;
  marketAddress: string;
  pairLabel: string;
  index: string;
  status: number;
  margin: number;
  openedAt: number;
  realizedPnl: number;
  hasEncryptedData: boolean;
}

export interface WalletHistorySnapshot {
  activity: IndexedRecentTx[];
  historyPositions: IndexedHistoryPosition[];
  historyPositionsSource: "current-scan";
  historyPositionsNotice?: string;
  nextBefore: string | null;
  hasMore: boolean;
  fetchedAt: number;
}

export interface WalletHistoryQuery {
  wallet: string;
  limit?: number;
  before?: string;
  includePositions?: boolean;
  accessToken?: string | null;
}

export function buildWalletHistoryQuery(query: WalletHistoryQuery): string {
  const params = new URLSearchParams();
  params.set("wallet", query.wallet);
  if (typeof query.limit === "number") params.set("limit", String(query.limit));
  if (query.before) params.set("before", query.before);
  if (query.includePositions) params.set("includePositions", "true");
  return params.toString();
}

export async function fetchWalletHistory(query: WalletHistoryQuery): Promise<WalletHistorySnapshot> {
  const response = await fetch(`/api/history?${buildWalletHistoryQuery(query)}`, {
    headers: query.accessToken ? { Authorization: `Bearer ${query.accessToken}` } : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `History API request failed (${response.status})`);
  }
  const payload = (await response.json()) as WalletHistorySnapshot & { ok?: boolean; error?: string };
  if (payload.ok === false) {
    throw new Error(payload.error || "History API request failed");
  }
  return payload;
}
