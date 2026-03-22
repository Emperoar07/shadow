import { createContext, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "shadowperp-trading-settings";

export interface TradingSettings {
  // Order Confirmation
  confirmOpenOrder: boolean;
  confirmCloseOrder: boolean;
  confirmCancelAll: boolean;
  confirmChaseOrder: boolean;
  // Features
  hidePnl: boolean;
  animateOrderBook: boolean;
  showNotifications: boolean;
}

const DEFAULTS: TradingSettings = {
  confirmOpenOrder: true,
  confirmCloseOrder: true,
  confirmCancelAll: true,
  confirmChaseOrder: true,
  hidePnl: false,
  animateOrderBook: true,
  showNotifications: true,
};

function load(): TradingSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function save(s: TradingSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export interface TradingSettingsContext {
  settings: TradingSettings;
  update: (patch: Partial<TradingSettings>) => void;
  reset: () => void;
}

export function useTradingSettings(): TradingSettingsContext {
  const [settings, setSettings] = useState<TradingSettings>(DEFAULTS);

  useEffect(() => {
    setSettings(load());
  }, []);

  const update = useCallback((patch: Partial<TradingSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    save(DEFAULTS);
    setSettings(DEFAULTS);
  }, []);

  return { settings, update, reset };
}
