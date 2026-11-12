import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type QuickAddType = "expense" | "income";

interface UIContextValue {
  quickAddOpen: boolean;
  quickAddType: QuickAddType;
  openQuickAdd: (type?: QuickAddType) => void;
  closeQuickAdd: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddType, setQuickAddType] = useState<QuickAddType>("expense");
  const [paletteOpen, setPaletteOpen] = useState(false);

  const openQuickAdd = useCallback((type: QuickAddType = "expense") => {
    setQuickAddType(type);
    setQuickAddOpen(true);
  }, []);
  const closeQuickAdd = useCallback(() => setQuickAddOpen(false), []);

  const value = useMemo(
    () => ({ quickAddOpen, quickAddType, openQuickAdd, closeQuickAdd, paletteOpen, setPaletteOpen }),
    [quickAddOpen, quickAddType, openQuickAdd, closeQuickAdd, paletteOpen],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used inside UIProvider");
  return ctx;
}
