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
  nextBefore: string | null;
  hasMore: boolean;
  fetchedAt: number;
}

export interface WalletHistoryQuery {
  wallet: string;
  limit?: number;
  before?: string;
  includePositions?: boolean;
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
  const response = await fetch(`/api/history?${buildWalletHistoryQuery(query)}`);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `History API request failed (${response.status})`);
  }
  return (await response.json()) as WalletHistorySnapshot;
}
