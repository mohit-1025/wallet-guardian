import Papa from "papaparse";
import type { Category, Currency, Transaction, TxType } from "./types";
import { convert, parseToInr } from "./money";
import { guessCategory } from "./categories";
import { todayISO } from "./dates";

export interface ImportRow {
  index: number;
  date: string;
  merchant: string;
  amount: number;
  type: TxType;
  categoryId: string;
  categoryName: string;
  paymentMethod: string;
  notes?: string;
  error?: string;
}

const HEADER_ALIASES: Record<string, string[]> = {
  date: ["date", "transaction date", "txn date", "when"],
  merchant: ["merchant", "description", "payee", "name", "narration", "details"],
  amount: ["amount", "value", "price", "debit", "credit"],
  type: ["type", "kind", "direction"],
  category: ["category", "cat"],
  paymentMethod: ["payment method", "method", "payment", "mode"],
  notes: ["notes", "note", "memo", "comment"],
};

function findHeader(headers: string[], field: keyof typeof HEADER_ALIASES) {
  const aliases = HEADER_ALIASES[field];
  return headers.find((h) => aliases.includes(h.trim().toLowerCase()));
}

export function normalizeDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

export function parseCsv(text: string, categories: Category[], currency: Currency): { rows: ImportRow[]; headers: string[]; fatal?: string } {
  const result = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  if (!result.data.length) return { rows: [], headers: [], fatal: "No data rows found in this file." };
  const headers = result.meta.fields ?? [];
  const mapping = {
    date: findHeader(headers, "date"),
    merchant: findHeader(headers, "merchant"),
    amount: findHeader(headers, "amount"),
    type: findHeader(headers, "type"),
    category: findHeader(headers, "category"),
    paymentMethod: findHeader(headers, "paymentMethod"),
    notes: findHeader(headers, "notes"),
  };
  if (!mapping.date || !mapping.merchant || !mapping.amount) {
    return { rows: [], headers, fatal: "CSV needs at least date, merchant/description and amount columns." };
  }
  const dateHeader = mapping.date;
  const merchantHeader = mapping.merchant;
  const amountHeader = mapping.amount;

  const rows = result.data.map<ImportRow>((row, index) => {
    const rawAmount = (row[amountHeader] ?? "").replace(/[^\d.-]/g, "");
    const numeric = Number(rawAmount);
    const date = normalizeDate(row[dateHeader] ?? "");
    const merchant = (row[merchantHeader] ?? "").trim();
    const rawType = (mapping.type ? row[mapping.type] : "")?.trim().toLowerCase() ?? "";
    const type: TxType = rawType.includes("inc") || rawType.includes("credit") || numeric > 0 && rawType === "credit" ? "income" : rawType.includes("exp") || rawType.includes("debit") ? "expense" : numeric < 0 ? "expense" : "expense";
    const categoryRaw = mapping.category ? row[mapping.category]?.trim() : "";
    const matched = categories.find((c) => c.name.toLowerCase() === categoryRaw?.toLowerCase() && c.kind === type);
    const guessed = guessCategory(merchant, type);
    const categoryId = matched?.id ?? guessed.categoryId;
    const paymentMethod = mapping.paymentMethod ? row[mapping.paymentMethod]?.trim() || "Other" : "Other";
    let error: string | undefined;
    if (!date) error = "Invalid or missing date";
    else if (!merchant) error = "Missing merchant";
    else if (!Number.isFinite(numeric) || numeric === 0) error = "Invalid amount";
    return {
      index,
      date: date ?? todayISO(),
      merchant,
      amount: Math.round(parseToInr(String(Math.abs(numeric)), currency)),
      type,
      categoryId,
      categoryName: categories.find((c) => c.id === categoryId)?.name ?? "Other",
      paymentMethod,
      notes: mapping.notes ? row[mapping.notes]?.trim() || undefined : undefined,
      error,
    };
  });

  return { rows, headers };
}

export function transactionsToCsv(txns: Transaction[], categories: Category[], currency: Currency): string {
  const rows = txns.map((t) => ({
    date: t.date,
    type: t.type,
    amount: Math.round(convert(t.amount, currency) * 100) / 100,
    currency,
    merchant: t.merchant,
    category: categories.find((c) => c.id === t.categoryId)?.name ?? "Other",
    payment_method: t.paymentMethod,
    notes: t.notes ?? "",
    source: t.source,
    paypal_order_id: t.paypalOrderId ?? "",
  }));
  return Papa.unparse(rows, {
    columns: ["date", "type", "amount", "currency", "merchant", "category", "payment_method", "notes", "source", "paypal_order_id"],
  });
}

export function templateCsv(currency: Currency) {
  return [
    `date,type,amount,currency,merchant,category,payment_method,notes`,
    `${todayISO()},expense,450,${currency},Swiggy,Food & Dining,UPI,Lunch`,
    `${todayISO()},income,5000,${currency},Acme Studio,Freelance,Bank transfer,Design retainer`,
  ].join("\n");
}
