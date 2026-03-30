import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Settings, RotateCcw, Lock, Unlock, Sun, Moon, Plus, Trash2 } from "lucide-react";
import type { TradingSettings } from "../../hooks/useTradingSettings";
import {
  getUserRpcConfig,
  setUserRpcConfig,
  getSavedRpcEndpoints,
  setSavedRpcEndpoints,
  type SavedRpcEndpoint,
  type UserRpcConfig,
  MAX_CUSTOM_ENDPOINTS,
} from "../../lib/runtime";

const PANEL_OPTIONS = [
  { key: "marketinfo", label: "Market Info" },
  { key: "chart", label: "Chart" },
  { key: "orderbook", label: "Orderbook" },
  { key: "trading", label: "Trading" },
  { key: "positions", label: "Positions" },
] as const;

const VISIBILITY_KEY = "shadowperp-panel-visibility";
const LAYOUT_LOCKED_KEY = "shadowperp-layout-locked";

export type PanelVisibility = Record<string, boolean>;

function loadVisibility(): PanelVisibility {
  try {
    const raw = localStorage.getItem(VISIBILITY_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveVisibility(v: PanelVisibility) {
  localStorage.setItem(VISIBILITY_KEY, JSON.stringify(v));
}

const TRADING_DEFAULTS: TradingSettings = {
  confirmOpenOrder: true,
  confirmCloseOrder: true,
  confirmCancelAll: true,
  confirmChaseOrder: true,
  hidePnl: false,
  animateOrderBook: true,
  showNotifications: true,
};

interface SettingsPanelProps {
  onResetLayout: () => void;
  onVisibilityChange: (visibility: PanelVisibility) => void;
  tradingSettings?: TradingSettings;
  onTradingSettingsChange: (patch: Partial<TradingSettings>) => void;
  onResetTradingSettings: () => void;
  layoutLocked?: boolean;
  onToggleLayoutLock?: () => void;
}

export function useVisibility() {
  const [visibility, setVisibility] = useState<PanelVisibility>({});

  useEffect(() => {
    setVisibility(loadVisibility());
  }, []);

  const update = useCallback((v: PanelVisibility) => {
    setVisibility(v);
    saveVisibility(v);
  }, []);

  const isVisible = useCallback(
    (key: string) => visibility[key] !== false,
    [visibility]
  );

  return { visibility, update, isVisible };
}

export function useLayoutLocked() {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    try {
      setLocked(localStorage.getItem(LAYOUT_LOCKED_KEY) === "true");
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    setLocked((prev) => {
      const next = !prev;
      localStorage.setItem(LAYOUT_LOCKED_KEY, String(next));
      return next;
    });
  }, []);

  return { locked, toggle };
}

function ThemeSwitch() {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    setIsLight(localStorage.getItem("shadow-theme") === "light");
  }, []);

  const toggle = () => {
    const nextLight = !isLight;
    if (nextLight) {
      document.documentElement.classList.add("light");
      localStorage.setItem("shadow-theme", "light");
    } else {
      document.documentElement.classList.remove("light");
      localStorage.setItem("shadow-theme", "dark");
    }
    setIsLight(nextLight);
  };

  return (
    <div className="flex items-center justify-between py-1.5 px-1">
      <span className="flex items-center gap-2 text-[12px] text-gray-300">
        {isLight ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        {isLight ? "Light Mode" : "Dark Mode"}
      </span>
      <Toggle checked={isLight} onChange={toggle} />
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
        checked ? "bg-accent-purple" : "bg-shadow-600"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex items-center gap-2 py-1.5 px-1 w-full text-left"
    >
      <span
        className={`flex items-center justify-center w-4 h-4 rounded shrink-0 transition-colors ${
          checked
            ? "bg-accent-purple text-white"
            : "border border-shadow-500 bg-shadow-700"
        }`}
      >
        {checked && (
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="text-[12px] text-gray-300">{label}</span>
    </button>
  );
}

export default function SettingsPanel({
  onResetLayout,
  onVisibilityChange,
  tradingSettings,
  onTradingSettingsChange,
  onResetTradingSettings,
  layoutLocked = false,
  onToggleLayoutLock,
}: SettingsPanelProps) {
  const ts = tradingSettings ?? TRADING_DEFAULTS;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"trading" | "layout" | "network">("trading");
  const [isDesktop, setIsDesktop] = useState(false);
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const { visibility, update, isVisible } = useVisibility();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (typeof window !== "undefined" && window.innerWidth < 640) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    const updateViewport = () => setIsDesktop(window.innerWidth >= 1024);
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    if (!isDesktop && tab === "layout") {
      setTab("trading");
    }
  }, [isDesktop, tab]);

  // RPC settings state
  const [activeId, setActiveId] = useState<string>("devnet");
  const [savedEndpoints, setSaved] = useState<SavedRpcEndpoint[]>([]);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [justConnected, setJustConnected] = useState<string | null>(null);

  useEffect(() => {
    setSaved(getSavedRpcEndpoints());
    const config = getUserRpcConfig();
    if (config) setActiveId(config.activeId);
  }, []);

  const handleConnect = (id: string) => {
    setUserRpcConfig({ activeId: id });
    setActiveId(id);
    setJustConnected(id);
    setTimeout(() => setJustConnected(null), 1500);
  };

  const handleAddEndpoint = () => {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name || !url) return;
    if (savedEndpoints.length >= MAX_CUSTOM_ENDPOINTS) return;
    const id = `custom_${Date.now()}`;
    const next = [...savedEndpoints, { id, name, url }];
    setSaved(next);
    setSavedRpcEndpoints(next);
    setNewName("");
    setNewUrl("");
  };

  const handleDelete = (id: string) => {
    const next = savedEndpoints.filter((e) => e.id !== id);
    setSaved(next);
    setSavedRpcEndpoints(next);
    if (activeId === id) handleConnect("devnet");
  };

  const togglePanel = (key: string) => {
    const next = { ...visibility, [key]: !isVisible(key) };
    update(next);
    onVisibilityChange(next);
  };

  const resetAll = () => {
    const empty: PanelVisibility = {};
    update(empty);
    onVisibilityChange(empty);
    onResetLayout();
    onResetTradingSettings();
    setOpen(false);
  };

  const availableTabs = (["trading", "layout", "network"] as const).filter(
    (nextTab) => isDesktop || nextTab !== "layout"
  );

  const panelContent = (
    <>
      <div className="flex border-b border-shadow-600">
        {availableTabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-2.5 text-[12px] font-semibold capitalize transition-colors ${
              tab === t
                ? "text-white border-b-2 border-accent-purple"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "trading" && (
        <div className="p-3">
          <p className="text-[11px] font-semibold text-gray-200 mb-2">
            Order Confirmation
          </p>
          <div className="flex flex-col gap-0">
            <Checkbox
              checked={ts.confirmOpenOrder}
              onChange={() => onTradingSettingsChange({ confirmOpenOrder: !ts.confirmOpenOrder })}
              label="Open Order"
            />
            <Checkbox
              checked={ts.confirmCloseOrder}
              onChange={() => onTradingSettingsChange({ confirmCloseOrder: !ts.confirmCloseOrder })}
              label="Close Order"
            />
            <Checkbox
              checked={ts.confirmCancelAll}
              onChange={() => onTradingSettingsChange({ confirmCancelAll: !ts.confirmCancelAll })}
              label="Cancel All Orders - Double Confirmation"
            />
            <Checkbox
              checked={ts.confirmChaseOrder}
              onChange={() => onTradingSettingsChange({ confirmChaseOrder: !ts.confirmChaseOrder })}
              label="Chase Order - Double Confirmation"
            />
          </div>

          <div className="border-t border-shadow-600 my-2" />

          <p className="text-[11px] font-semibold text-gray-200 mb-2">
            Features
          </p>
          <div className="flex flex-col gap-0">
            <Checkbox
              checked={ts.hidePnl}
              onChange={() => onTradingSettingsChange({ hidePnl: !ts.hidePnl })}
              label="Hide PNL"
            />
            <Checkbox
              checked={ts.animateOrderBook}
              onChange={() => onTradingSettingsChange({ animateOrderBook: !ts.animateOrderBook })}
              label="Animate Order Book"
            />
            <Checkbox
              checked={ts.showNotifications}
              onChange={() => onTradingSettingsChange({ showNotifications: !ts.showNotifications })}
              label="Show Notifications"
            />
          </div>

          <div className="border-t border-shadow-600 my-2" />

          <p className="text-[11px] font-semibold text-gray-200 mb-2">
            Theme
          </p>
          <ThemeSwitch />
        </div>
      )}

      {isDesktop && tab === "layout" && (
        <div className="p-3">
          <button
            type="button"
            onClick={onToggleLayoutLock}
            className={`flex items-center justify-between w-full py-2 px-2 mb-3 text-[12px] font-medium rounded transition-colors ${
              layoutLocked
                ? "bg-accent-purple/15 text-accent-purple border border-accent-purple/30"
                : "bg-shadow-700/50 text-gray-400 border border-shadow-500/50 hover:text-gray-200"
            }`}
          >
            <span className="flex items-center gap-2">
              {layoutLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              {layoutLocked ? "Layout Locked" : "Lock Layout"}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
              layoutLocked ? "bg-accent-purple/20 text-accent-purple" : "bg-shadow-600 text-gray-500"
            }`}>
              {layoutLocked ? "ON" : "OFF"}
            </span>
          </button>
          <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2 font-semibold">
            Panels
          </p>
          <div className="flex flex-col gap-1">
            {PANEL_OPTIONS.map(({ key, label }) => (
              <div
                key={key}
                className="flex items-center justify-between py-1.5 px-1"
              >
                <span className="text-[12px] text-gray-300">{label}</span>
                <Toggle
                  checked={isVisible(key)}
                  onChange={() => togglePanel(key)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "network" && (
        <div className="p-3">
          <p className="text-[11px] font-semibold text-gray-200 mb-2">RPC Endpoint</p>
          <div className="flex flex-col gap-1.5">
            {/* Default public devnet */}
            {[{ id: "devnet", name: "Solana Devnet", url: "https://api.devnet.solana.com" }, ...savedEndpoints].map(({ id, name }) => {
              const isActive = activeId === id;
              return (
                <div
                  key={id}
                  className={`flex items-center justify-between px-2.5 py-2 rounded text-[12px] border transition-colors ${
                    isActive ? "border-accent-purple/50 bg-accent-purple/10" : "border-shadow-600 bg-shadow-800/40"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-accent-green shrink-0" />}
                    <span className={`truncate ${isActive ? "text-white font-medium" : "text-gray-400"}`}>{name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {isActive ? (
                      <span className="text-[10px] text-accent-green font-medium">
                        {justConnected === id ? "Connected" : "Active"}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleConnect(id)}
                        className="text-[10px] font-medium text-accent-purple hover:text-white px-2 py-0.5 rounded border border-accent-purple/30 bg-accent-purple/10 hover:bg-accent-purple/20 transition-colors"
                      >
                        Connect
                      </button>
                    )}
                    {id !== "devnet" && (
                      <button
                        type="button"
                        onClick={() => handleDelete(id)}
                        className="text-gray-600 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Add new endpoint */}
            {savedEndpoints.length < MAX_CUSTOM_ENDPOINTS && (
              <div className="rounded border border-shadow-600 bg-shadow-800/40 px-2.5 py-2 flex flex-col gap-1.5 mt-1">
                <p className="text-[10px] text-gray-500 font-medium">Add Endpoint</p>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Name (e.g. QuickNode)"
                  className="w-full px-2 py-1.5 bg-shadow-800 border border-shadow-600 text-[11px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-purple/50 rounded"
                />
                <input
                  type="text"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://your-rpc-endpoint.com"
                  className="w-full px-2 py-1.5 bg-shadow-800 border border-shadow-600 text-[11px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-purple/50 rounded"
                />
                <button
                  type="button"
                  onClick={handleAddEndpoint}
                  disabled={!newName.trim() || !newUrl.trim()}
                  className="flex items-center justify-center gap-1 w-full py-1 text-[10px] font-medium text-accent-purple border border-accent-purple/30 bg-accent-purple/10 hover:bg-accent-purple/20 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3 h-3" />
                  Save & Connect
                </button>
              </div>
            )}
            {savedEndpoints.length >= MAX_CUSTOM_ENDPOINTS && (
              <p className="text-[10px] text-gray-500 text-center py-1">Max {MAX_CUSTOM_ENDPOINTS} endpoints saved</p>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-shadow-600 p-2 flex justify-end">
        <button
          type="button"
          onClick={resetAll}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-accent-purple hover:text-accent-purple/80 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          Reset all
        </button>
      </div>
    </>
  );

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="trade-header-control inline-flex items-center justify-center border border-shadow-500/50 bg-shadow-800/80 w-8 h-8 text-gray-400 transition-all hover:text-gray-200 hover:border-shadow-400/60 hover:bg-shadow-700/80"
        title="Settings"
      >
        <Settings className="w-4 h-4" />
      </button>

      {open && (
        <>
          <div className="trade-header-popover absolute right-0 top-full mt-2 hidden w-72 border border-shadow-500 bg-shadow-900 shadow-2xl z-[400] sm:block">
            {panelContent}
          </div>
          {mounted && createPortal(
            <div
              className="fixed inset-0 z-[450] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm sm:hidden"
              onClick={() => setOpen(false)}
            >
              <div
                className="w-full max-w-sm overflow-hidden rounded-2xl border border-shadow-500 bg-shadow-900 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                {panelContent}
              </div>
            </div>,
            document.body
          )}
        </>
      )}
    </div>
  );
}
