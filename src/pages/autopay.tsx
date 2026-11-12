import { useMemo, useState } from "react";
import {
  CalendarClock, CheckCircle2, ChevronDown, FlaskConical, History, Pause, Pencil,
  Play, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Avatar, Badge, EmptyState, InfoNote, Spinner } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money, MoneyInput } from "@/components/ui/money";
import { useApp, useAppData } from "@/lib/app-context";
import { useIntegration } from "@/lib/integration-context";
import { sendPayPalPayout } from "@/lib/paypal";
import { daysUntil, fmtDate, todayISO } from "@/lib/dates";
import { formatAmountInput, formatMoney, parseToInr } from "@/lib/money";
import type { PaymentRun, ScheduledPayment } from "@/lib/types";
import { cn } from "@/lib/utils";

type Filter = "active" | "paused" | "completed" | "all";

const FILTER_LABEL: Record<Filter, string> = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  all: "All",
};

const FREQUENCY_LABEL: Record<ScheduledPayment["frequency"], string> = {
  once: "One-time",
  weekly: "Weekly",
  monthly: "Monthly",
};

const CATEGORY_OPTIONS = ["Housing", "Education", "Utilities", "Subscriptions", "Food & Dining", "Transport", "Family", "Health", "Other"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const RUN_META: Record<PaymentRun["status"], { label: string; variant: "success" | "secondary" | "warning" | "danger" }> = {
  paid: { label: "Paid", variant: "success" },
  simulated: { label: "Simulated", variant: "secondary" },
  pending: { label: "Pending", variant: "warning" },
  failed: { label: "Failed", variant: "danger" },
};

const STATUS_META: Record<ScheduledPayment["status"], { label: string; variant: "success" | "warning" | "secondary" | "danger" }> = {
  active: { label: "Active", variant: "success" },
  paused: { label: "Paused", variant: "warning" },
  completed: { label: "Completed", variant: "secondary" },
  cancelled: { label: "Cancelled", variant: "danger" },
};

function monthlyEquivalent(p: ScheduledPayment) {
  if (p.frequency === "monthly") return p.amount;
  if (p.frequency === "weekly") return Math.round((p.amount * 52) / 12);
  return 0;
}

function amountInNext30(p: ScheduledPayment) {
  if (p.status !== "active") return 0;
  const days = daysUntil(p.nextRunDate);
  if (days > 30) return 0;
  if (p.frequency === "weekly") {
    const start = Math.max(0, days);
    return (Math.floor((30 - start) / 7) + 1) * p.amount;
  }
  return p.amount;
}

export default function AutopayPage() {
  const data = useAppData();
  const { session, addScheduledPayment, updateScheduledPayment, deleteScheduledPayment, recordScheduledRun } = useApp();
  const { status: integration } = useIntegration();
  const currency = data.profile.currency;
  const live = session?.env === "live";
  const canPayout = session?.provider === "demo" || integration.capabilities.businessPayouts;

  const [filter, setFilter] = useState<Filter>("active");
  const [expanded, setExpanded] = useState<string[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledPayment | null>(null);
  const [payeeName, setPayeeName] = useState("");
  const [payeeEmail, setPayeeEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<ScheduledPayment["frequency"]>("monthly");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState("");
  const [category, setCategory] = useState("Housing");
  const [note, setNote] = useState("");

  const [runTarget, setRunTarget] = useState<ScheduledPayment | null>(null);
  const [running, setRunning] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledPayment | null>(null);

  const counts = useMemo(() => {
    const active = data.scheduledPayments.filter((p) => p.status === "active");
    const paused = data.scheduledPayments.filter((p) => p.status === "paused");
    const finished = data.scheduledPayments.filter((p) => p.status === "completed" || p.status === "cancelled");
    const runs = data.scheduledPayments.flatMap((p) => p.history);
    return {
      active: active.length,
      paused: paused.length,
      monthly: active.reduce((sum, p) => sum + monthlyEquivalent(p), 0),
      next30: data.scheduledPayments.reduce((sum, p) => sum + amountInNext30(p), 0),
      runCount: runs.filter((r) => r.status === "paid" || r.status === "simulated").length,
      failedCount: runs.filter((r) => r.status === "failed").length,
      finished: finished.length,
    };
  }, [data.scheduledPayments]);

  const rows = useMemo(() => {
    const base = filter === "all" ? data.scheduledPayments : filter === "completed"
      ? data.scheduledPayments.filter((p) => p.status === "completed" || p.status === "cancelled")
      : data.scheduledPayments.filter((p) => p.status === filter);
    return [...base].sort((a, b) => {
      if (a.status === "active" && b.status !== "active") return -1;
      if (b.status === "active" && a.status !== "active") return 1;
      return a.nextRunDate.localeCompare(b.nextRunDate);
    });
  }, [data.scheduledPayments, filter]);

  function openAdd() {
    setEditing(null);
    setPayeeName("");
    setPayeeEmail("");
    setAmount("");
    setFrequency("monthly");
    setStartDate(todayISO());
    setEndDate("");
    setCategory("Housing");
    setNote("");
    setFormOpen(true);
  }

  function openEdit(payment: ScheduledPayment) {
    setEditing(payment);
    setPayeeName(payment.payeeName);
    setPayeeEmail(payment.payeeEmail);
    setAmount(formatAmountInput(payment.amount, currency));
    setFrequency(payment.frequency);
    setStartDate(payment.startDate);
    setEndDate(payment.endDate ?? "");
    setCategory(payment.category);
    setNote(payment.note ?? "");
    setFormOpen(true);
  }

  function save() {
    const amt = parseToInr(amount, currency);
    if (!payeeName.trim()) {
      toast.error("Add a payee name.");
      return;
    }
    if (!EMAIL_RE.test(payeeEmail.trim())) {
      toast.error("Enter a valid PayPal email for the payee.");
      return;
    }
    if (amt <= 0) {
      toast.error("Enter an amount above zero.");
      return;
    }
    if (!startDate) {
      toast.error("Choose a start date.");
      return;
    }
    if (endDate && endDate < startDate) {
      toast.error("The end date can't be before the start date.");
      return;
    }
    const payload = {
      payeeName: payeeName.trim(),
      payeeEmail: payeeEmail.trim(),
      amount: amt,
      frequency,
      startDate,
      endDate: endDate || undefined,
      category,
      note: note.trim() || undefined,
    };
    if (editing) {
      const nextRunDate = startDate !== editing.startDate ? startDate : editing.nextRunDate;
      updateScheduledPayment(editing.id, { ...payload, nextRunDate });
      toast.success("Schedule updated");
    } else {
      addScheduledPayment({ ...payload, nextRunDate: startDate });
      toast.success("Autopay scheduled", { description: `${formatMoney(amt, currency)} ${FREQUENCY_LABEL[frequency].toLowerCase()} to ${payeeName.trim()}.` });
    }
    setFormOpen(false);
  }

  function togglePause(payment: ScheduledPayment) {
    const paused = payment.status === "paused";
    updateScheduledPayment(payment.id, { status: paused ? "active" : "paused" });
    toast.success(paused ? "Schedule resumed" : "Schedule paused");
  }

  function reactivate(payment: ScheduledPayment) {
    updateScheduledPayment(payment.id, { status: "active", nextRunDate: payment.startDate });
    toast.success("Schedule reactivated", { description: `Next run on ${fmtDate(payment.startDate, "d MMM yyyy")}.` });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteScheduledPayment(deleteTarget.id);
    toast.success("Schedule deleted");
    setDeleteTarget(null);
  }

  async function runNow() {
    if (!runTarget) return;
    if (runTarget.amount > data.profile.walletBalance) {
      toast.error("Not enough wallet balance for this run", { description: "Top up your PayPal wallet, or lower the schedule amount." });
      return;
    }
    setRunning(true);
    try {
      const res = await sendPayPalPayout({
        email: runTarget.payeeEmail,
        name: runTarget.payeeName,
        amountInr: runTarget.amount,
        note: runTarget.note || "Wallet Guardian autopay",
        payment: runTarget,
      });
      recordScheduledRun(runTarget.id, {
        status: res.simulated ? "simulated" : "paid",
        paypalBatchId: res.batchId,
        note: res.simulated ? res.message ?? "Simulated sandbox payout" : `PayPal batch ${res.status}`,
      });
      toast.success(res.simulated ? "Simulated payout recorded" : live ? "Live payout sent" : "Payout sent in the PayPal sandbox", {
        description: res.simulated
          ? `${res.message ?? "Payouts are not enabled"} Batch ${res.batchId}.`
          : `Batch ${res.batchId} · ${res.status}.`,
      });
      setRunTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The payout could not be started.");
    } finally {
      setRunning(false);
    }
  }

  function toggleHistory(id: string) {
    setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const nextRun = data.scheduledPayments
    .filter((p) => p.status === "active")
    .sort((a, b) => a.nextRunDate.localeCompare(b.nextRunDate))[0];

  return (
    <div>
      <PageHeader
        title="Autopay"
        description="Scheduled PayPal payouts to people you trust — rent, lessons, family support. Run them on demand or let the schedule track what's next."
        actions={<Button size="sm" onClick={openAdd}><Plus /> New scheduled payment</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {[
          { label: "Monthly commitment", value: counts.monthly, sub: "Recurring active schedules", tone: "text-foreground", money: true },
          { label: "Next 30 days", value: counts.next30, sub: nextRun ? `Next: ${nextRun.payeeName} · ${fmtDate(nextRun.nextRunDate, "d MMM")}` : "Nothing scheduled", tone: "text-foreground", money: true },
          { label: "Active schedules", value: counts.active, sub: `${counts.paused} paused · ${counts.finished} finished`, tone: "text-foreground", money: false },
          { label: "Payout runs", value: counts.runCount, sub: counts.failedCount ? `${counts.failedCount} failed` : "No failed runs", tone: counts.failedCount ? "text-danger" : "text-success", money: false },
        ].map((stat) => (
          <Card key={stat.label} className="p-3.5 sm:p-4">
            <p className="text-[11px] font-medium text-muted-foreground sm:text-xs">{stat.label}</p>
            <p className={cn("mt-1 text-lg font-semibold tracking-tight tabular sm:text-xl", stat.tone)}>
              {stat.money ? <Money value={stat.value} currency={currency} /> : stat.value}
            </p>
            <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{stat.sub}</p>
          </Card>
        ))}
      </div>

      <InfoNote className="mb-4" icon={live ? <ShieldCheck /> : <FlaskConical />}>
        {live
          ? canPayout
            ? "Live payouts are sent from the PayPal business account named in PAYPAL_BUSINESS_EMAILS. Every run moves real money and is recorded in your ledger."
            : "Live payouts are limited to the app owner's PayPal business account. This login can still pay from its own account with Wallet → Pay someone."
          : !integration.configured
            ? "PayPal sandbox credentials aren't configured, so every demo payout is simulated, labelled, and fully local. No money can move."
            : integration.payoutsEnabled
              ? "Payouts are enabled on the server's PayPal sandbox account. Batch IDs come from the sandbox API."
              : "The sandbox account can't send payouts. Runs fall back to a labelled simulation and still record history."}
      </InfoNote>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary"><CalendarClock className="h-3.5 w-3.5" /></span>
            <div>
              <CardTitle>Scheduled payouts</CardTitle>
              <p className="text-[11px] text-muted-foreground">{data.scheduledPayments.length} schedules in your ledger</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1 rounded-xl bg-muted/50 p-1">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((key) => {
              const count = key === "all" ? data.scheduledPayments.length : key === "completed" ? counts.finished : key === "active" ? counts.active : counts.paused;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors",
                    filter === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {FILTER_LABEL[key]} <span className="tabular opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={<CalendarClock />}
              title={filter === "active" ? "No active autopays" : filter === "paused" ? "Nothing paused" : filter === "completed" ? "No finished schedules" : "No schedules yet"}
              description={`Set up a recurring or one-time PayPal payout, then run it whenever you're ready. ${live ? "Live payouts come from the allowlisted business account." : "Sandbox only — no real money moves."}`}
              action={<Button size="sm" onClick={openAdd}><Plus /> New scheduled payment</Button>}
              className="py-8"
            />
          ) : (
            <div className="space-y-2">
              {rows.map((payment) => {
                const meta = STATUS_META[payment.status];
                const historyOpen = expanded.includes(payment.id);
                const dueSoon = payment.status === "active" && daysUntil(payment.nextRunDate) <= 3;
                return (
                  <div key={payment.id} className="rounded-2xl border border-border/70">
                    <div className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center">
                      <Avatar name={payment.payeeName} className="h-10 w-10" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-[13px] font-semibold">{payment.payeeName}</p>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                          <Badge variant="outline">{FREQUENCY_LABEL[payment.frequency]}</Badge>
                          {dueSoon && <Badge variant="warning">Due soon</Badge>}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {payment.payeeEmail} · {payment.category}
                          {payment.note ? ` · ${payment.note}` : ""}
                        </p>
                        <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                          {payment.status === "completed"
                            ? "Schedule finished"
                            : payment.status === "cancelled"
                              ? "Cancelled"
                              : `Next run ${fmtDate(payment.nextRunDate, "d MMM yyyy")} · ${payment.endDate ? `ends ${fmtDate(payment.endDate, "d MMM yyyy")}` : "no end date"}`}
                        </p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="tabular text-[15px] font-semibold"><Money value={payment.amount} currency={currency} /></p>
                        <p className="text-[10.5px] text-muted-foreground">{FREQUENCY_LABEL[payment.frequency].toLowerCase()} · from {fmtDate(payment.startDate, "d MMM")}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {(payment.status === "active" || payment.status === "paused") && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setRunTarget(payment)} disabled={live}>
                              <Play /> Run now
                            </Button>
                            <Button variant="ghost" size="icon-sm" onClick={() => togglePause(payment)} aria-label={payment.status === "paused" ? `Resume payment to ${payment.payeeName}` : `Pause payment to ${payment.payeeName}`}>
                              {payment.status === "paused" ? <RotateCcw className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                            </Button>
                            <Button variant="ghost" size="icon-sm" onClick={() => openEdit(payment)} aria-label={`Edit payment to ${payment.payeeName}`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {(payment.status === "completed" || payment.status === "cancelled") && (
                          <Button variant="ghost" size="sm" onClick={() => reactivate(payment)}>
                            <RotateCcw /> Reactivate
                          </Button>
                        )}
                        <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(payment)} aria-label={`Delete payment to ${payment.payeeName}`}>
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => toggleHistory(payment.id)} aria-expanded={historyOpen} aria-label={`${historyOpen ? "Hide" : "Show"} payout history for ${payment.payeeName}`}>
                          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", historyOpen && "rotate-180")} />
                        </Button>
                      </div>
                    </div>
                    {historyOpen && (
                      <div className="border-t border-border/60 px-3.5 py-3">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                          <History className="h-3.5 w-3.5" /> Payout history
                          <span className="font-normal">· {payment.history.length} runs</span>
                        </div>
                        {payment.history.length === 0 ? (
                          <p className="mt-2 text-[11.5px] text-muted-foreground">No runs yet. Use Run now to record the first {live ? "live" : "sandbox"} payout.</p>
                        ) : (
                          <div className="mt-2 divide-y divide-border/50">
                            {payment.history.slice(0, 5).map((run) => {
                              const runMeta = RUN_META[run.status];
                              return (
                                <div key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-[11px]">
                                  <span className="flex items-center gap-1.5 font-medium">
                                    {run.status === "failed" ? <XCircle className="h-3.5 w-3.5 text-danger" /> : <CheckCircle2 className={cn("h-3.5 w-3.5", run.status === "simulated" ? "text-muted-foreground" : "text-success")} />}
                                    {fmtDate(run.date, "d MMM yyyy")}
                                  </span>
                                  <Badge variant={runMeta.variant}>{runMeta.label}</Badge>
                                  <span className="tabular font-semibold"><Money value={run.amount} currency={currency} /></span>
                                  {run.paypalBatchId && <span className="truncate font-mono text-[10px] text-muted-foreground">batch {run.paypalBatchId}</span>}
                                  {run.note && <span className="truncate text-muted-foreground">{run.note}</span>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <InfoNote className="mt-4" icon={<Sparkles />}>
        {live
          ? canPayout
            ? "Runs are manual: press Run now and the server sends a real PayPal payout from the allowlisted business account. Each run records an expense and debits the PayPal wallet."
            : "Live payouts are limited to the app owner's business account. Use Wallet → Pay someone to approve each payment from your own PayPal account."
          : "Autopay runs are manual in this sandbox: press Run now and the server attempts a PayPal sandbox payout, falling back to a labelled simulation when payouts aren't enabled. Runs record an expense and debit the sandbox wallet."}{" "}
        Suggestions are not financial advice.
      </InfoNote>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit scheduled payment" : "New scheduled payment"}</DialogTitle>
            <DialogDescription>Send a PayPal payout to a person on a schedule you control.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ap-name">Payee name</Label>
                <Input id="ap-name" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="e.g. Rakesh Sharma" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ap-email">PayPal email</Label>
                <Input id="ap-email" type="email" value={payeeEmail} onChange={(e) => setPayeeEmail(e.target.value)} placeholder="name@example.com" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ap-amount">Amount</Label>
                <MoneyInput id="ap-amount" value={amount} currency={currency} onChange={setAmount} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ap-category">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="ap-category" aria-label="Payment category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/50 p-1">
                {(["once", "weekly", "monthly"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFrequency(key)}
                    aria-pressed={frequency === key}
                    className={cn(
                      "rounded-lg px-2 py-1.5 text-[11.5px] font-semibold transition-colors",
                      frequency === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {FREQUENCY_LABEL[key]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ap-start">Start date</Label>
                <Input id="ap-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ap-end">End date <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="ap-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ap-note">Note</Label>
              <Textarea id="ap-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Monthly rent — Koramangala" className="min-h-[70px]" />
            </div>
            {editing && startDate !== editing.startDate && (
              <p className="text-[10.5px] text-muted-foreground">Changing the start date also sets the next run to {fmtDate(startDate, "d MMM yyyy")}.</p>
            )}
            <div className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-[10.5px] text-muted-foreground">
              {live ? <ShieldCheck className="h-3 w-3 shrink-0" /> : <FlaskConical className="h-3 w-3 shrink-0" />}
              {live
                ? "Live payouts: the payee email must belong to a real PayPal account, and Payouts must be enabled for the Wallet Guardian business account."
                : "Sandbox only. The payee email must belong to a PayPal sandbox test account for real sandbox API calls, otherwise the run is simulated."}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? "Save changes" : "Create schedule"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!runTarget} onOpenChange={(open) => !open && !running && setRunTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run payout now?</DialogTitle>
            <DialogDescription>
              {runTarget
                ? `${formatMoney(runTarget.amount, currency)} to ${runTarget.payeeName} (${runTarget.payeeEmail}). This creates a ${live ? "live PayPal" : "PayPal sandbox"} payout batch and records the run in your history.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {runTarget && (
            <div className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-3 text-[11.5px]">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Wallet balance</span>
                <span className="font-semibold tabular"><Money value={data.profile.walletBalance} currency={currency} /></span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">After this run</span>
                <span className="font-semibold tabular"><Money value={data.profile.walletBalance - runTarget.amount} currency={currency} /></span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Frequency</span>
                <span className="font-medium">{FREQUENCY_LABEL[runTarget.frequency]} · next {fmtDate(runTarget.nextRunDate, "d MMM yyyy")}</span>
              </div>
            </div>
          )}
          <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
            {live ? <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" /> : <FlaskConical className="mt-0.5 h-3 w-3 shrink-0" />}
            {live
              ? canPayout
                ? "This sends a real PayPal payout from the allowlisted business account and debits your PayPal wallet balance."
                : "Live payouts are limited to the app owner's business account. Cancel and use Wallet → Pay someone instead."
              : integration.configured && integration.payoutsEnabled
                ? "This calls the PayPal sandbox Payouts API. No real money moves."
                : "Payouts will be simulated and labelled — no real money moves."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunTarget(null)} disabled={running}>Cancel</Button>
            <Button onClick={runNow} disabled={running || !canPayout}>
              {running ? <Spinner /> : <Play />} {running ? "Sending…" : "Run payout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete schedule for {deleteTarget?.payeeName}?</DialogTitle>
            <DialogDescription>This removes the schedule and its payout history. Transactions already recorded stay intact.</DialogDescription>
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
