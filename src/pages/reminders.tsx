import { useMemo, useState } from "react";
import {
  ArrowDownLeft, ArrowUpRight, BellRing, Check, Copy, ExternalLink, Mail, Pencil, Plus,
  ReceiptText, Sparkles, Trash2, Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Badge, EmptyState, InfoNote, Spinner, Avatar } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money, MoneyInput } from "@/components/ui/money";
import { useApp, useAppData } from "@/lib/app-context";
import { useIntegration } from "@/lib/integration-context";
import { createPayPalInvoice, type InvoiceResult } from "@/lib/paypal";
import { daysUntil, fmtDate, relativeDue, todayISO } from "@/lib/dates";
import { formatAmountInput, formatMoney, parseToInr } from "@/lib/money";
import type { Reminder } from "@/lib/types";
import { cn } from "@/lib/utils";

type Scope = "all" | "owe" | "owed" | "settled";

const SCOPE_LABEL: Record<Scope, string> = {
  all: "All open",
  owe: "I owe",
  owed: "Owed to me",
  settled: "Settled",
};

export default function RemindersPage() {
  const data = useAppData();
  const { session, addReminder, updateReminder, deleteReminder, settleReminder, addTransaction } = useApp();
  const { status: integration } = useIntegration();
  const currency = data.profile.currency;
  const live = session?.env === "live";
  const canInvoice = session?.provider === "demo" || integration.capabilities.businessInvoices;

  const [scope, setScope] = useState<Scope>("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [direction, setDirection] = useState<Reminder["direction"]>("owe");
  const [person, setPerson] = useState("");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(todayISO());
  const [note, setNote] = useState("");

  const [settleTarget, setSettleTarget] = useState<Reminder | null>(null);
  const [recordTx, setRecordTx] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Reminder | null>(null);

  const [requestFor, setRequestFor] = useState<Reminder | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [invoiceResult, setInvoiceResult] = useState<InvoiceResult | null>(null);
  const [requestText, setRequestText] = useState("");

  const open = data.reminders.filter((r) => r.status === "open");
  const settled = data.reminders.filter((r) => r.status === "settled");

  const totals = useMemo(() => {
    const owe = open.filter((r) => r.direction === "owe").reduce((s, r) => s + r.amount, 0);
    const owed = open.filter((r) => r.direction === "owed").reduce((s, r) => s + r.amount, 0);
    const settledSum = settled.reduce((s, r) => s + r.amount, 0);
    return { owe, owed, net: owed - owe, settledSum };
  }, [open, settled]);

  const rows = useMemo(() => {
    const base = scope === "settled" ? settled : open;
    const filtered = scope === "all" || scope === "settled" ? base : base.filter((r) => r.direction === scope);
    return [...filtered].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [scope, open, settled]);

  function openAdd() {
    setEditing(null);
    setDirection("owe");
    setPerson("");
    setEmail("");
    setAmount("");
    setDueDate(todayISO());
    setNote("");
    setFormOpen(true);
  }

  function openEdit(rem: Reminder) {
    setEditing(rem);
    setDirection(rem.direction);
    setPerson(rem.person);
    setEmail(rem.email ?? "");
    setAmount(formatAmountInput(rem.amount, currency));
    setDueDate(rem.dueDate);
    setNote(rem.note ?? "");
    setFormOpen(true);
  }

  function save() {
    const amt = parseToInr(amount, currency);
    if (!person.trim()) {
      toast.error("Who is this reminder with?");
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
    const payload = {
      direction,
      person: person.trim(),
      email: email.trim() || undefined,
      amount: amt,
      dueDate,
      note: note.trim() || undefined,
    };
    if (editing) {
      updateReminder(editing.id, payload);
      toast.success("Reminder updated");
    } else {
      addReminder(payload);
      toast.success("Reminder added");
    }
    setFormOpen(false);
  }

  function openSettle(rem: Reminder) {
    setSettleTarget(rem);
    setRecordTx(true);
  }

  function confirmSettle() {
    if (!settleTarget) return;
    settleReminder(settleTarget.id);
    if (recordTx) {
      addTransaction({
        type: settleTarget.direction === "owe" ? "expense" : "income",
        amount: settleTarget.amount,
        categoryId: settleTarget.direction === "owe" ? "cat_other" : "cat_refunds",
        merchant: settleTarget.person,
        date: todayISO(),
        paymentMethod: settleTarget.direction === "owe" ? "UPI" : "Bank transfer",
        notes: settleTarget.note ? `${settleTarget.note} — settled` : `Settled with ${settleTarget.person}`,
        source: "manual",
      });
    }
    toast.success(`Settled with ${settleTarget.person}`, {
      description: recordTx ? "A matching transaction was recorded." : "No transaction was recorded.",
    });
    setSettleTarget(null);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteReminder(deleteTarget.id);
    toast.success("Reminder deleted");
    setDeleteTarget(null);
  }

  function openRequest(rem: Reminder) {
    setRequestFor(rem);
    setInvoiceResult(
      rem.paypalInvoiceId
        ? { invoiceId: rem.paypalInvoiceId, status: "DRAFT", simulated: !rem.paypalInvoiceUrl, invoiceUrl: rem.paypalInvoiceUrl }
        : null,
    );
    setRequestText(
      `Hi ${rem.person},\n\nA quick reminder about ${formatMoney(rem.amount, currency)}${rem.note ? ` for ${rem.note}` : ""}, due ${fmtDate(rem.dueDate, "d MMM yyyy")}.\n\nCould you send it via PayPal to ${data.profile.email}? Let me know if you'd like to split it differently.\n\nThanks,\n${data.profile.name}`,
    );
  }

  async function createInvoice() {
    if (!requestFor) return;
    if (!requestFor.email) {
      toast.error("Add an email address to send a PayPal request.");
      return;
    }
    setRequesting(true);
    try {
      const res = await createPayPalInvoice({
        email: requestFor.email,
        name: requestFor.person,
        amountInr: requestFor.amount,
        description: requestFor.note || "Payment request",
        reminder: requestFor,
      });
      setInvoiceResult(res);
      updateReminder(requestFor.id, { paypalInvoiceId: res.invoiceId, paypalInvoiceUrl: res.invoiceUrl });
      toast.success(res.simulated ? "Simulated invoice draft created" : live ? "PayPal invoice created" : "PayPal sandbox invoice created", {
        description: res.simulated ? res.message : `Invoice ${res.invoiceId}`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the invoice.");
    } finally {
      setRequesting(false);
    }
  }

  async function copyRequest() {
    try {
      await navigator.clipboard.writeText(requestText);
      toast.success("Payment request copied");
    } catch {
      toast.error("Copy failed — select the text and copy manually.");
    }
  }

  const directionMeta = {
    owe: { label: "You owe", badge: "danger" as const, icon: ArrowUpRight, tone: "text-danger" },
    owed: { label: "Owes you", badge: "success" as const, icon: ArrowDownLeft, tone: "text-success" },
  };

  return (
    <div>
      <PageHeader
        title="Reminders"
        description="Who owes whom, when it's due, and one-tap PayPal requests. Settling updates your local ledger."
        actions={<Button size="sm" onClick={openAdd}><Plus /> Add reminder</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {[
          { label: "You owe", value: totals.owe, sub: `${open.filter((r) => r.direction === "owe").length} open`, tone: "text-danger" },
          { label: "Owed to you", value: totals.owed, sub: `${open.filter((r) => r.direction === "owed").length} open`, tone: "text-success" },
          { label: "Net position", value: totals.net, sub: totals.net >= 0 ? "In your favour" : "You're behind", tone: totals.net >= 0 ? "text-success" : "text-danger" },
          { label: "Settled", value: totals.settledSum, sub: `${settled.length} cleared`, tone: "text-foreground" },
        ].map((stat) => (
          <Card key={stat.label} className="p-3.5 sm:p-4">
            <p className="text-[11px] font-medium text-muted-foreground sm:text-xs">{stat.label}</p>
            <p className={cn("mt-1 text-lg font-semibold tracking-tight tabular sm:text-xl", stat.tone)}>
              <Money value={stat.value} currency={currency} signed={stat.label === "Net position"} />
            </p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">{stat.sub}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary"><BellRing className="h-3.5 w-3.5" /></span>
            <CardTitle>Split the list</CardTitle>
          </div>
          <div className="flex flex-wrap gap-1 rounded-xl bg-muted/50 p-1">
            {(Object.keys(SCOPE_LABEL) as Scope[]).map((key) => {
              const count = key === "settled" ? settled.length : key === "all" ? open.length : open.filter((r) => r.direction === key).length;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setScope(key)}
                  aria-pressed={scope === key}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors",
                    scope === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {SCOPE_LABEL[key]} <span className="tabular opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={<BellRing />}
              title={scope === "settled" ? "No settled reminders" : "Nothing outstanding"}
              description={scope === "settled" ? "Once you settle a reminder it moves here for your records." : "Track shared dinners, rent splits and freelance payments so nobody forgets."}
              action={scope !== "settled" ? <Button size="sm" onClick={openAdd}><Plus /> Add a reminder</Button> : undefined}
              className="py-8"
            />
          ) : (
            <div className="space-y-2">
              {rows.map((rem) => {
                const meta = directionMeta[rem.direction];
                const Icon = meta.icon;
                const overdue = rem.status === "open" && daysUntil(rem.dueDate) < 0;
                const dueSoon = rem.status === "open" && daysUntil(rem.dueDate) >= 0 && daysUntil(rem.dueDate) <= 3;
                return (
                  <div key={rem.id} className={cn("flex flex-col gap-3 rounded-2xl border border-border/70 p-3.5 sm:flex-row sm:items-center", rem.status === "settled" && "bg-muted/20")}>
                    <Avatar name={rem.person} className="h-10 w-10" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-[13px] font-semibold">{rem.person}</p>
                        <Badge variant={meta.badge}><Icon /> {meta.label}</Badge>
                        {rem.status === "settled" ? (
                          <Badge variant="success">Settled</Badge>
                        ) : overdue ? (
                          <Badge variant="danger">Overdue</Badge>
                        ) : dueSoon ? (
                          <Badge variant="warning">Due soon</Badge>
                        ) : null}
                        {rem.paypalInvoiceId && (
                          <Badge variant="outline"><Mail /> Request sent</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {rem.note ? `${rem.note} · ` : ""}
                        {rem.status === "settled" ? "Settled" : relativeDue(rem.dueDate)}
                        {rem.email ? ` · ${rem.email}` : ""}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="tabular text-[15px] font-semibold">
                        <Money value={rem.direction === "owe" ? -rem.amount : rem.amount} currency={currency} signed={rem.status === "open"} />
                      </p>
                      <p className="text-[10.5px] text-muted-foreground">
                        {rem.status === "open" ? `Due ${fmtDate(rem.dueDate, "d MMM")}` : `Closed ${fmtDate(rem.dueDate, "d MMM")}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 sm:ml-1">
                      {rem.direction === "owed" && rem.status === "open" && (
                        <Button size="sm" variant="outline" onClick={() => openRequest(rem)}>
                          {rem.paypalInvoiceUrl ? <ExternalLink /> : <Mail />}
                          {rem.paypalInvoiceUrl ? "View request" : "Request"}
                        </Button>
                      )}
                      {rem.status === "open" ? (
                        <Button size="sm" variant="ghost" onClick={() => openSettle(rem)}><Check /> Settle</Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => { updateReminder(rem.id, { status: "open" }); toast.success("Reminder reopened"); }}><Undo2 /> Reopen</Button>
                      )}
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit reminder for ${rem.person}`} onClick={() => openEdit(rem)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete reminder for ${rem.person}`} onClick={() => setDeleteTarget(rem)}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <InfoNote className="mt-4" icon={<Sparkles />}>
        {live
          ? canInvoice
            ? "Live invoices are sent from the PayPal business account named in PAYPAL_BUSINESS_EMAILS. Settling a reminder here only updates your local ledger."
            : "Live invoices are limited to the app owner's PayPal business account. Copy the message and send it from your own PayPal account; settling a reminder only updates your local ledger."
          : "Demo requests are created in the PayPal sandbox and only work with a sandbox account — no real money moves. Settling here updates your local ledger; it doesn't transfer funds."}{" "}
        Suggestions are not financial advice.
      </InfoNote>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit reminder" : "Add a reminder"}</DialogTitle>
            <DialogDescription>Track money you owe or money owed to you, with an optional PayPal request for the other person.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rem-direction">Direction</Label>
                <Select value={direction} onValueChange={(v) => setDirection(v as Reminder["direction"])}>
                  <SelectTrigger id="rem-direction" aria-label="Reminder direction"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owe">I owe someone</SelectItem>
                    <SelectItem value="owed">Someone owes me</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rem-amount">Amount</Label>
                <MoneyInput id="rem-amount" value={amount} currency={currency} onChange={setAmount} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rem-person">Person</Label>
                <Input id="rem-person" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="e.g. Rohan Kapoor" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rem-email">Email (for PayPal requests)</Label>
                <Input id="rem-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rem-date">Due date</Label>
              <Input id="rem-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rem-note">Note</Label>
              <Textarea id="rem-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Concert ticket split" className="min-h-[70px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? "Save changes" : "Add reminder"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!settleTarget} onOpenChange={(open) => !open && setSettleTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settle with {settleTarget?.person}?</DialogTitle>
            <DialogDescription>
              {settleTarget
                ? `${formatMoney(settleTarget.amount, currency)} — ${settleTarget.direction === "owe" ? "you pay them" : "they pay you"}. Choose whether to record the money in your transactions.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <label htmlFor="rem-record-tx" className="flex items-start gap-2.5 rounded-xl border border-border/70 p-3 text-[12px]">
            <Checkbox id="rem-record-tx" checked={recordTx} onCheckedChange={(v) => setRecordTx(v === true)} className="mt-0.5" />
            <span>
              <span className="font-medium">Record it in transactions</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                {settleTarget?.direction === "owe" ? "Adds an expense for this payment." : "Adds income received from this person."} Turn off for bookkeeping-only settlement.
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleTarget(null)}>Cancel</Button>
            <Button onClick={confirmSettle}>Settle reminder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!requestFor}
        onOpenChange={(open) => {
          if (!open) {
            setRequestFor(null);
            setInvoiceResult(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payment request</DialogTitle>
            <DialogDescription>
              Ask {requestFor?.person} for {requestFor ? formatMoney(requestFor.amount, currency) : ""}.
              {!live && integration.mode === "simulated"
                ? " PayPal sandbox credentials aren't configured, so requests fall back to a simulated draft."
                : live
                  ? canInvoice
                    ? " Live requests are sent from the allowlisted PayPal business account."
                    : " Live requests are limited to the app owner's PayPal business account. Copy the message instead."
                  : " Requests are created in the PayPal sandbox."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <textarea
              aria-label="Payment request message"
              value={requestText}
              onChange={(e) => setRequestText(e.target.value)}
              rows={8}
              className="w-full resize-y rounded-xl border border-input bg-card px-3.5 py-3 text-[12.5px] leading-relaxed text-foreground shadow-sm focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            />
            {invoiceResult && (
              <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-[11.5px]">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={invoiceResult.simulated ? "secondary" : "success"}>
                    {invoiceResult.simulated ? "Simulated" : live ? "Live invoice" : "Sandbox invoice"}
                  </Badge>
                  <span className="font-medium tabular">{invoiceResult.invoiceId}</span>
                </div>
                <p className="mt-1 leading-relaxed text-muted-foreground">
                  {invoiceResult.simulated
                    ? "No PayPal credentials configured. Copy the message above or connect PayPal on the server."
                    : live
                      ? "Invoice created in live PayPal. Use the link to review or share it."
                      : "Invoice drafted in the PayPal sandbox. Use the link to review or share it."}
                </p>
                {invoiceResult.invoiceUrl && (
                  <a href={invoiceResult.invoiceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline">
                    Open invoice <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-[10.5px] text-muted-foreground">
              <ReceiptText className="h-3 w-3 shrink-0" />
              {live
                ? canInvoice
                  ? "This creates and sends a real invoice from the allowlisted business account. Settle the reminder when payment arrives."
                  : "Live invoices are unavailable from a personal PayPal login. Copy the message and send it from your own PayPal account; settle the reminder when you receive payment."
                : "Sandbox only — no real money moves. Settle the reminder when you receive payment."}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={copyRequest}><Copy /> Copy message</Button>
            <Button onClick={createInvoice} disabled={requesting || !requestFor?.email || !canInvoice}>
              {requesting ? <Spinner /> : <Mail />}
              {requesting ? "Creating…" : invoiceResult ? "Create another" : "Create PayPal request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete reminder for {deleteTarget?.person}?</DialogTitle>
            <DialogDescription>This removes the reminder from your list. Any transaction you already recorded stays intact.</DialogDescription>
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
