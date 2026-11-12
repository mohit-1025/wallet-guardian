import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Building2, CalendarClock, CheckCircle2, CreditCard,
  ExternalLink, FlaskConical, Landmark, Plus, RefreshCw, ShieldCheck, Sparkles, Wallet,
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
import {
  capturePayPalOrder, createPayPalOrder, fetchPayPalReporting,
  type PayPalOrderResult, type ReportingOverview,
} from "@/lib/paypal";
import { fmtDate } from "@/lib/dates";
import { formatMoney, parseToInr } from "@/lib/money";
import type { Account } from "@/lib/types";
import { cn } from "@/lib/utils";

type Mode = "topup" | "pay";

const ACCOUNT_META: Record<Account["type"], { label: string; icon: typeof Wallet }> = {
  paypal: { label: "PayPal wallet", icon: Wallet },
  bank: { label: "Bank account", icon: Landmark },
  card: { label: "Credit card", icon: CreditCard },
  wallet: { label: "Wallet", icon: Wallet },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isSimulatedId(id?: string) {
  return !!id && id.startsWith("SIM-");
}

function formatNative(value: number, code: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${code} ${value.toFixed(2)}`;
  }
}

export default function WalletPage() {
  const data = useAppData();
  const { session, topUpWallet, payPerson } = useApp();
  const { status, loading, refresh } = useIntegration();
  const currency = data.profile.currency;
  const live = session?.env === "live";
  const envName = live ? "live PayPal" : "the PayPal sandbox";

  const [mode, setMode] = useState<Mode | null>(null);
  const [amount, setAmount] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [payeeEmail, setPayeeEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<PayPalOrderResult | null>(null);
  const [receipt, setReceipt] = useState<{ orderId: string; captureId?: string; simulated: boolean; amountInr: number } | null>(null);
  const [filter, setFilter] = useState<"all" | "topup" | "payment">("all");
  const canReport = session?.provider !== "demo" && status.capabilities.businessReporting;
  const [report, setReport] = useState<ReportingOverview | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const loadReport = useCallback(async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      setReport(await fetchPayPalReporting());
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Could not read PayPal business reporting.");
    } finally {
      setReportLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canReport) {
      setReport(null);
      setReportError(null);
      return;
    }
    void loadReport();
  }, [canReport, loadReport]);

  const paypalTx = useMemo(
    () => data.transactions.filter((t) => t.source === "paypal" || t.source === "autopay").slice(0, 12),
    [data.transactions],
  );
  const filteredTx = paypalTx.filter((t) => (filter === "all" ? true : filter === "topup" ? t.transfer : !t.transfer));

  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthTx = data.transactions.filter((t) => (t.source === "paypal" || t.source === "autopay") && t.date.startsWith(thisMonth));
  const monthIn = monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const monthOut = monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);

  const bank = data.accounts.find((a) => a.type === "bank");
  const card = data.accounts.find((a) => a.type === "card");
  const upcomingAutopay = data.scheduledPayments.filter((p) => p.status === "active").length;

  const presets = currency === "INR" ? [500, 1000, 2500, 5000] : [10, 25, 50, 100];

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

  async function finalize(current: PayPalOrderResult, amt: number) {
    const captured = await capturePayPalOrder(current.id);
    if (mode === "topup") {
      topUpWallet(amt, current.id, captured.captureId);
    } else {
      payPerson({ amountInr: amt, name: payeeName.trim(), email: payeeEmail.trim(), note: note.trim(), orderId: current.id, captureId: captured.captureId });
    }
    setReceipt({ orderId: current.id, captureId: captured.captureId, simulated: current.simulated || captured.simulated, amountInr: amt });
    toast.success(mode === "topup" ? "Money added to your PayPal wallet" : `Payment sent to ${payeeName.trim()}`, {
      description:
        current.simulated || captured.simulated
          ? "Sandbox simulation — no real money moved."
          : live
            ? "Captured in live PayPal and recorded in your ledger."
            : "Completed in the PayPal sandbox.",
    });
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
      if (amt > data.profile.walletBalance) {
        toast.error("That's more than your PayPal balance. Add money first.");
        return;
      }
    }
    setBusy(true);
    try {
      const created = await createPayPalOrder({
        amountInr: amt,
        intent: "CAPTURE",
        description: mode === "topup" ? "Wallet Guardian wallet top-up" : `Payment to ${payeeName.trim()}`,
      });
      if (created.approvalUrl && !created.simulated) {
        setOrder(created);
        toast.info(`Approve the order in ${envName}, then capture it here.`);
        return;
      }
      await finalize(created, amt);
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
      await finalize(order, amt);
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
        description={`Move money, pay people, and see every PayPal-linked transaction with its order and capture IDs — ${envName}.`}
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
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">PayPal wallet balance</p>
              <p className="mt-1.5 text-[32px] font-semibold leading-none tracking-tight tabular sm:text-[38px]">
                <Money value={data.profile.walletBalance} currency={currency} />
              </p>
              <p className="mt-2 text-[12px] text-white/70">{data.profile.email}</p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[10.5px] font-semibold backdrop-blur">
                {live ? <ShieldCheck className="h-3 w-3" /> : <FlaskConical className="h-3 w-3" />}
                {live ? "Live PayPal" : status.configured ? "Sandbox" : "Simulated"}
              </span>
              <span className="text-[10px] text-white/60">{live ? "Real money · approve each order" : "No real money moves"}</span>
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
                {live ? <ShieldCheck className="h-4 w-4" /> : <FlaskConical className="h-4 w-4" />}
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
            {session?.provider !== "demo" && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Account</span>
                  <span className="max-w-[190px] truncate font-medium" title={session?.email}>{session?.email}</span>
                </div>
                {session?.payerId && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Payer ID</span>
                    <span className="max-w-[150px] truncate font-mono text-[10.5px]" title={session.payerId}>
                      {session.payerId}
                    </span>
                  </div>
                )}
              </>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Mode</span>
              <Badge variant={live || status.configured ? "success" : "warning"}>
                {live ? "Live account connected" : status.configured ? "Sandbox keys connected" : "Simulation"}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Client ID</span>
              <span className="max-w-[150px] truncate font-mono text-[10.5px]" title={status.clientId ?? undefined}>
                {status.clientId ? `${status.clientId.slice(0, 10)}…` : "not configured"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Payouts</span>
              <span className="font-medium">{status.payoutsEnabled ? "Enabled" : live ? "Not enabled" : "Simulated fallback"}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Environment</span>
              <span className="font-medium">{live ? "api-m.paypal.com" : "api-m.sandbox"}</span>
            </div>
          </div>
          <div className="mt-auto space-y-2 pt-4">
            <InfoNote className="text-[11px]">
              {live
                ? "Orders charge the PayPal account you signed in with, and each one needs your approval. Business payouts and invoices only work for the allowlisted business account. Secret keys never reach the browser."
                : status.configured
                  ? "The demo calls the PayPal sandbox from the server. Secret keys never reach the browser."
                  : "No sandbox credentials detected, so every demo transfer is simulated and clearly labelled. Add sandbox keys to use the sandbox API."}
            </InfoNote>
            {session?.provider !== "demo" && (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Balance and activity here are your local ledger. PayPal does not share a personal account's balance or transaction history with this app.
              </p>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Bank balance", value: bank?.balance ?? 0, sub: bank?.name ?? "No bank linked", icon: Landmark, tone: "text-foreground" },
          { label: "Card balance", value: card?.balance ?? 0, sub: card?.name ?? "No card linked", icon: CreditCard, tone: (card?.balance ?? 0) < 0 ? "text-danger" : "text-foreground" },
          { label: "Active autopays", value: upcomingAutopay, sub: upcomingAutopay ? "Scheduled PayPal payouts" : "Nothing scheduled", icon: CalendarClock, tone: "text-foreground", money: false },
        ].map((stat) => (
          <Card key={stat.label} className="flex items-center gap-3 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/70 text-muted-foreground"><stat.icon className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</p>
              <p className={cn("mt-0.5 text-[17px] font-semibold tabular", stat.tone)}>
                {stat.money === false ? stat.value : <Money value={stat.value} currency={currency} />}
              </p>
              <p className="truncate text-[10.5px] text-muted-foreground">{stat.sub}</p>
            </div>
          </Card>
        ))}
      </div>

      {canReport && (
        <Card className="mt-4">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                <Building2 className="h-3.5 w-3.5" />
              </span>
              <div>
                <CardTitle>PayPal business account</CardTitle>
                <p className="text-[11px] text-muted-foreground">Reporting API · last 30 days · app credentials</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{report?.env === "live" ? "Live" : "Sandbox"}</Badge>
              <Button variant="ghost" size="icon-sm" onClick={loadReport} disabled={reportLoading} aria-label="Refresh business reporting">
                {reportLoading ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {reportError ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-[11.5px] leading-relaxed text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                {reportError}
              </div>
            ) : !report ? (
              <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                <Spinner /> Reading balances and transactions…
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-5">
                <div className="space-y-2 lg:col-span-2">
                  {report.balances.length === 0 && (
                    <p className="text-[11.5px] text-muted-foreground">PayPal returned no balances for this account.</p>
                  )}
                  {report.balances.map((balance) => (
                    <div key={balance.currency} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {balance.currency} balance
                        </span>
                        <Badge variant="secondary">{balance.currency}</Badge>
                      </div>
                      <p className="mt-1 text-[18px] font-semibold tabular">{formatNative(balance.total, balance.currency)}</p>
                      <p className="mt-1 text-[10.5px] text-muted-foreground tabular">
                        Available {formatNative(balance.available, balance.currency)}
                        {balance.withheld > 0 ? ` · Withheld ${formatNative(balance.withheld, balance.currency)}` : ""}
                      </p>
                    </div>
                  ))}
                  {report.accountId && (
                    <p className="truncate font-mono text-[10px] text-muted-foreground">account {report.accountId}</p>
                  )}
                </div>
                <div className="lg:col-span-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11.5px] font-semibold">Recent transactions</p>
                    <span className="text-[10.5px] text-muted-foreground">{report.totalTransactions} total</span>
                  </div>
                  {report.transactions.length === 0 ? (
                    <p className="mt-2 text-[11.5px] text-muted-foreground">
                      No transactions in {report.range.start} → {report.range.end}. Transaction Search can lag by a few hours.
                    </p>
                  ) : (
                    <div className="mt-1 divide-y divide-border/60">
                      {report.transactions.slice(0, 8).map((tx) => (
                        <div key={tx.id} className="flex items-start gap-3 py-2.5 first:pt-1 last:pb-0">
                          <span className={cn(
                            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                            tx.outgoing ? "bg-muted/80 text-muted-foreground" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
                          )}>
                            {tx.outgoing ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12px] font-semibold">{tx.subject || tx.payerName || "PayPal transaction"}</p>
                            <p className="truncate text-[10.5px] text-muted-foreground">
                              {tx.date ? fmtDate(tx.date.slice(0, 10), "d MMM yyyy") : "—"}
                              {tx.payerEmail ? ` · ${tx.payerEmail}` : ""} · {tx.status || tx.eventCode}
                            </p>
                          </div>
                          <span className={cn("text-[12px] font-semibold tabular", tx.outgoing ? "text-foreground" : "text-success")}>
                            {tx.outgoing ? "−" : "+"}
                            {formatNative(Math.abs(tx.amount), tx.currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">
              Business reporting uses the server's app credentials and reads the PayPal business account that owns this app — not the
              personal account you signed in with. It is read-only and never merged into your Wallet Guardian ledger.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary"><Wallet className="h-3.5 w-3.5" /></span>
              <CardTitle>Linked accounts</CardTitle>
            </div>
            <Badge variant="outline"><ArrowRightLeft /> Local ledger</Badge>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.accounts.map((account) => {
              const meta = ACCOUNT_META[account.type];
              const Icon = meta.icon;
              return (
                <div key={account.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/40">
                  <span className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    account.type === "paypal" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" : "bg-muted/80 text-muted-foreground",
                  )}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold">{account.name}</p>
                    <p className="text-[10.5px] text-muted-foreground">{meta.label}</p>
                  </div>
                  <Money value={account.balance} currency={currency} signed={account.balance < 0} className={cn("text-[13px] font-semibold", account.balance < 0 && "text-danger")} />
                </div>
              );
            })}
            <div className="pt-2">
              <Button variant="soft" size="sm" className="w-full justify-center" onClick={() => openCheckout("topup")}>
                <Plus /> Top up PayPal wallet
              </Button>
            </div>
            <p className="px-2 pt-2 text-[10.5px] leading-relaxed text-muted-foreground">
              Bank and card rows are part of this demo profile. Top-ups, payments and autopay runs change the PayPal balance.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary"><ArrowRightLeft className="h-3.5 w-3.5" /></span>
              <div>
                <CardTitle>PayPal activity</CardTitle>
                <p className="text-[11px] text-muted-foreground">Top-ups and payments with PayPal references</p>
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
                icon={<ArrowRightLeft />}
                title={filter === "all" ? "No PayPal activity yet" : filter === "topup" ? "No top-ups yet" : "No payments yet"}
                description="Add money or pay someone to see the order and capture IDs recorded here."
                action={<Button size="sm" onClick={() => openCheckout(filter === "topup" ? "topup" : "pay")}><Plus /> {filter === "topup" ? "Add money" : "Send a payment"}</Button>}
                className="py-8"
              />
            ) : (
              <div className="divide-y divide-border/60">
                {filteredTx.map((tx) => {
                  const topup = !!tx.transfer;
                  const simulated = isSimulatedId(tx.paypalOrderId) || isSimulatedId(tx.paypalCaptureId);
                  return (
                    <div key={tx.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <span className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        topup ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-muted/80 text-muted-foreground",
                      )}>
                        {topup ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate text-[12.5px] font-semibold">{tx.merchant}</p>
                          <Badge variant={simulated ? "secondary" : "success"}>{simulated ? "Simulated" : live ? "Live" : "Sandbox"}</Badge>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {fmtDate(tx.date, "d MMM yyyy")}
                          {tx.source === "autopay" ? " · Autopay payout" : topup ? " · Wallet top-up" : " · PayPal payment"}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80">
                          order {tx.paypalOrderId ?? "—"}
                          {tx.paypalCaptureId ? ` · capture ${tx.paypalCaptureId}` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <Money
                          value={topup ? tx.amount : -tx.amount}
                          currency={currency}
                          signed
                          className={cn("text-[13px] font-semibold", topup ? "text-success" : "text-foreground")}
                        />
                        <p className="text-[10px] text-muted-foreground">{topup ? "In" : "Out"}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Link to="/app/autopay" className="group flex items-center gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-soft transition-colors hover:border-primary/30">
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
        {live
          ? "Signed in with PayPal: orders, captures and payouts run against live PayPal for your account, and each order still needs your approval on PayPal. Top-ups are transfers and stay out of income analytics."
          : "Demo mode: orders, captures and payouts target PayPal's sandbox and are simulated when credentials aren't configured. Top-ups are transfers and stay out of income analytics."}{" "}
        Suggestions are not financial advice.
      </InfoNote>

      <Dialog open={!!mode} onOpenChange={(open) => !open && closeCheckout()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{receipt ? (mode === "topup" ? "Money added" : "Payment sent") : dialogTitle}</DialogTitle>
            <DialogDescription>
              {receipt
                ? "Here's the PayPal receipt. It's already reflected in your local ledger."
                : mode === "topup"
                  ? live
                    ? "Bring money into your Wallet Guardian ledger after approving the order on PayPal."
                    : "Pull sandbox money into your PayPal wallet. Nothing leaves the demo environment."
                  : live
                    ? "Send a real payment to a PayPal email. You approve the amount on PayPal before anything is charged."
                    : "Send sandbox money to a PayPal email. Your PayPal wallet balance is debited."}
            </DialogDescription>
          </DialogHeader>

          {receipt ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/30 p-3.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><CheckCircle2 className="h-5 w-5" /></span>
                <div>
                  <p className="text-[13px] font-semibold">{mode === "topup" ? "Wallet top-up" : `Payment to ${payeeName || "payee"}`}</p>
                  <p className="text-[11px] text-muted-foreground">{formatMoney(receipt.amountInr, currency)} · {receipt.simulated ? "Simulated" : live ? "Live PayPal" : "PayPal sandbox"}</p>
                </div>
              </div>
              <dl className="space-y-2 rounded-xl border border-border/70 p-3.5 text-[11.5px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Order ID</dt>
                  <dd className="truncate font-mono text-[10.5px]">{receipt.orderId}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Capture ID</dt>
                  <dd className="truncate font-mono text-[10.5px]">{receipt.captureId ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">New wallet balance</dt>
                  <dd className="font-semibold tabular"><Money value={data.profile.walletBalance} currency={currency} /></dd>
                </div>
              </dl>
              <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                {receipt.simulated
                  ? "No PayPal credentials were configured, so this run was simulated. Add sandbox keys on the server to call the real API."
                  : live
                    ? "Completed against live PayPal. The amount was charged only after you approved the order."
                    : "Completed against the PayPal sandbox. No real money moved."}
              </p>
            </div>
          ) : order && !receipt ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-[11.5px] leading-relaxed text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                The order was created in {envName}. Approve it in PayPal, then come back and capture it. Order <span className="font-mono text-[10.5px]">{order.id}</span>.
              </div>
              <div className="flex flex-col gap-2">
                {order.approvalUrl && (
                  <Button variant="outline" asChild className="justify-center">
                    <a href={order.approvalUrl} target="_blank" rel="noreferrer">
                      <ExternalLink /> {live ? "Approve in PayPal" : "Approve in PayPal sandbox"}
                    </a>
                  </Button>
                )}
                <Button onClick={capturePending} disabled={busy} className="justify-center">
                  {busy ? <Spinner /> : <CheckCircle2 />} {busy ? "Capturing…" : "I approved it — capture"}
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
                    Available: <span className="font-semibold text-foreground"><Money value={data.profile.walletBalance} currency={currency} /></span>
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
                {live ? <ShieldCheck className="h-3 w-3 shrink-0" /> : <FlaskConical className="h-3 w-3 shrink-0" />}
                {live
                  ? "Live PayPal — you approve the exact amount on PayPal before it is charged."
                  : `Sandbox only — no real money moves. ${status.configured ? "Using the server's sandbox credentials." : "Credentials aren't configured, so this will be simulated."}`}
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
                <Button onClick={submit} disabled={busy}>
                  {busy ? <Spinner /> : mode === "topup" ? <Plus /> : <ArrowUpRight />}
                  {busy ? "Contacting PayPal…" : mode === "topup" ? "Add money" : "Send payment"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
