import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";
import type { Currency } from "@/lib/types";
import { cn } from "@/lib/utils";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function useAnimatedNumber(value: number, duration = 750) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    cancelAnimationFrame(frameRef.current);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (value - from) * eased;
      setDisplay(current);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, duration, reduced]);

  return display;
}

export function Money({
  value,
  currency = "INR",
  compact = false,
  signed = false,
  decimals,
  className,
  animate = true,
  hideSymbol = false,
}: {
  value: number;
  currency?: Currency;
  compact?: boolean;
  signed?: boolean;
  decimals?: boolean;
  className?: string;
  animate?: boolean;
  hideSymbol?: boolean;
}) {
  const display = useAnimatedNumber(animate ? value : 0);
  const shown = animate ? display : value;
  return (
    <span className={cn("tabular", className)}>
      {formatMoney(signed ? value : shown, currency, { compact, signed, decimals, hideSymbol })}
    </span>
  );
}

export function MoneyInput({
  value,
  currency,
  onChange,
  placeholder = "0",
  className,
  id,
}: {
  value: string;
  currency: Currency;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  const symbols: Record<Currency, string> = { INR: "₹", USD: "$", EUR: "€" };
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
        {symbols[currency]}
      </span>
      <input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
          onChange(v);
        }}
        placeholder={placeholder}
        className={cn(
          "tabular h-11 w-full rounded-xl border border-input bg-card pl-8 pr-12 text-sm font-semibold text-foreground shadow-sm transition-colors placeholder:font-normal placeholder:text-muted-foreground/60 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
          className,
        )}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium uppercase text-muted-foreground">
        {currency}
      </span>
    </div>
  );
}
