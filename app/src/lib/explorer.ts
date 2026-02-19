function resolveClusterQuery(): string {
  const explicitCluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim().toLowerCase();
  if (explicitCluster === "devnet" || explicitCluster === "testnet") {
    return `?cluster=${explicitCluster}`;
  }
  if (explicitCluster === "mainnet-beta") {
    return "";
  }

  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.toLowerCase() ?? "";
  if (rpcUrl.includes("devnet")) return "?cluster=devnet";
  if (rpcUrl.includes("testnet")) return "?cluster=testnet";
  return "";
}

export function getExplorerTxUrl(signature: string): string {
  const clusterQuery = resolveClusterQuery();
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${clusterQuery}`;
}
