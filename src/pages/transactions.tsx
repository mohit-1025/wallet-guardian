import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Paperclip,
  Pencil,
  Receipt,
  Search,
  StickyNote,
  Tag,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Badge, EmptyState, InfoNote } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/form";
import { CategoryIcon } from "@/components/ui/category-icon";
import { Money } from "@/components/ui/money";
import { TransactionDialog } from "@/components/transactions/transaction-dialog";
import { useApp, useAppData } from "@/lib/app-context";
import { transactionsToCsv } from "@/lib/csv";
import { fmtDate, lastNMonths, monthKey, parseISO, format, todayISO } from "@/lib/dates";
import { CHANNEL_LABEL, FLOW_TAB_LABEL, channelForSource, guessFlowTab } from "@/lib/flows";
import { downloadBlob } from "@/lib/utils";
import type { Transaction, TxType } from "@/lib/types";

const PAGE_SIZE = 40;

function flowLabelFor(t: Transaction) {
  const tab = t.flowTab ?? guessFlowTab(t.merchant, t.categoryId, t.type)?.tab;
  return tab ? FLOW_TAB_LABEL[tab] : null;
}

function needsFlowInfo(t: Transaction) {
  if (t.transfer) return false;
  if (t.categoryId === "cat_other" || !t.categoryId) return true;
  return t.type === "expense" && t.flowTabSource === "fallback";
}

type Period = "month" | "last" | "3m" | "6m" | "year" | "all" | "custom";
type Sort = "new" | "old" | "high" | "low";

const PERIOD_LABEL: Record<Period, string> = {
  month: "This month",
  last: "Last month",
  "3m": "Last 3 months",
  "6m": "Last 6 months",
  year: "This year",
  all: "All time",
  custom: "Custom range",
};

const SORT_LABEL: Record<Sort, string> = {
  new: "Newest first",
  old: "Oldest first",
  high: "Highest amount",
  low: "Lowest amount",
};

