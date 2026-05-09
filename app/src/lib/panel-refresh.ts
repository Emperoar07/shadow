export const PANEL_REFRESH_EVENT = "shadowperp:panel-refresh";

export function requestPanelRefresh(reason?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PANEL_REFRESH_EVENT, { detail: { reason } }));
}

export function subscribePanelRefresh(handler: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(PANEL_REFRESH_EVENT, handler);
  return () => window.removeEventListener(PANEL_REFRESH_EVENT, handler);
}
