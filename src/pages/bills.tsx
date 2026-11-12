import { useMemo, useState } from "react";
import {
  CalendarDays, ChevronLeft, ChevronRight, Landmark, Pencil, Plus, ReceiptText, Repeat,
  Ticket, Trash2, Undo2, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Badge, EmptyState, InfoNote } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money, MoneyInput } from "@/components/ui/money";
import { useApp, useAppData } from "@/lib/app-context";
import { billStatus } from "@/lib/finance";
import {
  daysUntil, fmtDate, format, monthDays, monthKey, monthLabel, nextMonthKey, parseISO,
  previousMonthKey, relativeDue, todayISO,
} from "@/lib/dates";
import { formatAmountInput, formatMoney, parseToInr } from "@/lib/money";
import type { Bill } from "@/lib/types";
import { cn } from "@/lib/utils";

type BillFilter = "all" | "upcoming" | "due" | "overdue" | "paid";

const STATUS_META = {
  upcoming: { label: "Upcoming", badge: "secondary" as const, dot: "bg-indigo-500", chip: "bg-primary-soft/70 text-accent-foreground" },
  due: { label: "Due soon", badge: "warning" as const, dot: "bg-amber-500", chip: "bg-warning-soft text-warning" },
  overdue: { label: "Overdue", badge: "danger" as const, dot: "bg-rose-500", chip: "bg-danger-soft text-danger" },
  paid: { label: "Paid", badge: "success" as const, dot: "bg-emerald-500", chip: "bg-success-soft/70 text-success" },
};

const KIND_META = {
  bill: { label: "Bill", icon: ReceiptText },
  emi: { label: "EMI", icon: Landmark },
  ticket: { label: "Ticket", icon: Ticket },
};

const FILTER_LABEL: Record<BillFilter, string> = {
  all: "All bills",
  upcoming: "Upcoming",
  due: "Due soon",
  overdue: "Overdue",
  paid: "Paid",
};

