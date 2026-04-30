import type { Layout } from "react-grid-layout";

export const STORAGE_KEY = "shadowperp-layout-v12";

export const GRID_COLS = { lg: 24 };
export const GRID_BREAKPOINTS = { lg: 1024 };
export const ROW_HEIGHT = 30;

export const DEFAULT_LAYOUT: Layout[] = [
  { i: "marketinfo", x: 0, y: 0, w: 24, h: 1.6, minW: 12, minH: 1.6, maxH: 6 },
  { i: "topmovers", x: 0, y: 1.6, w: 14, h: 1, minW: 8, minH: 1, maxH: 2 },
  { i: "chart", x: 0, y: 2.6, w: 14, h: 16, minW: 8, minH: 10 },
  { i: "orderbook", x: 14, y: 1.6, w: 5, h: 17, minW: 4, minH: 10 },
  { i: "trading", x: 19, y: 1.6, w: 5, h: 17, minW: 4, minH: 10 },
  { i: "positions", x: 0, y: 18.6, w: 24, h: 10, minW: 12, minH: 4 },
];

export const PANEL_TITLES: Record<string, string> = {
  marketinfo: "Market",
  topmovers: "Top Movers",
  chart: "Chart",
  orderbook: "Order Book",
  trading: "Trade",
  positions: "Positions",
};
