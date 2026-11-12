import type {
  Bill,
  FixedObligation,
  FlowExpense,
  FlowTab,
  FlowTabSource,
  PaymentChannel,
  Subscription,
  Transaction,
  TxType,
} from "./types";
import { uid } from "./utils";

export const FLOW_TABS: { key: FlowTab; label: string; hint: string }[] = [
  { key: "subscriptions", label: "Subscriptions", hint: "Streaming, apps and memberships" },
  { key: "bills", label: "Bills", hint: "Rent, utilities and household bills" },
  { key: "emis", label: "EMIs", hint: "Loans and monthly instalments" },
  { key: "autopay", label: "Autopay", hint: "Scheduled PayPal payouts you run yourself" },
  { key: "donations", label: "Donations", hint: "Giving and causes you support" },
  { key: "health", label: "Health", hint: "Insurance, clinics and medicines" },
  { key: "education", label: "Education", hint: "Fees, courses and lessons" },
  { key: "groceries", label: "Groceries", hint: "Regular grocery runs" },
  { key: "others", label: "Others", hint: "Anything that needs its own line" },
];

export const FLOW_TAB_LABEL: Record<FlowTab, string> = {
  subscriptions: "Subscriptions",
  bills: "Bills",
  emis: "EMIs",
  autopay: "Autopay",
  donations: "Donations",
  health: "Health",
  education: "Education",
  groceries: "Groceries",
  others: "Others",
};

export const CHANNEL_LABEL: Record<PaymentChannel, string> = {
  wallet_guardian: "In app",
  paypal: "PayPal",
  autopay: "Autopay",
  import: "Imported",
  sample: "Sample data",
};

export function channelForSource(source: Transaction["source"]): PaymentChannel {
  switch (source) {
    case "paypal":
      return "paypal";
    case "autopay":
      return "autopay";
    case "import":
      return "import";
    case "seed":
      return "sample";
    default:
      return "wallet_guardian";
  }
}

/** Maps onboarding obligation categories to the tab they appear under. */
export function flowTabForCategory(categoryId: string): FlowTab {
  return flowTabForBudgetCategory(categoryId) ?? "others";
}

/** Nullable variant: returns null for budget categories that are not money flows. */
export function flowTabForBudgetCategory(categoryId: string): FlowTab | null {
  switch (categoryId) {
    case "cat_subscriptions":
      return "subscriptions";
    case "cat_rent":
    case "cat_utilities":
      return "bills";
    case "cat_emi":
      return "emis";
    case "cat_health":
      return "health";
    case "cat_education":
      return "education";
    case "cat_groceries":
      return "groceries";
    default:
      return null;
  }
}

const DONATION_PATTERN = /donat|charity|ngo|temple|church|mosque|relief fund|give india/i;

/**
 * Suggests a money flow tab for an expense. Known flow categories resolve
 * directly; an unclassified payment is kept under Others but flagged as a
 * fallback so the UI can ask for the missing detail.
 */
export function guessFlowTab(
  merchant: string,
  categoryId: string,
  type: TxType,
): { tab: FlowTab; source: FlowTabSource } | null {
  if (type !== "expense") return null;
  const byCategory = flowTabForBudgetCategory(categoryId);
  if (byCategory) return { tab: byCategory, source: "auto" };
  if (DONATION_PATTERN.test(merchant)) return { tab: "donations", source: "auto" };
  if (categoryId === "cat_other" || !categoryId) return { tab: "others", source: "fallback" };
  return null;
}

/** Fills in channel and money flow metadata on a transaction without replacing explicit tags. */
export function enrichTransaction(tx: Transaction): Transaction {
  const channel = tx.channel ?? channelForSource(tx.source);
  if (tx.type === "income" || tx.transfer) {
    return channel === tx.channel ? tx : { ...tx, channel };
  }
  if (tx.flowTab) {
    return tx.channel ? tx : { ...tx, channel };
  }
  const guess = guessFlowTab(tx.merchant, tx.categoryId, tx.type);
  if (!guess) return tx.channel ? tx : { ...tx, channel };
  return { ...tx, channel, flowTab: guess.tab, flowTabSource: guess.source };
}

