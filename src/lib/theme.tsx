import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getTheme, saveTheme, type Theme } from "./storage";

interface ThemeContextValue {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemDark() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  const [system, setSystem] = useState(systemDark);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: "light" | "dark" = theme === "system" ? (system ? "dark" : "light") : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", resolved === "dark" ? "#0b1020" : "#f7f7fc");
  }, [resolved]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    saveTheme(t);
  };

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolved,
      setTheme,
      toggle: () => setTheme(resolved === "dark" ? "light" : "dark"),
    }),
    [theme, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