export default function TransactionsPage() {
  const data = useAppData();
  const { session } = useApp();
  const currency = data.profile.currency;
  const categories = data.categories;

  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | TxType>("all");
  const [category, setCategory] = useState("all");
  const [period, setPeriod] = useState<Period>("3m");
  const [from, setFrom] = useState(() => `${monthKey()}-01`);
  const [to, setTo] = useState(todayISO());
  const [sort, setSort] = useState<Sort>("new");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const [editing, setEditing] = useState<Transaction | null>(null);
  const [dialogFields, setDialogFields] = useState<"info" | "note">("note");
  const [focusNotes, setFocusNotes] = useState(false);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const range = useMemo(() => {
    if (period === "custom") return { from: from || "0000-01-01", to: to || "9999-12-31" };
    if (period === "all") return { from: "0000-01-01", to: "9999-12-31" };
    if (period === "year") return { from: `${new Date().getFullYear()}-01-01`, to: "9999-12-31" };
    if (period === "month") {
      const key = monthKey();
      return { from: `${key}-01`, to: `${key}-31` };
    }
    if (period === "last") {
      const key = lastNMonths(2)[0];
      return { from: `${key}-01`, to: `${key}-31` };
    }
    const months = lastNMonths(period === "3m" ? 3 : 6);
    return { from: `${months[0]}-01`, to: `${months[months.length - 1]}-31` };
  }, [period, from, to]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data.transactions.filter((t) => {
      if (t.date < range.from || t.date > range.to) return false;
      if (type !== "all" && t.type !== type) return false;
      if (category !== "all" && t.categoryId !== category) return false;
      if (!q) return true;
      const cat = categoryById.get(t.categoryId)?.name ?? "";
      return (
        t.merchant.toLowerCase().includes(q) ||
        (t.notes ?? "").toLowerCase().includes(q) ||
        t.paymentMethod.toLowerCase().includes(q) ||
        cat.toLowerCase().includes(q)
      );
    });
    return [...list].sort((a, b) => {
      if (sort === "high") return b.amount - a.amount;
      if (sort === "low") return a.amount - b.amount;
      const dateCmp = a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date);
      return sort === "old" ? dateCmp : -dateCmp;
    });
  }, [data.transactions, range, type, category, search, sort, categoryById]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of filtered) {
      if (t.transfer) continue;
      if (t.type === "income") income += t.amount;
      else expense += t.amount;
    }
    return { income, expense, net: income - expense };
  }, [filtered]);

  const shown = filtered.slice(0, visible);
  const filtersActive = search.trim() !== "" || type !== "all" || category !== "all" || period !== "3m";

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [search, type, category, period, from, to, sort]);

  function clearFilters() {
    setSearch("");
    setType("all");
    setCategory("all");
    setPeriod("3m");
    setSort("new");
  }

  function exportCsv() {
    if (!filtered.length) return;
    downloadBlob(`wallet-guardian-transactions-${todayISO()}.csv`, transactionsToCsv(filtered, categories, currency));
    toast.success("CSV exported", { description: `${filtered.length} transactions in ${currency}.` });
  }

  function openInfo(t: Transaction) {
    setDialogFields("info");
    setFocusNotes(false);
    setEditing(t);
  }

  function openEdit(t: Transaction) {
    setDialogFields("note");
    setFocusNotes(false);
    setEditing(t);
  }

  function openNote(t: Transaction) {
    setDialogFields("note");
    setFocusNotes(true);
    setEditing(t);
  }

  return (
    <div>
      <PageHeader
        title="Transactions"
        description="Every payment in and out, registered the moment it happens and tagged with the category and money flow it belongs to. Transfers are excluded from totals."
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
            <Download /> Export
          </Button>
        }
      />

      {session?.provider === "demo" && (
        <div className="mb-4">
          <InfoNote icon={<Receipt />}>
            Sample workspace — these transactions are seeded. A signed-in account's top-ups, payments and autopay runs register here immediately.
          </InfoNote>
        </div>
      )}

      <div className="mb-4 grid grid-cols-3 gap-2 sm:mb-5 sm:gap-3">
        {[
          { label: "Money in", value: totals.income, icon: ArrowDownLeft, tone: "text-success", soft: "bg-success-soft text-success" },
          { label: "Money out", value: totals.expense, icon: ArrowUpRight, tone: "text-danger", soft: "bg-danger-soft text-danger" },
          { label: "Net", value: totals.net, icon: Receipt, tone: totals.net >= 0 ? "text-success" : "text-danger", soft: "bg-primary-soft text-primary" },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
          <Card key={stat.label} className="p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <span className={`hidden h-7 w-7 items-center justify-center rounded-lg sm:flex ${stat.soft}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <p className="text-[11px] font-medium text-muted-foreground sm:text-xs">{stat.label}</p>
            </div>
            <Money value={stat.value} currency={currency} signed={stat.label === "Net"} animate={false} className={`mt-2 block text-[15px] font-semibold tracking-tight sm:text-lg ${stat.tone}`} />
          </Card>
          );
        })}
      </div>

      <Card className="mb-4 p-3 sm:p-4">
        <div className="flex flex-col gap-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search merchant, category, note or method…"
              className="pl-10 pr-10"
              aria-label="Search transactions"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
            <Select value={type} onValueChange={(v) => setType(v as "all" | TxType)}>
              <SelectTrigger aria-label="Filter by type" className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
              </SelectContent>
            </Select>

            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger aria-label="Filter by category" className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger aria-label="Filter by period" className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
                  <SelectItem key={p} value={p}>{PERIOD_LABEL[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger aria-label="Sort transactions" className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
                  <SelectItem key={s} value={s}>{SORT_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!filtersActive} className="col-span-2 h-10 lg:col-span-1">
              Clear filters
            </Button>
          </div>

          {period === "custom" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="tx-filter-from" className="text-[11px] text-muted-foreground">From</Label>
                <Input id="tx-filter-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-10 text-[13px]" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tx-filter-to" className="text-[11px] text-muted-foreground">To</Label>
                <Input id="tx-filter-to" type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} className="h-10 text-[13px]" />
              </div>
            </div>
          )}

          <p className="text-[11.5px] text-muted-foreground" role="status">
            Showing {filtered.length} transaction{filtered.length === 1 ? "" : "s"} · totals ignore wallet transfers
          </p>
        </div>
      </Card>

      {data.transactions.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Receipt />}
            title="Waiting for transactions"
            description="Payments are fetched from your connected PayPal account — nothing has arrived yet. Check the connection in Wallet & PayPal, and new incoming or outgoing payments will appear here automatically."
            action={
              <Button variant="outline" asChild>
                <Link to="/app/wallet"><Receipt /> Open Wallet &amp; PayPal</Link>
              </Button>
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Search />}
            title="No matching transactions"
            description="Try a different search term, category or date range."
            action={<Button variant="outline" onClick={clearFilters}>Clear filters</Button>}
          />
        </Card>
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Filtered transactions</caption>
              <thead>
                <tr className="border-b border-border/70 bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-4 py-3">Transaction</th>
                  <th scope="col" className="px-3 py-3">Category</th>
                  <th scope="col" className="hidden px-3 py-3 lg:table-cell">Method</th>
                  <th scope="col" className="px-3 py-3">Date</th>
                  <th scope="col" className="px-3 py-3 text-right">Amount</th>
                  <th scope="col" className="px-4 py-3 text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => {
                  const cat = categoryById.get(t.categoryId);
                  const flow = flowLabelFor(t);
                  return (
                    <tr key={t.id} className="group border-b border-border/50 transition-colors last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                            style={{ backgroundColor: `${cat?.color ?? "#64748b"}14`, color: cat?.color ?? "#64748b" }}
                          >
                            <CategoryIcon name={cat?.icon} className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="truncate font-medium text-foreground">{t.merchant}</p>
                              {t.transfer && <Badge variant="outline" className="px-1.5 py-0 text-[9.5px]">Transfer</Badge>}
                              {!t.transfer && ["paypal", "autopay", "import"].includes(channelForSource(t.source)) && (
                                <Badge variant="outline" className="px-1.5 py-0 text-[9.5px]">{CHANNEL_LABEL[channelForSource(t.source)]}</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              {t.notes ? (
                                <span className="truncate">{t.notes}</span>
                              ) : (
                                <button type="button" onClick={() => openNote(t)} className="inline-flex items-center gap-1 text-[11px] hover:text-primary hover:underline">
                                  <StickyNote className="h-3 w-3" /> Add note
                                </button>
                              )}
                              {t.receiptName && <Paperclip className="h-3 w-3 shrink-0" aria-label="Receipt attached" />}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cat?.color ?? "#64748b" }} aria-hidden />
                            {cat?.name ?? "Other"}
                          </span>
                          {flow && !needsFlowInfo(t) && (
                            <span className="rounded-full bg-primary-soft/70 px-1.5 py-0.5 text-[9.5px] font-semibold text-accent-foreground">{flow}</span>
                          )}
                          {needsFlowInfo(t) && (
                            <button
                              type="button"
                              onClick={() => openInfo(t)}
                              className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-1.5 py-0.5 text-[9.5px] font-semibold text-warning hover:underline"
                            >
                              <Tag className="h-2.5 w-2.5" /> Add info
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="hidden px-3 py-3 text-[12.5px] text-muted-foreground lg:table-cell">{t.paymentMethod}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-[12.5px] text-muted-foreground">
                        <span className="block">{fmtDate(t.date, "d MMM yyyy")}</span>
                        <span className="text-[10.5px] opacity-70">{format(parseISO(t.date), "EEEE")}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <span className={`tabular text-[13.5px] font-semibold ${t.type === "income" ? "text-success" : "text-foreground"}`}>
                          {t.type === "income" ? "+" : "−"}
                          <Money value={t.amount} currency={currency} animate={false} />
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button variant="ghost" size="icon-sm" onClick={() => openEdit(t)} aria-label={`Edit ${t.merchant}`}>
                            <Pencil />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <ul className="space-y-2 md:hidden">
            {shown.map((t) => {
              const cat = categoryById.get(t.categoryId);
              const flow = flowLabelFor(t);
              return (
                <li key={t.id} className="rounded-2xl border border-border/80 bg-card p-3.5 shadow-soft">
                  <div className="flex items-start gap-3">
                    <span
                      className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                      style={{ backgroundColor: `${cat?.color ?? "#64748b"}14`, color: cat?.color ?? "#64748b" }}
                    >
                      <CategoryIcon name={cat?.icon} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1">
                            <p className="truncate text-[13.5px] font-semibold">{t.merchant}</p>
                            {t.transfer && <Badge variant="outline" className="px-1.5 py-0 text-[9px]">Transfer</Badge>}
                          </div>
                          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                            {cat?.name ?? "Other"}
                            {flow ? ` · ${flow}` : ""} · {fmtDate(t.date)}
                          </p>
                        </div>
                        <span className={`tabular shrink-0 text-[14px] font-semibold ${t.type === "income" ? "text-success" : "text-foreground"}`}>
                          {t.type === "income" ? "+" : "−"}<Money value={t.amount} currency={currency} animate={false} />
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                        {t.receiptName && <Paperclip className="h-3 w-3 shrink-0" aria-hidden />}
                        {t.notes ? (
                          <span className="line-clamp-1">{t.notes}</span>
                        ) : (
                          <button type="button" onClick={() => openNote(t)} className="inline-flex items-center gap-1 text-[11px] hover:text-primary">
                            <StickyNote className="h-3 w-3" /> Add note
                          </button>
                        )}
                      </div>
                      {needsFlowInfo(t) && (
                        <button
                          type="button"
                          onClick={() => openInfo(t)}
                          className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning"
                        >
                          <Tag className="h-3 w-3" /> Add info
                        </button>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground">
                          {t.paymentMethod}
                          {!t.transfer && channelForSource(t.source) !== "wallet_guardian" && channelForSource(t.source) !== "sample"
                            ? ` · ${CHANNEL_LABEL[channelForSource(t.source)]}`
                            : ""}
                        </span>
                        <div className="flex gap-0.5">
                          <Button variant="ghost" size="icon-sm" onClick={() => openEdit(t)} aria-label={`Edit ${t.merchant}`}>
                            <Pencil />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {visible < filtered.length && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                Load {Math.min(PAGE_SIZE, filtered.length - visible)} more
              </Button>
            </div>
          )}
        </>
      )}

      <div className="mt-5">
        <InfoNote icon={<Search />}>
          Each payment records where it was made and which money flow it belongs to. Payments with no match stay under Others in the smart budget; use Add info to pick a category and flow, and the expense moves there immediately. Notes are optional and private to this workspace.
        </InfoNote>
      </div>

      <TransactionDialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setFocusNotes(false);
          }
        }}
        existing={editing}
        fields={dialogFields}
        focusField={focusNotes ? "notes" : undefined}
      />

    </div>
  );
}
