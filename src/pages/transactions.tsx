import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  FileSpreadsheet,
  Paperclip,
  Pencil,
  Plus,
  Receipt,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Badge, EmptyState, InfoNote } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CategoryIcon } from "@/components/ui/category-icon";
import { Money } from "@/components/ui/money";
import { TransactionDialog } from "@/components/transactions/transaction-dialog";
import { useApp, useAppData } from "@/lib/app-context";
import { parseCsv, templateCsv, transactionsToCsv, type ImportRow } from "@/lib/csv";
import { fmtDate, lastNMonths, monthKey, parseISO, format, todayISO } from "@/lib/dates";
import { downloadBlob } from "@/lib/utils";
import type { Transaction, TxType } from "@/lib/types";

const PAGE_SIZE = 40;

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
  const { addTransactions, deleteTransaction } = useApp();
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

  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<TxType>("expense");
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ rows: ImportRow[]; headers: string[]; fatal?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  function openAdd(nextType: TxType) {
    setAddType(nextType);
    setAddOpen(true);
  }

  function handleFile(file?: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      toast.error("Choose a .csv file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
      setFileName(file.name);
      setParsed(parseCsv(text, categories, currency));
    };
    reader.onerror = () => toast.error("Could not read that file.");
    reader.readAsText(file);
  }

  function reviewPasted() {
    if (!csvText.trim()) {
      toast.error("Paste CSV rows or choose a file first.");
      return;
    }
    setParsed(parseCsv(csvText, categories, currency));
  }

  function resetImport() {
    setCsvText("");
    setFileName(null);
    setParsed(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function runImport() {
    if (!parsed) return;
    const valid = parsed.rows.filter((r) => !r.error);
    if (!valid.length) {
      toast.error("No valid rows to import", { description: "Fix the errors and try again." });
      return;
    }
    addTransactions(
      valid.map((r) => ({
        type: r.type,
        amount: r.amount,
        categoryId: r.categoryId,
        merchant: r.merchant,
        date: r.date,
        paymentMethod: r.paymentMethod,
        notes: r.notes,
        source: "import" as const,
      })),
    );
    toast.success(`${valid.length} transaction${valid.length === 1 ? "" : "s"} imported`, {
      description: parsed.rows.length - valid.length > 0 ? `${parsed.rows.length - valid.length} invalid rows were skipped.` : "Categories were guessed where missing.",
    });
    setImportOpen(false);
    resetImport();
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteTransaction(deleteTarget.id);
    toast.success("Transaction deleted");
    setDeleteTarget(null);
  }

  const validCount = parsed?.rows.filter((r) => !r.error).length ?? 0;
  const invalidCount = (parsed?.rows.length ?? 0) - validCount;

  return (
    <div>
      <PageHeader
        title="Transactions"
        description="Every rupee in and out, with receipt attachments and AI-assisted categories. Transfers are excluded from totals."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload /> Import
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
              <Download /> Export
            </Button>
            <Button size="sm" onClick={() => openAdd("expense")}>
              <Plus /> Add transaction
            </Button>
          </>
        }
      />

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
            title="No transactions yet"
            description="Add your first expense or income to unlock budgets, insights and your safe-to-spend number."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => openAdd("expense")}><Plus /> Add transaction</Button>
                <Button variant="outline" onClick={() => setImportOpen(true)}><Upload /> Import CSV</Button>
              </div>
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
                              {t.source === "paypal" && !t.transfer && <Badge variant="outline" className="px-1.5 py-0 text-[9.5px]">PayPal</Badge>}
                              {t.source === "autopay" && <Badge variant="outline" className="px-1.5 py-0 text-[9.5px]">Autopay</Badge>}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {t.notes || (t.receiptName ? "Receipt attached" : t.paymentMethod)}
                              {t.receiptName && <Paperclip className="ml-1 inline h-3 w-3" aria-label="Receipt attached" />}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cat?.color ?? "#64748b" }} aria-hidden />
                          {cat?.name ?? "Other"}
                        </span>
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
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditing(t)} aria-label={`Edit ${t.merchant}`}>
                            <Pencil />
                          </Button>
                          <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(t)} aria-label={`Delete ${t.merchant}`} className="hover:text-danger">
                            <Trash2 />
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
                          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{cat?.name ?? "Other"} · {fmtDate(t.date)}</p>
                        </div>
                        <span className={`tabular shrink-0 text-[14px] font-semibold ${t.type === "income" ? "text-success" : "text-foreground"}`}>
                          {t.type === "income" ? "+" : "−"}<Money value={t.amount} currency={currency} animate={false} />
                        </span>
                      </div>
                      {(t.notes || t.receiptName) && (
                        <p className="mt-1 line-clamp-1 text-[11.5px] text-muted-foreground">
                          {t.receiptName && <Paperclip className="mr-1 inline h-3 w-3" aria-hidden />}
                          {t.notes ?? "Receipt attached"}
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground">{t.paymentMethod}</span>
                        <div className="flex gap-0.5">
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditing(t)} aria-label={`Edit ${t.merchant}`}>
                            <Pencil />
                          </Button>
                          <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(t)} aria-label={`Delete ${t.merchant}`} className="hover:text-danger">
                            <Trash2 />
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
          Categories are suggested from merchant names and can always be changed. Imported rows with an unmatched category fall back to AI guessing.
        </InfoNote>
      </div>

      <TransactionDialog open={addOpen} onOpenChange={setAddOpen} defaultType={addType} />
      <TransactionDialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)} existing={editing} />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete transaction?</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  This will remove <strong className="text-foreground">{deleteTarget.merchant}</strong> for{" "}
                  <strong className="text-foreground"><Money value={deleteTarget.amount} currency={currency} animate={false} /></strong> on {fmtDate(deleteTarget.date, "d MMM yyyy")}. Budgets and insights recalculate immediately.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}><Trash2 /> Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) resetImport();
        }}
      >
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle>Import transactions from CSV</DialogTitle>
            <DialogDescription>
              Use columns for date, merchant and amount. Type, category, payment method and notes are matched when present. Amounts are read in {currency}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary"><FileSpreadsheet className="h-5 w-5" /></span>
                <div>
                  <p className="text-[13px] font-medium">{fileName ?? "Choose a .csv file"}</p>
                  <p className="text-[11.5px] text-muted-foreground">Or paste rows below. Nothing leaves your browser.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} aria-label="Choose CSV file" />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload /> Choose file</Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    downloadBlob("wallet-guardian-import-template.csv", templateCsv(currency));
                    toast.success("Template downloaded");
                  }}
                >
                  <Download /> Template
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="csv-paste">Paste CSV</Label>
              <Textarea
                id="csv-paste"
                value={csvText}
                onChange={(e) => {
                  setCsvText(e.target.value);
                  setParsed(null);
                }}
                placeholder={"date,merchant,amount,type,category,payment_method\n2026-11-01,Swiggy,420,expense,Food & Dining,UPI"}
                className="min-h-[110px] font-mono text-[12px]"
                spellCheck={false}
              />
            </div>

            <div className="flex justify-end">
              <Button type="button" variant="soft" size="sm" onClick={reviewPasted} disabled={!csvText.trim()}>Review rows</Button>
            </div>

            {parsed?.fatal && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-[12.5px] font-medium text-danger">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {parsed.fatal}
              </div>
            )}

            {parsed && !parsed.fatal && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <Badge variant="success">{validCount} ready</Badge>
                  {invalidCount > 0 && <Badge variant="danger">{invalidCount} with errors</Badge>}
                  <span className="text-muted-foreground">Detected columns: {parsed.headers.join(", ") || "none"}</span>
                </div>
                <div className="max-h-64 overflow-auto rounded-xl border border-border">
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 bg-muted/90 backdrop-blur">
                      <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
                        <th scope="col" className="px-3 py-2">Date</th>
                        <th scope="col" className="px-3 py-2">Merchant</th>
                        <th scope="col" className="px-3 py-2">Category</th>
                        <th scope="col" className="px-3 py-2 text-right">Amount</th>
                        <th scope="col" className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.rows.map((r) => (
                        <tr key={r.index} className={r.error ? "bg-danger-soft/40" : "border-t border-border/50"}>
                          <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{r.error ? "—" : fmtDate(r.date, "d MMM yyyy")}</td>
                          <td className="max-w-[160px] truncate px-3 py-2">{r.merchant || "—"}</td>
                          <td className="max-w-[130px] truncate px-3 py-2 text-muted-foreground">{r.categoryName}</td>
                          <td className={`tabular whitespace-nowrap px-3 py-2 text-right ${r.type === "income" ? "text-success" : ""}`}>
                            {r.type === "income" ? "+" : "−"}<Money value={r.amount} currency={currency} animate={false} />
                          </td>
                          <td className="px-3 py-2">
                            {r.error ? <span className="text-[11px] font-medium text-danger">{r.error}</span> : <span className="text-[11px] text-success">Ready</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {invalidCount > 0 && <p className="text-[11.5px] text-muted-foreground">Rows with errors are skipped. Fix them in your file and import again for the rest.</p>}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button onClick={runImport} disabled={!parsed || !!parsed.fatal || validCount === 0}>
              <Upload /> Import {validCount > 0 ? validCount : ""} row{validCount === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