/** Enriches a list, returning the same array when nothing changed. */
export function enrichTransactions(txs: Transaction[]): Transaction[] {
  let changed = false;
  const next = txs.map((tx) => {
    const enriched = enrichTransaction(tx);
    if (enriched !== tx) changed = true;
    return enriched;
  });
  return changed ? next : txs;
}

/** Copies onboarding obligations into Money flows, skipping ones already linked. */
export function flowsFromObligations(
  obligations: FixedObligation[],
  existing: FlowExpense[] = [],
  createdAt = new Date().toISOString(),
): FlowExpense[] {
  const linked = new Set(existing.map((f) => f.obligationId).filter(Boolean));
  return obligations
    .filter((o) => o.name.trim() && o.amount > 0 && !linked.has(o.id))
    .map((o) => ({
      id: uid("flow"),
      name: o.name.trim(),
      amount: Math.round(o.amount),
      tab: flowTabForCategory(o.categoryId),
      status: "active",
      source: "onboarding",
      obligationId: o.id,
      createdAt,
    }));
}

/** Imports active subscriptions and unpaid bills into Money flows, skipping linked or duplicate rows. */
export function flowsFromLegacy(
  subscriptions: Subscription[],
  bills: Bill[],
  existing: FlowExpense[] = [],
  createdAt = new Date().toISOString(),
): FlowExpense[] {
  const linked = new Set(existing.map((f) => f.legacyId).filter(Boolean));
  const seen = new Set(existing.map(flowKey));
  const rows: FlowExpense[] = [];

  function importRow(name: string, amount: number, tab: FlowTab, legacyId: string, dueDate?: string) {
    if (seen.has(`${name.trim().toLowerCase()}|${Math.round(amount)}|${tab}`)) return;
    seen.add(`${name.trim().toLowerCase()}|${Math.round(amount)}|${tab}`);
    rows.push({
      id: uid("flow"),
      name,
      amount: Math.round(amount),
      tab,
      status: "active",
      source: "manual",
      legacyId,
      dueDate,
      createdAt,
    });
  }

  for (const sub of subscriptions) {
    if (sub.status !== "active" || linked.has(sub.id)) continue;
    importRow(sub.name, sub.cost, "subscriptions", sub.id, sub.nextBillingDate);
  }
  for (const bill of bills) {
    if (bill.status === "paid" || linked.has(bill.id)) continue;
    importRow(bill.title, bill.amount, bill.kind === "emi" ? "emis" : bill.kind === "ticket" ? "others" : "bills", bill.id, bill.dueDate);
  }
  return rows;
}

function flowKey(flow: FlowExpense) {
  return `${flow.name.trim().toLowerCase()}|${Math.round(flow.amount)}|${flow.tab}`;
}

/** Drops an imported row when an earlier flow already covers the same name, amount and tab. */
export function dedupeLegacyFlows(flows: FlowExpense[]): FlowExpense[] {
  const seen = new Set<string>();
  return flows.filter((flow) => {
    const key = flowKey(flow);
    if (flow.legacyId && seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Copies the legacy next-billing or due date onto imported rows that predate dueDate support. */
export function backfillLegacyDueDates(
  flows: FlowExpense[],
  subscriptions: Subscription[],
  bills: Bill[],
): FlowExpense[] {
  const subs = new Map(subscriptions.map((s) => [s.id, s]));
  const billsById = new Map(bills.map((b) => [b.id, b]));
  let changed = false;
  const next = flows.map((flow) => {
    if (flow.dueDate || !flow.legacyId) return flow;
    const date = subs.get(flow.legacyId)?.nextBillingDate ?? billsById.get(flow.legacyId)?.dueDate;
    if (!date) return flow;
    changed = true;
    return { ...flow, dueDate: date };
  });
  return changed ? next : flows;
}

/** Category label stored on the autopay schedule created from a tab. */
export function flowPayeeCategory(tab: FlowTab): string {
  switch (tab) {
    case "subscriptions":
      return "Subscriptions";
    case "bills":
      return "Utilities";
    case "emis":
      return "Loans";
    case "education":
      return "Education";
    case "health":
      return "Health";
    case "groceries":
      return "Food & Dining";
    case "donations":
      return "Family";
    default:
      return "Other";
  }
}
