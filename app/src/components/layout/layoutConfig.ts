import type { Layout } from "react-grid-layout";

export const STORAGE_KEY = "shadowperp-layout-v8";

export const GRID_COLS = { lg: 24 };
export const GRID_BREAKPOINTS = { lg: 1024 };
export const ROW_HEIGHT = 60;

export const DEFAULT_LAYOUT: Layout[] = [
  { i: "marketinfo", x: 0, y: 0, w: 24, h: 1, minW: 12, minH: 1, maxH: 3 },
  { i: "chart", x: 0, y: 1, w: 14, h: 8, minW: 8, minH: 5 },
  { i: "orderbook", x: 14, y: 1, w: 5, h: 8, minW: 4, minH: 5 },
  { i: "trading", x: 19, y: 1, w: 5, h: 8, minW: 4, minH: 5 },
  { i: "positions", x: 0, y: 9, w: 24, h: 5, minW: 12, minH: 2 },
];

export const PANEL_TITLES: Record<string, string> = {
  marketinfo: "Market",
  chart: "Chart",
  orderbook: "Order Book",
  trading: "Trade",
  positions: "Positions",
};
