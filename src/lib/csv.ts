import Papa from "papaparse";
import type { Category, Currency, Transaction } from "./types";
import { convert } from "./money";

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
    money_flow: t.flowTab ?? "",
    source: t.source,
    paypal_order_id: t.paypalOrderId ?? "",
  }));
  return Papa.unparse(rows, {
    columns: ["date", "type", "amount", "currency", "merchant", "category", "payment_method", "notes", "money_flow", "source", "paypal_order_id"],
  });
}