export default function BillsPage() {
  const data = useAppData();
  const { addBill, updateBill, deleteBill, markBillPaid } = useApp();
  const currency = data.profile.currency;

  const [month, setMonth] = useState(() => monthKey());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [filter, setFilter] = useState<BillFilter>("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Bill | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Bill["kind"]>("bill");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(todayISO());
  const [autopay, setAutopay] = useState(false);

  const [payTarget, setPayTarget] = useState<Bill | null>(null);
  const [recordExpense, setRecordExpense] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Bill | null>(null);

  const monthBills = useMemo(() => data.bills.filter((b) => b.dueDate.startsWith(month)), [data.bills, month]);

  const summary = useMemo(() => {
    let monthDue = 0;
    let monthDueCount = 0;
    let overdue = 0;
    let overdueCount = 0;
    let paidMonth = 0;
    let paidCount = 0;
    let autopayTotal = 0;
    let autopayCount = 0;
    for (const b of data.bills) {
      const status = billStatus(b);
      if (status === "paid") {
        if (b.dueDate.startsWith(month) || (b.paidAt ?? "").startsWith(month)) {
          paidMonth += b.amount;
          paidCount += 1;
        }
        continue;
      }
      if (status === "overdue") {
        overdue += b.amount;
        overdueCount += 1;
      }
      if (b.dueDate.startsWith(month)) {
        monthDue += b.amount;
        monthDueCount += 1;
      }
      if (b.autopay) {
        autopayTotal += b.amount;
        autopayCount += 1;
      }
    }
    return { monthDue, monthDueCount, overdue, overdueCount, paidMonth, paidCount, autopayTotal, autopayCount };
  }, [data.bills, month]);

  const calendar = useMemo(() => {
    const days = monthDays(month);
    const pad = (parseISO(`${month}-01`).getDay() + 6) % 7;
    const cells: (Date | null)[] = [...Array.from({ length: pad }, () => null), ...days];
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [month]);

  const list = useMemo(() => {
    let rows = [...data.bills];
    if (selectedDate) rows = rows.filter((b) => b.dueDate === selectedDate);
    if (filter !== "all") rows = rows.filter((b) => (filter === "paid" ? b.status === "paid" : billStatus(b) === filter));
    return rows.sort((a, b) => {
      const aPaid = a.status === "paid";
      const bPaid = b.status === "paid";
      if (aPaid !== bPaid) return aPaid ? 1 : -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  }, [data.bills, selectedDate, filter]);

  function shiftMonth(delta: number) {
    setMonth(delta < 0 ? previousMonthKey(month) : nextMonthKey(month));
    setSelectedDate(null);
  }

  function openAdd() {
    setEditing(null);
    setTitle("");
    setKind("bill");
    setAmount("");
    setDueDate(todayISO());
    setAutopay(false);
    setFormOpen(true);
  }

  function openEdit(bill: Bill) {
    setEditing(bill);
    setTitle(bill.title);
    setKind(bill.kind);
    setAmount(formatAmountInput(bill.amount, currency));
    setDueDate(bill.dueDate);
    setAutopay(Boolean(bill.autopay));
    setFormOpen(true);
  }

  function save() {
    const amt = parseToInr(amount, currency);
    if (!title.trim()) {
      toast.error("Give the bill a title.");
      return;
    }
    if (amt <= 0) {
      toast.error("Enter an amount above zero.");
      return;
    }
    if (!dueDate) {
      toast.error("Choose a due date.");
      return;
    }
    if (editing) {
      updateBill(editing.id, { title: title.trim(), kind, amount: amt, dueDate, autopay });
      toast.success("Bill updated");
    } else {
      addBill({ title: title.trim(), kind, amount: amt, dueDate, autopay, status: "upcoming" });
      toast.success("Bill added", { description: `${formatMoney(amt, currency)} due ${fmtDate(dueDate, "d MMM")}.` });
    }
    setFormOpen(false);
  }

  function openPay(bill: Bill) {
    setPayTarget(bill);
    setRecordExpense(true);
  }

  function confirmPay() {
    if (!payTarget) return;
    markBillPaid(payTarget.id, recordExpense);
    toast.success(`${payTarget.title} marked paid`, {
      description: recordExpense ? "An expense was added to your transactions." : "No transaction was recorded.",
    });
    setPayTarget(null);
  }

  function markUnpaid(bill: Bill) {
    updateBill(bill.id, { status: "upcoming", paidAt: undefined });
    toast.success(`${bill.title} moved back to unpaid`);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteBill(deleteTarget.id);
    toast.success("Bill deleted");
    setDeleteTarget(null);
  }

  const hasAny = data.bills.length > 0;

  return (
    <div>
      <PageHeader
        title="Bills & tickets"
        description="What's due, what's overdue and what autopay will handle. Mark a bill paid and optionally record it as an expense."
        actions={<Button size="sm" onClick={openAdd}><Plus /> Add bill</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {[
          { label: "Due this month", value: summary.monthDue, sub: `${summary.monthDueCount} open`, tone: "text-foreground" },
          { label: "Overdue", value: summary.overdue, sub: `${summary.overdueCount} need attention`, tone: summary.overdue ? "text-danger" : "text-foreground" },
          { label: "Paid this month", value: summary.paidMonth, sub: `${summary.paidCount} cleared`, tone: "text-success" },
          { label: "On autopay", value: summary.autopayTotal, sub: `${summary.autopayCount} scheduled`, tone: "text-foreground" },
        ].map((stat) => (
          <Card key={stat.label} className="p-3.5 sm:p-4">
            <p className="text-[11px] font-medium text-muted-foreground sm:text-xs">{stat.label}</p>
            <p className={cn("mt-1 text-lg font-semibold tracking-tight tabular sm:text-xl", stat.tone)}>
              <Money value={stat.value} currency={currency} />
            </p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">{stat.sub}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>{monthLabel(month)}</CardTitle>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">Click a day to filter the list below</p>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" onClick={() => { setMonth(monthKey()); setSelectedDate(null); }}>Today</Button>
              <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-1 text-center">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <div key={`${d}-${i}`} className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{d}</div>
              ))}
              {calendar.map((day, idx) => {
                if (!day) return <div key={`pad-${idx}`} className="min-h-[72px] rounded-lg bg-muted/20 sm:min-h-[88px]" />;
                const iso = format(day, "yyyy-MM-dd");
                const dayBills = data.bills.filter((b) => b.dueDate === iso);
                const isToday = iso === todayISO();
                const isSelected = iso === selectedDate;
                const unpaidTotal = dayBills.filter((b) => b.status !== "paid").reduce((s, b) => s + b.amount, 0);
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => setSelectedDate(isSelected ? null : iso)}
                    aria-label={`${fmtDate(iso, "d MMMM")}${dayBills.length ? `, ${dayBills.length} bill${dayBills.length === 1 ? "" : "s"}` : ", no bills"}`}
                    aria-pressed={isSelected}
                    className={cn(
                      "min-h-[72px] rounded-lg border p-1 text-left transition-colors sm:min-h-[88px] sm:p-1.5",
                      isSelected ? "border-primary/60 bg-primary-soft/40 ring-2 ring-primary/20" : "border-border/50 hover:border-primary/30 hover:bg-muted/30",
                    )}
                  >
                    <span className={cn(
                      "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10.5px] font-semibold tabular",
                      isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                    )}>
                      {day.getDate()}
                    </span>
                    <span className="mt-0.5 hidden flex-col gap-0.5 sm:flex">
                      {dayBills.slice(0, 2).map((b) => {
                        const meta = STATUS_META[billStatus(b)];
                        return (
                          <span key={b.id} className={cn("truncate rounded px-1 py-0.5 text-[9px] font-medium leading-tight", meta.chip)}>
                            {b.title}
                          </span>
                        );
                      })}
                      {dayBills.length > 2 && <span className="px-1 text-[9px] text-muted-foreground">+{dayBills.length - 2} more</span>}
                    </span>
                    <span className="mt-1 flex items-center gap-1 sm:hidden">
                      {dayBills.length > 0 && <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_META[billStatus(dayBills[0])].dot)} />}
                      {dayBills.length > 1 && <span className="text-[9px] text-muted-foreground">+{dayBills.length - 1}</span>}
                    </span>
                    {unpaidTotal > 0 && <span className="mt-0.5 block truncate text-[9px] font-semibold tabular text-foreground/80">{formatMoney(unpaidTotal, currency, { compact: true })}</span>}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[10.5px] text-muted-foreground">
              {Object.entries(STATUS_META).map(([key, meta]) => (
                <span key={key} className="flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", meta.dot)} /> {meta.label}</span>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary"><Wallet className="h-3.5 w-3.5" /></span>
              <CardTitle>Cash needed</CardTitle>
            </div>
            <Badge variant={summary.overdue ? "danger" : "success"}>{summary.overdue ? "Action needed" : "On track"}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
              <p className="text-[11px] font-medium text-muted-foreground">Still unpaid in {monthLabel(month, true)}</p>
              <p className="mt-1 text-xl font-semibold tabular"><Money value={summary.monthDue} currency={currency} /></p>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">{summary.monthDueCount} bill{summary.monthDueCount === 1 ? "" : "s"} · autopay covers {formatMoney(summary.autopayTotal, currency)}</p>
            </div>
            {monthBills
              .filter((b) => b.status !== "paid")
              .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
              .slice(0, 4)
              .map((b) => {
                const meta = STATUS_META[billStatus(b)];
                return (
                  <div key={b.id} className="flex items-center gap-2.5 rounded-lg border border-border/60 px-2.5 py-2">
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] font-medium">{b.title}</span>
                      <span className="text-[10px] text-muted-foreground">{relativeDue(b.dueDate)}</span>
                    </span>
                    <span className="text-[11.5px] font-semibold tabular">{formatMoney(b.amount, currency)}</span>
                  </div>
                );
              })}
            {monthBills.filter((b) => b.status !== "paid").length === 0 && (
              <div className="flex flex-col items-center py-5 text-center">
                <CalendarDays className="h-5 w-5 text-emerald-500" />
                <p className="mt-2 text-[12px] font-medium">This month is clear</p>
                <p className="text-[10.5px] text-muted-foreground">No unpaid bills in {monthLabel(month)}.</p>
              </div>
            )}
            {summary.overdue > 0 && (
              <p className="rounded-lg bg-danger-soft px-2.5 py-2 text-[10.5px] leading-relaxed text-danger">
                {summary.overdueCount} overdue bill{summary.overdueCount === 1 ? "" : "s"} total {formatMoney(summary.overdue, currency)}. Settle these first — late fees compound.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{selectedDate ? `Bills on ${fmtDate(selectedDate, "d MMM yyyy")}` : "All bills & tickets"}</CardTitle>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {selectedDate ? "Clear the date selection to see everything." : "Unpaid first, then by due date."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedDate && <Button variant="ghost" size="sm" onClick={() => setSelectedDate(null)}>Clear date</Button>}
            <Select value={filter} onValueChange={(v) => setFilter(v as BillFilter)}>
              <SelectTrigger className="h-9 w-[140px]" aria-label="Filter bills by status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(FILTER_LABEL) as BillFilter[]).map((key) => <SelectItem key={key} value={key}>{FILTER_LABEL[key]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {!hasAny ? (
            <EmptyState
              icon={<ReceiptText />}
              title="No bills yet"
              description="Add rent, utilities, EMIs or tickets so nothing slips past its due date."
              action={<Button size="sm" onClick={openAdd}><Plus /> Add your first bill</Button>}
              className="py-8"
            />
          ) : list.length === 0 ? (
            <EmptyState icon={<CalendarDays />} title="Nothing matches" description="No bills match this date and status. Try clearing the filters." className="py-8" />
          ) : (
            <div className="space-y-2">
              {list.map((bill) => {
                const status = billStatus(bill);
                const meta = STATUS_META[status];
                const KindIcon = KIND_META[bill.kind].icon;
                return (
                  <div key={bill.id} className={cn("flex flex-col gap-3 rounded-2xl border border-border/70 p-3.5 sm:flex-row sm:items-center", status === "paid" && "bg-muted/20")}>
                    <span className={cn(
                      "flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl text-[9px] font-bold uppercase leading-none",
                      status === "overdue" ? "bg-danger-soft text-danger" : status === "due" ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground",
                    )}>
                      <span className="text-[13px]">{bill.dueDate.slice(8, 10)}</span>
                      {fmtDate(bill.dueDate, "MMM")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-[13px] font-semibold">{bill.title}</p>
                        <Badge variant="outline"><KindIcon /> {KIND_META[bill.kind].label}</Badge>
                        {bill.autopay && <Badge variant="default"><Repeat /> Autopay</Badge>}
                      </div>
                      <p className={cn("mt-1 text-[11px]", status === "overdue" ? "text-danger" : "text-muted-foreground")}>
                        {status === "paid" ? `Paid ${fmtDate(bill.paidAt ?? bill.dueDate, "d MMM yyyy")}` : `Due ${fmtDate(bill.dueDate, "d MMM yyyy")} · ${relativeDue(bill.dueDate)}`}
                        {status === "overdue" ? ` · ${daysUntil(bill.dueDate) < -1 ? "late fees may apply" : "overdue"}` : ""}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="tabular text-[15px] font-semibold">{formatMoney(bill.amount, currency)}</p>
                      <Badge variant={meta.badge} className="mt-1">{meta.label}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 sm:ml-1">
                      {status !== "paid" ? (
                        <Button size="sm" variant="outline" onClick={() => openPay(bill)}>Mark paid</Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => markUnpaid(bill)}><Undo2 /> Mark unpaid</Button>
                      )}
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${bill.title}`} onClick={() => openEdit(bill)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${bill.title}`} onClick={() => setDeleteTarget(bill)}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <InfoNote className="mt-4" icon={<ReceiptText />}>
        Marking a bill paid is local bookkeeping — it doesn't move money or contact the biller. Autopay here is a reminder label;
        PayPal payouts are managed from Scheduled payments.
      </InfoNote>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit bill" : "Add a bill"}</DialogTitle>
            <DialogDescription>Track bills, EMIs and tickets with a due date so the guardian can warn you in time.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="bill-title">Title</Label>
              <Input id="bill-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Electricity — Tata Power" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bill-kind">Type</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as Bill["kind"])}>
                  <SelectTrigger id="bill-kind" aria-label="Bill type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bill">Bill</SelectItem>
                    <SelectItem value="emi">EMI / loan</SelectItem>
                    <SelectItem value="ticket">Ticket</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bill-amount">Amount</Label>
                <MoneyInput id="bill-amount" value={amount} currency={currency} onChange={setAmount} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bill-date">Due date</Label>
              <Input id="bill-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <label htmlFor="bill-autopay" className="flex items-start gap-2.5 rounded-xl border border-border/70 p-3 text-[12px]">
              <Checkbox id="bill-autopay" checked={autopay} onCheckedChange={(v) => setAutopay(v === true)} className="mt-0.5" />
              <span>
                <span className="font-medium">This bill is on autopay</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">Shown as a label and included in the autopay total. No payment is executed.</span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? "Save changes" : "Add bill"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payTarget} onOpenChange={(open) => !open && setPayTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {payTarget?.title} paid?</DialogTitle>
            <DialogDescription>
              {payTarget ? `${formatMoney(payTarget.amount, currency)} due ${fmtDate(payTarget.dueDate, "d MMM yyyy")}.` : ""} Choose whether to add the matching expense to your transactions.
            </DialogDescription>
          </DialogHeader>
          <label htmlFor="record-expense" className="flex items-start gap-2.5 rounded-xl border border-border/70 p-3 text-[12px]">
            <Checkbox id="record-expense" checked={recordExpense} onCheckedChange={(v) => setRecordExpense(v === true)} className="mt-0.5" />
            <span>
              <span className="font-medium">Record it as an expense</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">Adds one transaction in a matching category. Turn off if you already imported the payment.</span>
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>Cancel</Button>
            <Button onClick={confirmPay}>Mark paid</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.title}?</DialogTitle>
            <DialogDescription>This removes the bill from your calendar and list. Any expense already recorded stays in transactions.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Keep it</Button>
            <Button variant="destructive" onClick={confirmDelete}><Trash2 /> Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
