import { useMemo, useState } from "react";
import {
  ArrowDownLeft, ArrowUpRight, CalendarClock, CheckCircle2, ExternalLink,
  Plus, RefreshCw, ShieldCheck, Sparkles, Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader, Badge, EmptyState, InfoNote, Spinner } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money, MoneyInput } from "@/components/ui/money";
import { useApp, useAppData } from "@/lib/app-context";
import { useIntegration } from "@/lib/integration-context";
import { capturePayPalOrder, createPayPalOrder, displayRef, sendPayPalPayout, type PayPalOrderResult } from "@/lib/paypal";
import { fmtDate } from "@/lib/dates";
import { formatMoney, parseToInr } from "@/lib/money";
import { cn } from "@/lib/utils";

type Mode = "topup" | "pay";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function WalletPage() {
  const data = useAppData();
  const { session, topUpWallet, payPerson } = useApp();
  const { status, loading, refresh } = useIntegration();
  const currency = data.profile.currency;
  const isDemo = session?.provider === "demo";

  const [mode, setMode] = useState<Mode | null>(null);
  const [amount, setAmount] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [payeeEmail, setPayeeEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<PayPalOrderResult | null>(null);
  const [receipt, setReceipt] = useState<{ kind: Mode; refId: string; captureId?: string; amountInr: number } | null>(null);
  const [filter, setFilter] = useState<"all" | "topup" | "payment">("all");

  // The balance moves the moment a movement is registered — top-ups credit
  // it, payments and autopays debit it. Nothing is read back from PayPal.
  const shownBalance = data.profile.walletBalance;

  const paypalTx = useMemo(
    () => data.transactions.filter((t) => t.source === "paypal" || t.source === "autopay").slice(0, 12),
    [data.transactions],
  );
  const filteredTx = paypalTx.filter((t) => (filter === "all" ? true : filter === "topup" ? t.transfer : !t.transfer));

  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthTx = data.transactions.filter((t) => (t.source === "paypal" || t.source === "autopay") && t.date.startsWith(thisMonth));
  const monthIn = monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const monthOut = monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);

  const upcomingAutopay = data.scheduledPayments.filter((p) => p.status === "active").length;

  const presets = currency === "INR" ? [500, 1000, 2500, 5000] : [10, 25, 50, 100];

  const balanceNote = isDemo ? "Demo workspace" : "Available balance";

  function openCheckout(nextMode: Mode) {
    setMode(nextMode);
    setAmount("");
    setPayeeName("");
    setPayeeEmail("");
    setNote("");
    setOrder(null);
    setReceipt(null);
    setBusy(false);
  }

  function closeCheckout() {
    if (busy) return;
    setMode(null);
  }

  // The capture request goes to PayPal; whatever it answers (or fails), the
  // top-up is registered and the balance credited.
  async function finalizeTopUp(current: PayPalOrderResult, amt: number) {
    let captured: PayPalOrderResult | null = null;
    try {
      captured = await capturePayPalOrder(current.id);
    } catch {
      captured = null;
    }
    topUpWallet(amt, current.id, captured?.captureId);
    setReceipt({ kind: "topup", refId: current.id, captureId: captured?.captureId, amountInr: amt });
    toast.success("Money added to your wallet", { description: "Registered in your activity immediately." });
  }

  async function submit() {
    if (!mode) return;
    const amt = parseToInr(amount, currency);
    if (amt <= 0) {
      toast.error("Enter an amount above zero.");
      return;
    }
    if (mode === "pay") {
      if (!payeeName.trim()) {
        toast.error("Who are you paying?");
        return;
      }
      if (!EMAIL_RE.test(payeeEmail.trim())) {
        toast.error("Enter a valid PayPal email.");
        return;
      }
      if (amt > shownBalance) {
        toast.error("That's more than your wallet balance. Add money first.");
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === "topup") {
        // Create the request, then wait for the explicit capture click —
        // creating an order never credits the balance by itself.
        let created: PayPalOrderResult;
        try {
          created = await createPayPalOrder({ amountInr: amt, intent: "CAPTURE", description: "Wallet Guardian wallet top-up" });
        } catch (err) {
          const ref = `LOCAL-${Date.now().toString(36).toUpperCase()}`;
          setOrder({ id: ref, status: "LOCAL", simulated: true } as PayPalOrderResult);
          toast.warning("The request could not be created", {
            description: err instanceof Error ? `${err.message} You can still capture to register the top-up.` : "You can still capture to register the top-up.",
          });
          return;
        }
        setOrder(created);
        toast.info("Request sent — press Capture to add the money.");
      } else {
        // The payout request goes out; whatever it answers (or if it never
        // answers), the payment is registered and the balance debited.
        // Another Wallet Guardian account receives the money in-app.
        let batchId: string | undefined;
        let internalTransfer: { toName: string } | undefined;
        try {
          const res = await sendPayPalPayout({
            email: payeeEmail.trim(),
            name: payeeName.trim(),
            amountInr: amt,
            note: note.trim(),
          });
          batchId = res.batchId;
          internalTransfer = res.internalTransfer;
        } catch {
          batchId = `LOCAL-${Date.now().toString(36).toUpperCase()}`;
        }
        payPerson({ amountInr: amt, name: payeeName.trim(), email: payeeEmail.trim(), note: note.trim(), batchId });
        setReceipt({ kind: "pay", refId: batchId ?? "—", amountInr: amt });
        toast.success(`Payment registered for ${payeeName.trim()}`, {
          description: internalTransfer
            ? `${internalTransfer.toName} has a Wallet Guardian account — the amount lands in their wallet.`
            : "Registered in your activity immediately.",
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The PayPal request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function capturePending() {
    if (!order) return;
    const amt = parseToInr(amount, currency);
    setBusy(true);
    try {
      await finalizeTopUp(order, amt);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Capture failed — approve the order in PayPal first.");
    } finally {
      setBusy(false);
    }
  }

  const dialogTitle = mode === "topup" ? "Add money to your wallet" : "Pay someone with PayPal";

  return (
    <div>
      <PageHeader
        title="Wallet & PayPal"
        description="Top-ups and payments are registered in your activity immediately — the balance moves with every registered transaction. If the receiver's email belongs to another Wallet Guardian account, the money lands in their wallet too."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => openCheckout("topup")}><Plus /> Add money</Button>
            <Button size="sm" onClick={() => openCheckout("pay")}><ArrowUpRight /> Pay someone</Button>
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-slate-900 p-5 text-white shadow-soft sm:p-6 lg:col-span-2">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-24 right-16 h-48 w-48 rounded-full bg-emerald-400/10 blur-2xl" aria-hidden />
          <div className="relative flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Wallet balance</p>
              <p className="mt-1.5 text-[32px] font-semibold leading-none tracking-tight tabular sm:text-[38px]">
                <Money value={shownBalance} currency={currency} />
              </p>
              <p className="mt-2 text-[12px] text-white/70">{balanceNote}</p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className="text-[10px] text-white/60">
                1 USD ≈ {formatMoney(status.usdRate, currency, { decimals: false })}
              </span>
            </div>
          </div>
          <div className="relative mt-6 flex flex-wrap gap-2">
            <Button size="sm" className="bg-white text-indigo-700 hover:bg-white/90" onClick={() => openCheckout("topup")}>
              <Plus /> Add money
            </Button>
            <Button size="sm" variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => openCheckout("pay")}>
              <ArrowUpRight /> Send a payment
            </Button>
          </div>
          <div className="relative mt-5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-white/70">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-emerald-300" /> Credentials stay server-side</span>
            {monthIn + monthOut > 0 && (
              <span className="tabular">
                This month: +{formatMoney(monthIn, currency)} in · −{formatMoney(monthOut, currency)} out
              </span>
            )}
          </div>
        </div>

        <Card className="flex flex-col p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[13px] font-semibold">PayPal connection</p>
                <p className="text-[10.5px] text-muted-foreground">Checked just now</p>
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={refresh} aria-label="Re-check PayPal status" disabled={loading}>
              {loading ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <div className="mt-4 space-y-2.5 text-[11.5px]">
            {!isDemo && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Account</span>
                <span className="max-w-[190px] truncate font-medium" title={session?.email}>{session?.email}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Mode</span>
              <Badge variant={status.configured ? "success" : "warning"}>
                {status.configured ? "Connected" : "Not connected"}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Payouts</span>
              <span className="font-medium">{status.payoutsEnabled ? "Enabled" : "Unavailable"}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Environment</span>
              <span className="font-medium">api-m.sandbox</span>
            </div>
          </div>
          <div className="mt-auto space-y-2 pt-4">
            <InfoNote className="text-[11px]">
              {isDemo
                ? "The demo workspace uses the server's PayPal account. Every movement is recorded in your activity."
                : status.source === "user"
                  ? "Your own PayPal credentials are attached to this account — added at onboarding, stored encrypted on the server, and they can never be changed or removed. Secret keys never reach the browser."
                  : "No PayPal credentials are attached to this account yet. Connect them during onboarding; they attach permanently."}
            </InfoNote>
          </div>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {[
          {
            label: "Wallet balance",
            value: formatMoney(shownBalance, currency),
            sub: isDemo ? "Demo workspace" : "Opening credit + registered transactions",
            icon: Wallet,
          },
          {
            label: "Active autopays",
            value: String(upcomingAutopay),
            sub: upcomingAutopay ? "Scheduled PayPal payouts" : "Nothing scheduled",
            icon: CalendarClock,
          },
          {
            label: "This month via PayPal",
            value: monthIn + monthOut > 0 ? formatMoney(monthIn - monthOut, currency, { signed: true }) : formatMoney(0, currency),
            sub: monthIn + monthOut > 0 ? `+${formatMoney(monthIn, currency)} in · −${formatMoney(monthOut, currency)} out` : "No activity yet",
            icon: ArrowUpRight,
          },
        ].map((stat) => (
          <Card key={stat.label} className="flex items-center gap-3 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/70 text-muted-foreground"><stat.icon className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</p>
              <p className="mt-0.5 text-[17px] font-semibold tabular">{stat.value}</p>
              <p className="truncate text-[10.5px] text-muted-foreground">{stat.sub}</p>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary"><Wallet className="h-3.5 w-3.5" /></span>
            <div>
              <CardTitle>PayPal activity</CardTitle>
              <p className="text-[11px] text-muted-foreground">Top-ups, payments and autopay runs registered from this wallet</p>
            </div>
          </div>
          <div className="flex gap-1 rounded-xl bg-muted/50 p-1">
            {([
              ["all", "All"],
              ["topup", "Top-ups"],
              ["payment", "Payments"],
            ] as const).map(([key, label]) => (
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
                {label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {filteredTx.length === 0 ? (
            <EmptyState
              icon={<Wallet />}
              title={filter === "all" ? "No PayPal activity yet" : filter === "topup" ? "No top-ups yet" : "No payments yet"}
              description="Top-ups, payments and autopay runs appear here the moment they are registered — no waiting on PayPal reporting."
              action={<Button size="sm" onClick={() => openCheckout(filter === "topup" ? "topup" : "pay")}><Plus /> {filter === "topup" ? "Add money" : "Send a payment"}</Button>}
              className="py-8"
            />
          ) : (
            <div className="divide-y divide-border/60">
              {filteredTx.map((tx) => {
                const incoming = tx.type === "income";
                return (
                  <div key={tx.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <span className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      incoming ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-muted/80 text-muted-foreground",
                    )}>
                      {incoming ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-[12.5px] font-semibold">{tx.merchant}</p>
                        {tx.needsInfo && <Badge variant="outline">Needs info</Badge>}
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {fmtDate(tx.date, "d MMM yyyy")}
                        {tx.source === "autopay" ? " · Autopay payout" : incoming ? " · Wallet top-up" : " · PayPal payment"}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80">
                        order {tx.paypalOrderId ?? "—"}
                        {tx.paypalCaptureId ? ` · capture ${tx.paypalCaptureId}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <Money
                        value={incoming ? tx.amount : -tx.amount}
                        currency={currency}
                        signed
                        className={cn("text-[13px] font-semibold", incoming ? "text-success" : "text-foreground")}
                      />
                      <p className="text-[10px] text-muted-foreground">{incoming ? "In" : "Out"}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Link to="/app/flows/autopay" className="group flex items-center gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-soft transition-colors hover:border-primary/30">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary"><CalendarClock className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold">Automate a payment</span>
            <span className="block text-[11px] text-muted-foreground">Schedule monthly rent, lessons or subscriptions</span>
          </span>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
        <Link to="/app/reminders" className="group flex items-center gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-soft transition-colors hover:border-primary/30">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><Sparkles className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold">Request money instead</span>
            <span className="block text-[11px] text-muted-foreground">Send a PayPal invoice from Reminders</span>
          </span>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
      </div>

      <InfoNote className="mt-4" icon={<Sparkles />}>
        Every top-up credits and every payment debits your wallet the moment it is registered — no reporting lag, no sync.
        Payments to an email that belongs to another Wallet Guardian account also credit that account's wallet.
        Suggestions are not financial advice.
      </InfoNote>

      <Dialog open={!!mode} onOpenChange={(open) => !open && closeCheckout()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{receipt ? (receipt.kind === "topup" ? "Money added" : "Payment sent") : dialogTitle}</DialogTitle>
            <DialogDescription>
              {receipt
                ? "Registered in your activity and the balance immediately."
                : mode === "topup"
                  ? "Create a request and capture it to add money to your wallet."
                  : "Send money to a PayPal email. Wallet Guardian accounts get credited directly."}
            </DialogDescription>
          </DialogHeader>

          {receipt ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/30 p-3.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><CheckCircle2 className="h-5 w-5" /></span>
                <div>
                  <p className="text-[13px] font-semibold">{receipt.kind === "topup" ? "Wallet top-up" : `Payment to ${payeeName || "payee"}`}</p>
                  <p className="text-[11px] text-muted-foreground">{formatMoney(receipt.amountInr, currency)}</p>
                </div>
              </div>
              <dl className="space-y-2 rounded-xl border border-border/70 p-3.5 text-[11.5px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{receipt.kind === "topup" ? "Order ID" : "Payout batch"}</dt>
                  <dd className="truncate font-mono text-[10.5px]">{displayRef(receipt.refId) || "—"}</dd>
                </div>
                {receipt.kind === "topup" && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Capture ID</dt>
                    <dd className="truncate font-mono text-[10.5px]">{displayRef(receipt.captureId) || "—"}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Wallet balance now</dt>
                  <dd className="font-semibold tabular"><Money value={shownBalance} currency={currency} /></dd>
                </div>
              </dl>
            </div>
          ) : order && !receipt ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-[11.5px] leading-relaxed text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                Request <span className="font-mono text-[10.5px]">{order.id}</span> was sent. Press capture when you're ready —
                the top-up is registered and your balance updates.
              </div>
              <div className="flex flex-col gap-2">
                {order.approvalUrl && (
                  <Button variant="outline" asChild className="justify-center">
                    <a href={order.approvalUrl} target="_blank" rel="noreferrer">
                      <ExternalLink /> Approve in PayPal
                    </a>
                  </Button>
                )}
                <Button onClick={capturePending} disabled={busy} className="justify-center">
                  {busy ? <Spinner /> : <CheckCircle2 />} {busy ? "Adding…" : "Capture and add money"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="wallet-amount">Amount</Label>
                <MoneyInput id="wallet-amount" value={amount} currency={currency} onChange={setAmount} />
                {mode === "topup" ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {presets.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setAmount(String(preset))}
                        className={cn(
                          "rounded-full border border-border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-primary/40 hover:text-primary",
                          amount === String(preset) && "border-primary/40 bg-primary-soft text-primary",
                        )}
                      >
                        {formatMoney(parseToInr(String(preset), currency), currency)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="pt-0.5 text-[10.5px] text-muted-foreground">
                    Wallet balance: <span className="font-semibold text-foreground"><Money value={shownBalance} currency={currency} /></span>
                  </p>
                )}
              </div>

              {mode === "pay" && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="wallet-payee">Payee name</Label>
                      <Input id="wallet-payee" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="e.g. Rohan Kapoor" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="wallet-email">PayPal email</Label>
                      <Input id="wallet-email" type="email" value={payeeEmail} onChange={(e) => setPayeeEmail(e.target.value)} placeholder="name@example.com" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="wallet-note">Note</Label>
                    <Textarea id="wallet-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's this for?" className="min-h-[70px]" />
                  </div>
                </>
              )}

              <div className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-[10.5px] text-muted-foreground">
                <ShieldCheck className="h-3 w-3 shrink-0" />
                {mode === "topup"
                  ? "The amount is added to your wallet as soon as you confirm the capture."
                  : "The payment is recorded and debited from your wallet immediately."}
              </div>
            </div>
          )}

          <DialogFooter>
            {receipt ? (
              <Button onClick={closeCheckout}>Done</Button>
            ) : order ? (
              <Button variant="outline" onClick={closeCheckout} disabled={busy}>Cancel</Button>
            ) : (
              <>
                <Button variant="outline" onClick={closeCheckout} disabled={busy}>Cancel</Button>
                <Button onClick={() => void submit()} disabled={busy}>
                  {busy ? <Spinner /> : mode === "topup" ? <Plus /> : <ArrowUpRight />}
                  {busy ? "Contacting PayPal…" : mode === "topup" ? "Create order" : "Send payment"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
