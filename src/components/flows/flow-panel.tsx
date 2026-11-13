import { useMemo, useState } from "react";
import {
  CalendarClock, CircleDot, FlaskConical, GraduationCap, HeartHandshake, HeartPulse,
  Landmark, Pause, Pencil, Play, Plus, ReceiptText, Repeat, ShoppingBasket, Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge, EmptyState } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Switch } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money, MoneyInput } from "@/components/ui/money";
import { useApp, useAppData } from "@/lib/app-context";
import { FLOW_TAB_LABEL, FLOW_TABS, flowPayeeCategory } from "@/lib/flows";
import { daysUntil, fmtDate, todayISO } from "@/lib/dates";
import { formatAmountInput, formatMoney, parseToInr } from "@/lib/money";
import type { FlowExpense, FlowTab, ScheduledPayment } from "@/lib/types";
import { cn } from "@/lib/utils";

export const TAB_ICON: Record<FlowTab, LucideIcon> = {
  subscriptions: Repeat,
  bills: ReceiptText,
  emis: Landmark,
  autopay: CalendarClock,
  donations: HeartHandshake,
  health: HeartPulse,
  education: GraduationCap,
  groceries: ShoppingBasket,
  others: CircleDot,
};

const REPEAT_LABEL: Record<ScheduledPayment["frequency"], string> = {
  once: "One-time",
  weekly: "Weekly",
  monthly: "Monthly",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function FlowPanel({
  tab,
  title,
  hint,
  allowAdd = true,
}: {
  tab: FlowTab;
  title?: string;
  hint?: string;
  allowAdd?: boolean;
}) {
  const data = useAppData();
  const {
    addFlowExpense, updateFlowExpense, deleteFlowExpense,
    addScheduledPayment, updateScheduledPayment, deleteScheduledPayment,
    updateSubscription, deleteSubscription, updateBill, deleteBill,
  } = useApp();
  const currency = data.profile.currency;
  const Icon = TAB_ICON[tab];

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FlowExpense | null>(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [autopayOn, setAutopayOn] = useState(false);
  const [payeeName, setPayeeName] = useState("");
  const [payeeEmail, setPayeeEmail] = useState("");
  const [autoAmount, setAutoAmount] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [frequency, setFrequency] = useState<ScheduledPayment["frequency"]>("monthly");
  const [deleteTarget, setDeleteTarget] = useState<FlowExpense | null>(null);

  const scheduleById = useMemo(
    () => new Map(data.scheduledPayments.map((p) => [p.id, p])),
    [data.scheduledPayments],
  );

  const rows = useMemo(
    () =>
      data.flowExpenses
        .filter((f) => f.tab === tab)
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === "active" ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
    [data.flowExpenses, tab],
  );

  function openAdd() {
    setEditing(null);
    setName("");
    setAmount("");
    setNote("");
    setDueOn("");
    setAutopayOn(false);
    setPayeeName("");
    setPayeeEmail("");
    setAutoAmount("");
    setStartDate(todayISO());
    setFrequency("monthly");
    setFormOpen(true);
  }

  function openEdit(flow: FlowExpense) {
    const schedule = flow.autopayId ? scheduleById.get(flow.autopayId) : undefined;
    setEditing(flow);
    setName(flow.name);
    setAmount(formatAmountInput(flow.amount, currency));
    setNote(flow.note ?? "");
    setDueOn(flow.dueDate ?? "");
    setAutopayOn(Boolean(schedule));
    setPayeeName(schedule?.payeeName ?? "");
    setPayeeEmail(schedule?.payeeEmail ?? "");
    setAutoAmount(schedule ? formatAmountInput(schedule.amount, currency) : formatAmountInput(flow.amount, currency));
    setStartDate(schedule?.startDate ?? todayISO());
    setFrequency(schedule?.frequency ?? "monthly");
    setFormOpen(true);
  }

  function enableAutopay(on: boolean) {
    setAutopayOn(on);
    if (on) {
      if (!payeeName.trim()) setPayeeName(name.trim());
      if (!autoAmount) setAutoAmount(amount);
    }
  }

  function removeAutopay() {
    if (!editing) return;
    const scheduleId = editing.autopayId;
    if (scheduleId) deleteScheduledPayment(scheduleId);
    updateFlowExpense(editing.id, { autopayId: undefined });
    setEditing({ ...editing, autopayId: undefined });
    setAutopayOn(false);
    setPayeeName("");
    setPayeeEmail("");
    setAutoAmount("");
    toast.success("Autopay details deleted", { description: "The expense itself is kept." });
  }

  function legacyKind(flow: FlowExpense) {
    if (flow.legacyId?.startsWith("sub_")) return "sub";
    if (flow.legacyId?.startsWith("bill_")) return "bill";
    return null;
  }

  function save() {
    const amt = parseToInr(amount, currency);
    if (!name.trim()) {
      toast.error("Give this expense a name.");
      return;
    }
    if (amt <= 0) {
      toast.error("Enter an amount above zero.");
      return;
    }
    const autoAmt = parseToInr(autoAmount || amount, currency);
    if (autopayOn) {
      if (!payeeName.trim()) {
        toast.error("Add the receiver's name.");
        return;
      }
      if (!EMAIL_RE.test(payeeEmail.trim())) {
        toast.error("Enter the receiver's PayPal email.");
        return;
      }
      if (autoAmt <= 0) {
        toast.error("Enter an autopay amount above zero.");
        return;
      }
      if (!startDate) {
        toast.error("Choose the first payment date.");
        return;
      }
    }

    const existingSchedule = editing?.autopayId ? scheduleById.get(editing.autopayId) : undefined;
    const flow = editing
      ? (updateFlowExpense(editing.id, {
          name: name.trim(),
          amount: amt,
          note: note.trim() || undefined,
          dueDate: dueOn || undefined,
        }), editing)
      : addFlowExpense({ name: name.trim(), amount: amt, tab, note: note.trim() || undefined, dueDate: dueOn || undefined });

    if (editing?.legacyId) {
      if (legacyKind(editing) === "sub") {
        updateSubscription(editing.legacyId, {
          name: name.trim(),
          cost: amt,
          ...(dueOn ? { nextBillingDate: dueOn } : {}),
        });
      } else if (legacyKind(editing) === "bill") {
        updateBill(editing.legacyId, {
          title: name.trim(),
          amount: amt,
          ...(dueOn ? { dueDate: dueOn } : {}),
        });
      }
    }

    if (autopayOn) {
      const scheduleInput = {
        payeeName: payeeName.trim(),
        payeeEmail: payeeEmail.trim(),
        amount: autoAmt,
        frequency,
        startDate,
        category: flowPayeeCategory(tab),
        note: `${name.trim()} — ${FLOW_TAB_LABEL[tab]}`,
      };
      if (existingSchedule) {
        updateScheduledPayment(existingSchedule.id, {
          ...scheduleInput,
          nextRunDate: startDate !== existingSchedule.startDate ? startDate : existingSchedule.nextRunDate,
        });
      } else {
        const created = addScheduledPayment({ ...scheduleInput, nextRunDate: startDate });
        updateFlowExpense(flow.id, { autopayId: created.id });
      }
    } else if (existingSchedule) {
      deleteScheduledPayment(existingSchedule.id);
      updateFlowExpense(flow.id, { autopayId: undefined });
    }

    toast.success(editing ? "Expense updated" : "Expense added", {
      description: autopayOn
        ? `${formatMoney(autoAmt, currency)} ${REPEAT_LABEL[frequency].toLowerCase()} autopay to ${payeeName.trim()}.`
        : `${formatMoney(amt, currency)} in ${FLOW_TAB_LABEL[tab].toLowerCase()}.`,
    });
    setFormOpen(false);
  }

  function togglePause(flow: FlowExpense) {
    const paused = flow.status === "paused";
    const status = paused ? "active" : "paused";
    updateFlowExpense(flow.id, { status });
    const schedule = flow.autopayId ? scheduleById.get(flow.autopayId) : undefined;
    if (schedule && (schedule.status === "active" || schedule.status === "paused")) {
      updateScheduledPayment(schedule.id, { status });
    }
    if (legacyKind(flow) === "sub" && flow.legacyId) {
      updateSubscription(flow.legacyId, { status: paused ? "active" : "cancelled" });
    }
    toast.success(paused ? "Expense resumed" : "Expense paused", {
      description: flow.autopayId ? "The linked autopay schedule follows this status." : undefined,
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.autopayId) deleteScheduledPayment(deleteTarget.autopayId);
    if (deleteTarget.legacyId) {
      if (legacyKind(deleteTarget) === "sub") deleteSubscription(deleteTarget.legacyId);
      else if (legacyKind(deleteTarget) === "bill") deleteBill(deleteTarget.legacyId);
    }
    deleteFlowExpense(deleteTarget.id);
    toast.success("Expense deleted", {
      description: deleteTarget.autopayId ? "Its autopay details were removed too." : undefined,
    });
    setDeleteTarget(null);
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-soft text-primary"><Icon className="h-4 w-4" /></span>
            <div>
              <h3 className="text-[13.5px] font-semibold">{title ?? FLOW_TAB_LABEL[tab]}</h3>
              <p className="text-[11px] text-muted-foreground">{hint ?? FLOW_TABS.find((t) => t.key === tab)?.hint}</p>
            </div>
          </div>
          {allowAdd && <Button size="sm" variant="outline" onClick={openAdd}><Plus /> Add expense</Button>}
        </div>

        <div className="p-3.5">
          {rows.length === 0 ? (
            <EmptyState
              icon={<Icon />}
              title={`No ${FLOW_TAB_LABEL[tab].toLowerCase()} yet`}
              description="Add an expense with its amount. You can optionally set up autopay and edit it later."
              action={allowAdd ? <Button size="sm" onClick={openAdd}><Plus /> Add expense</Button> : undefined}
              className="py-8"
            />
          ) : (
            <div className="space-y-2">
              {rows.map((flow) => {
                const schedule = flow.autopayId ? scheduleById.get(flow.autopayId) : undefined;
                const paused = flow.status === "paused";
                const dueSoon = schedule?.status === "active" && daysUntil(schedule.nextRunDate) <= 3;
                return (
                  <div
                    key={flow.id}
                    className={cn(
                      "flex flex-col gap-3 rounded-2xl border border-border/70 p-3.5 sm:flex-row sm:items-center",
                      paused && "bg-muted/20",
                    )}
                  >
                    <span className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                      paused ? "bg-muted text-muted-foreground" : "bg-primary-soft text-primary",
                    )}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className={cn("text-[13px] font-semibold", paused && "text-muted-foreground")}>{flow.name}</p>
                        <Badge variant={paused ? "warning" : "success"}>{paused ? "Paused" : "Active"}</Badge>
                        {schedule && <Badge variant="outline"><Repeat /> {REPEAT_LABEL[schedule.frequency]} autopay</Badge>}
                        {dueSoon && <Badge variant="warning">Due soon</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {flow.note ? `${flow.note} · ` : ""}
                        {schedule
                          ? `${schedule.payeeName} · ${schedule.payeeEmail} · next ${fmtDate(schedule.nextRunDate, "d MMM yyyy")}`
                          : "No autopay — managed manually"}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="tabular text-[15px] font-semibold"><Money value={flow.amount} currency={currency} /></p>
                      <p className="text-[10.5px] text-muted-foreground">
                        {schedule
                          ? `autopay ${formatMoney(schedule.amount, currency)} ${REPEAT_LABEL[schedule.frequency].toLowerCase()}`
                          : "per cycle"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => togglePause(flow)}
                        aria-label={paused ? `Resume ${flow.name}` : `Pause ${flow.name}`}
                      >
                        {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => openEdit(flow)} aria-label={`Edit ${flow.name}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(flow)} aria-label={`Delete ${flow.name}`}>
                        <Trash2 className="h-3.5 w-3.5 text-danger" />
                      </Button>
                    </div>
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
            <DialogTitle>{editing ? "Edit expense" : `Add to ${FLOW_TAB_LABEL[tab]}`}</DialogTitle>
            <DialogDescription>
              Name it and set the amount. Turn on autopay to pay it from PayPal on a schedule.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="flow-name">Expense name</Label>
                <Input id="flow-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Netflix, House rent, Guitar lessons" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="flow-amount">Amount</Label>
                <MoneyInput id="flow-amount" value={amount} currency={currency} onChange={setAmount} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="flow-note">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="flow-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Family plan" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="flow-due">Next due <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="flow-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
              </div>
            </div>
            <p className="-mt-2 text-[10.5px] text-muted-foreground">
              Due dates drive the calendar when this expense has no autopay.
            </p>

            <div className="rounded-2xl border border-border/70 p-3.5">
              <label htmlFor="flow-autopay" className="flex items-start justify-between gap-3">
                <span>
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold"><CalendarClock className="h-3.5 w-3.5 text-primary" /> Add autopay</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                    Send this expense from PayPal to the receiver on a repeating schedule.
                  </span>
                </span>
                <Switch id="flow-autopay" checked={autopayOn} onCheckedChange={enableAutopay} aria-label="Add autopay" />
              </label>

              {autopayOn && (
                <div className="mt-3.5 space-y-3 border-t border-border/60 pt-3.5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="flow-payee">Receiver name</Label>
                      <Input id="flow-payee" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="e.g. Rakesh Sharma" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="flow-payee-email">Receiver's PayPal email</Label>
                      <Input id="flow-payee-email" type="email" value={payeeEmail} onChange={(e) => setPayeeEmail(e.target.value)} placeholder="name@example.com" />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="flow-auto-amount">Autopay amount</Label>
                      <MoneyInput id="flow-auto-amount" value={autoAmount} currency={currency} onChange={setAutoAmount} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="flow-start">First payment</Label>
                      <Input id="flow-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
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
                          {REPEAT_LABEL[key]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {editing?.autopayId && (
                    <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={removeAutopay}>
                      <Trash2 /> Delete autopay details
                    </Button>
                  )}
                  <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
                    <FlaskConical className="mt-0.5 h-3 w-3 shrink-0" />
                    The receiver email must belong to a PayPal account to receive the payout.
                  </p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? "Save changes" : "Add expense"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              This removes the expense from {FLOW_TAB_LABEL[tab]}. Any autopay schedule linked to it is deleted too; transactions already recorded stay intact.
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
