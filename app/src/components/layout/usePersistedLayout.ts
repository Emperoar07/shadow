import { useCallback, useEffect, useRef, useState } from "react";
import type { Layout } from "react-grid-layout";
import { DEFAULT_LAYOUT, STORAGE_KEY } from "./layoutConfig";

function loadLayout(): Layout[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    if (!parsed.every((item: any) => item.i && typeof item.x === "number")) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLayout(layout: Layout[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

export function usePersistedLayout() {
  const [layouts, setLayouts] = useState<Layout[]>(DEFAULT_LAYOUT);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const saved = loadLayout();
    if (saved) setLayouts(saved);
  }, []);

  const onLayoutChange = useCallback((newLayout: Layout[]) => {
    setLayouts(newLayout);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => saveLayout(newLayout), 300);
  }, []);

  const resetLayout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setLayouts(DEFAULT_LAYOUT);
  }, []);

  return { layouts, onLayoutChange, resetLayout };
}
