import { useMemo, useRef, useCallback } from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import DraggablePanel from "./DraggablePanel";
import { usePersistedLayout } from "./usePersistedLayout";
import {
  DEFAULT_LAYOUT,
  GRID_BREAKPOINTS,
  GRID_COLS,
  ROW_HEIGHT,
} from "./layoutConfig";
import type { TradingPair } from "../../lib/tokens";
import type { PanelVisibility } from "./SettingsPanel";

const ResponsiveGridLayout = WidthProvider(Responsive);

interface TerminalGridProps {
  selectedPair: TradingPair;
  marketSnapshot: any;
  chartComponent: React.ReactNode;
  orderbookComponent: React.ReactNode;
  tradingPanelComponent: React.ReactNode;
  positionsComponent: React.ReactNode;
  marketInfoComponent: React.ReactNode;
  panelVisibility?: PanelVisibility;
  layoutLocked?: boolean;
  onResetRef?: (reset: () => void) => void;
}

export default function TerminalGrid({
  chartComponent,
  orderbookComponent,
  tradingPanelComponent,
  positionsComponent,
  marketInfoComponent,
  panelVisibility = {},
  layoutLocked = false,
  onResetRef,
}: TerminalGridProps) {
  const { layouts, onLayoutChange, resetLayout } = usePersistedLayout();
  // Keep hidden panels' layout data so they restore correctly when toggled back on
  const hiddenLayoutsRef = useRef<Record<string, Layout>>({});

  if (onResetRef) onResetRef(resetLayout);

  const panelMap = useMemo(
    () => ({
      marketinfo: marketInfoComponent,
      chart: chartComponent,
      orderbook: orderbookComponent,
      trading: tradingPanelComponent,
      positions: positionsComponent,
    }),
    [marketInfoComponent, chartComponent, orderbookComponent, tradingPanelComponent, positionsComponent]
  );

  // Stash hidden panels' positions before filtering
  for (const item of layouts) {
    if (panelVisibility[item.i] === false) {
      hiddenLayoutsRef.current[item.i] = item;
    }
  }

  // Build visible layouts, restoring any panels that were just toggled back on
  const visibleLayouts = useMemo(() => {
    const visible = layouts.filter((item) => panelVisibility[item.i] !== false);
    const visibleKeys = new Set(visible.map((item) => item.i));

    // Re-add panels that are now visible but missing from current layouts
    for (const def of DEFAULT_LAYOUT) {
      if (panelVisibility[def.i] !== false && !visibleKeys.has(def.i)) {
        const stashed = hiddenLayoutsRef.current[def.i];
        visible.push(stashed ?? def);
        delete hiddenLayoutsRef.current[def.i];
      }
    }

    return visible;
  }, [layouts, panelVisibility]);

  // Only persist on actual user interaction (drag/resize), not on every render
  const handleInteractionEnd = useCallback(
    (newLayout: Layout[]) => {
      const hidden = Object.values(hiddenLayoutsRef.current);
      onLayoutChange([...newLayout, ...hidden]);
    },
    [onLayoutChange]
  );

  return (
    <div className={`terminal-grid-container flex-1 h-full${layoutLocked ? " layout-locked" : ""}`}>
      <ResponsiveGridLayout
        layouts={{ lg: visibleLayouts }}
        breakpoints={GRID_BREAKPOINTS}
        cols={GRID_COLS}
        rowHeight={ROW_HEIGHT}
        margin={[5, 5] as [number, number]}
        containerPadding={[5, 0] as [number, number]}
        draggableHandle=".drag-handle"
        onDragStop={(_layout: Layout[]) => handleInteractionEnd(_layout)}
        onResizeStop={(_layout: Layout[]) => handleInteractionEnd(_layout)}
        isResizable={!layoutLocked}
        isDraggable={!layoutLocked}
        compactType="vertical"
        useCSSTransforms={true}
        resizeHandles={["s", "w", "e", "n", "sw", "nw", "se", "ne"]}
      >
        {visibleLayouts.map((item) => {
          const content = panelMap[item.i as keyof typeof panelMap];
          if (!content) return null;
          return (
            <div key={item.i} style={item.i === "marketinfo" ? { overflow: "visible", zIndex: 10 } : undefined} className={item.i === "marketinfo" ? "border-b border-shadow-600" : undefined}>
              <DraggablePanel locked={layoutLocked} allowOverflow={item.i === "marketinfo"}>
                {content}
              </DraggablePanel>
            </div>
          );
        })}
      </ResponsiveGridLayout>
    </div>
  );
}
