import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface UIContextValue {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const value = useMemo(() => ({ paletteOpen, setPaletteOpen }), [paletteOpen]);

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used inside UIProvider");
  return ctx;
}
