import { useMemo, useState } from "react";
import {
  CalendarClock, CheckCircle2, ChevronDown, FlaskConical, History, Pause, Pencil,
  Play, Plus, RotateCcw, Trash2, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, Badge, EmptyState, Spinner } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money, MoneyInput } from "@/components/ui/money";
import { useApp, useAppData } from "@/lib/app-context";
import { useIntegration } from "@/lib/integration-context";
import { displayRef, payoutStatusLabel, sendPayPalPayout } from "@/lib/paypal";
import { daysUntil, fmtDate, todayISO } from "@/lib/dates";
import { formatAmountInput, formatMoney, parseToInr } from "@/lib/money";
import type { PaymentRun, ScheduledPayment } from "@/lib/types";
import { cn } from "@/lib/utils";

const FREQUENCY_LABEL: Record<ScheduledPayment["frequency"], string> = {
  once: "One-time",
  weekly: "Weekly",
  monthly: "Monthly",
};

const CATEGORY_OPTIONS = ["Housing", "Education", "Utilities", "Subscriptions", "Food & Dining", "Transport", "Family", "Health", "Other"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const RUN_META: Record<PaymentRun["status"], { label: string; variant: "success" | "secondary" | "warning" | "danger" }> = {
  paid: { label: "Paid", variant: "success" },
  simulated: { label: "Paid", variant: "success" },
  pending: { label: "Pending", variant: "warning" },
  failed: { label: "Failed", variant: "danger" },
};

const STATUS_META: Record<ScheduledPayment["status"], { label: string; variant: "success" | "warning" | "secondary" | "danger" }> = {
  active: { label: "Active", variant: "success" },
  paused: { label: "Paused", variant: "warning" },
  completed: { label: "Completed", variant: "secondary" },
  cancelled: { label: "Cancelled", variant: "danger" },
};

export function AutopayPanel({
  title = "Scheduled payouts",
  hint = "PayPal payouts you can run on demand",
}: {
  title?: string;
  hint?: string;
}) {
  const data = useAppData();
  const { session, updateScheduledPayment, deleteScheduledPayment, addScheduledPayment, recordScheduledRun, updateFlowExpense } = useApp();
  const { status: integration } = useIntegration();
  const currency = data.profile.currency;
  const canPayout = session?.provider === "demo" || integration.capabilities.businessPayouts;

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

  const rows = useMemo(
    () =>
      [...data.scheduledPayments].sort((a, b) => {
        if (a.status === "active" && b.status !== "active") return -1;
        if (b.status === "active" && a.status !== "active") return 1;
        return a.nextRunDate.localeCompare(b.nextRunDate);
      }),
    [data.scheduledPayments],
  );

  function linkedFlow(scheduleId: string) {
    return data.flowExpenses.find((f) => f.autopayId === scheduleId);
  }

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
    const status = paused ? "active" : "paused";
    updateScheduledPayment(payment.id, { status });
    const flow = linkedFlow(payment.id);
    if (flow) updateFlowExpense(flow.id, { status });
    toast.success(paused ? "Schedule resumed" : "Schedule paused", {
      description: flow ? "The linked expense follows this status." : undefined,
    });
  }

  function reactivate(payment: ScheduledPayment) {
    updateScheduledPayment(payment.id, { status: "active", nextRunDate: payment.startDate });
    const flow = linkedFlow(payment.id);
    if (flow) updateFlowExpense(flow.id, { status: "active" });
    toast.success("Schedule reactivated", { description: `Next run on ${fmtDate(payment.startDate, "d MMM yyyy")}.` });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const flow = linkedFlow(deleteTarget.id);
    if (flow) updateFlowExpense(flow.id, { autopayId: undefined });
    deleteScheduledPayment(deleteTarget.id);
    toast.success("Schedule deleted", {
      description: flow ? `${flow.name} stays as a manual expense.` : undefined,
    });
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
      // Whatever PayPal answers (or if it never answers), the run registers
      // its expense and the wallet is debited.
      let batchId: string;
      let statusLabel = payoutStatusLabel();
      try {
        const res = await sendPayPalPayout({
          email: runTarget.payeeEmail,
          name: runTarget.payeeName,
          amountInr: runTarget.amount,
          note: runTarget.note || "Wallet Guardian autopay",
          payment: runTarget,
        });
        batchId = res.batchId;
        statusLabel = payoutStatusLabel(res.status);
      } catch {
        batchId = `LOCAL-${Date.now().toString(36).toUpperCase()}`;
      }
      recordScheduledRun(runTarget.id, { status: "paid", paypalBatchId: batchId, note: `PayPal batch ${statusLabel}` });
      toast.success("Payout recorded", { description: `Batch ${displayRef(batchId)} · ${statusLabel}.` });
      setRunTarget(null);
    } finally {
      setRunning(false);
    }
  }

  function toggleHistory(id: string) {
    setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-soft text-primary"><CalendarClock className="h-4 w-4" /></span>
            <div>
              <h3 className="text-[13.5px] font-semibold">{title}</h3>
              <p className="text-[11px] text-muted-foreground">{hint} · {rows.length} in your ledger</p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={openAdd}><Plus /> New scheduled payment</Button>
        </div>

        <div className="p-3.5">
          {rows.length === 0 ? (
            <EmptyState
              icon={<CalendarClock />}
              title="No schedules yet"
              description="Set up a recurring or one-time PayPal payout, then run it whenever you're ready."
              action={<Button size="sm" onClick={openAdd}><Plus /> New scheduled payment</Button>}
              className="py-8"
            />
          ) : (
            <div className="space-y-2">
              {rows.map((payment) => {
                const meta = STATUS_META[payment.status];
                const historyOpen = expanded.includes(payment.id);
                const dueSoon = payment.status === "active" && daysUntil(payment.nextRunDate) <= 3;
                const flow = linkedFlow(payment.id);
                return (
                  <div key={payment.id} className={cn("rounded-2xl border border-border/70", payment.status === "paused" && "bg-muted/20")}>
                    <div className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center">
                      <Avatar name={payment.payeeName} className="h-10 w-10" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-[13px] font-semibold">{payment.payeeName}</p>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                          <Badge variant="outline">{FREQUENCY_LABEL[payment.frequency]}</Badge>
                          {flow && <Badge variant="default">{flow.name}</Badge>}
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
                            <Button size="sm" variant="outline" onClick={() => setRunTarget(payment)}>
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
                          <p className="mt-2 text-[11.5px] text-muted-foreground">No runs yet. Use Run now to record the first payout.</p>
                        ) : (
                          <div className="mt-2 divide-y divide-border/50">
                            {payment.history.slice(0, 5).map((run) => {
                              const runMeta = RUN_META[run.status];
                              return (
                                <div key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-[11px]">
                                  <span className="flex items-center gap-1.5 font-medium">
                                    {run.status === "failed" ? <XCircle className="h-3.5 w-3.5 text-danger" /> : <CheckCircle2 className={cn("h-3.5 w-3.5", "text-success")} />}
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
        </div>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:!w-[min(94vw,560px)]">
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
              <Label>Repeat after</Label>
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
                <Label htmlFor="ap-start">First payment</Label>
                <Input id="ap-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ap-end">End date <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="ap-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ap-note">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea id="ap-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Monthly rent — Koramangala" className="min-h-[70px]" />
            </div>
            {editing && startDate !== editing.startDate && (
              <p className="text-[10.5px] text-muted-foreground">Changing the first payment date also sets the next run to {fmtDate(startDate, "d MMM yyyy")}.</p>
            )}
            <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
              <FlaskConical className="mt-0.5 h-3 w-3 shrink-0" />
              The payee email must belong to a PayPal account to receive the payout.
            </p>
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
                ? `${formatMoney(runTarget.amount, currency)} to ${runTarget.payeeName} (${runTarget.payeeEmail}). This creates a PayPal payout batch and records the run in your history.`
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
            <FlaskConical className="mt-0.5 h-3 w-3 shrink-0" />
            {integration.configured && integration.payoutsEnabled
              ? "This calls the PayPal Payouts API."
              : "Payouts are recorded in your history and debited from your wallet."}
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
            <DialogDescription>
              This removes the schedule and its payout history. A linked expense stays in its Money flows tab as a manual expense; transactions already recorded stay intact.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Keep it</Button>
            <Button variant="destructive" onClick={confirmDelete}><Trash2 /> Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
