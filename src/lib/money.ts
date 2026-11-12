import type { Currency } from "./types";

// Indicative rates used only for display; all records are stored in INR.
export const FX: Record<Currency, number> = {
  INR: 1,
  USD: 1 / 83.2,
  EUR: 1 / 90.4,
};

export const CURRENCY_META: Record<Currency, { symbol: string; label: string; locale: string }> = {
  INR: { symbol: "₹", label: "Indian Rupee", locale: "en-IN" },
  USD: { symbol: "$", label: "US Dollar", locale: "en-US" },
  EUR: { symbol: "€", label: "Euro", locale: "de-DE" },
};

export function convert(amountInr: number, currency: Currency) {
  return amountInr * FX[currency];
}

export function formatMoney(
  amountInr: number,
  currency: Currency = "INR",
  opts: { compact?: boolean; decimals?: boolean; signed?: boolean; hideSymbol?: boolean } = {},
) {
  const value = convert(amountInr, currency);
  const decimals = opts.decimals ?? currency !== "INR";
  const abs = Math.abs(value);
  const formatter = new Intl.NumberFormat(CURRENCY_META[currency].locale, {
    style: opts.hideSymbol ? "decimal" : "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    notation: opts.compact && abs >= 100_000 ? "compact" : "standard",
    minimumFractionDigits: opts.compact ? 0 : decimals ? 2 : 0,
    maximumFractionDigits: opts.compact ? 1 : decimals ? 2 : 0,
  });
  const formatted = formatter.format(abs);
  if (opts.signed) return `${value < 0 ? "−" : "+"}${formatted}`;
  return value < 0 ? `−${formatted}` : formatted;
}

export function formatAmountInput(amountInr: number, currency: Currency) {
  const v = convert(amountInr, currency);
  return String(Math.round(v * 100) / 100);
}

export function parseToInr(input: string, currency: Currency) {
  const n = Number(input.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n / FX[currency]);
}

export function formatPct(n: number, decimals = 0) {
  return `${n >= 0 ? "" : "−"}${Math.abs(n).toFixed(decimals)}%`;
}

export function formatCompact(n: number, currency: Currency = "INR") {
  return formatMoney(n, currency, { compact: true });
}

export function usdFromInr(amountInr: number) {
  return Math.round(amountInr * FX.USD * 100) / 100;
}
