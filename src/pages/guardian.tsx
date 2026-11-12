import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Check, CheckCircle2, Clock, CreditCard, Database,
  Eraser, FileText, FlaskConical, MessageCircle, Send, ShieldCheck, Sparkles, Target, X,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader, Badge, EmptyState, InfoNote, Spinner } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money, MoneyInput } from "@/components/ui/money";
import { useApp, useAppData } from "@/lib/app-context";
import { useIntegration } from "@/lib/integration-context";
import {
  authorizePayPalOrder, captureAuthorization, createPayPalOrder, voidAuthorization, type PayPalOrderResult,
} from "@/lib/paypal";
import { advisePurchase, answerQuestion, GUARDIAN_PROMPTS, type PurchaseAdvice } from "@/lib/guardian";
import { buildInsights } from "@/lib/finance";
import { addDaysISO, daysUntil, fmtDate, todayISO } from "@/lib/dates";
import { formatMoney, parseToInr } from "@/lib/money";
import type { AiInsight, PatientCheckout } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "insights" | "ask" | "buy";
type SeverityFilter = "all" | AiInsight["severity"];

const TABS: { key: Tab; label: string; icon: typeof Sparkles }[] = [
  { key: "insights", label: "Insights", icon: Sparkles },
  { key: "ask", label: "Ask Guardian", icon: MessageCircle },
  { key: "buy", label: "Purchase guard", icon: CreditCard },
];

const SEVERITY_META: Record<AiInsight["severity"], {
  label: string;
  badge: "danger" | "warning" | "default" | "success";
  ring: string;
  iconTone: string;
  icon: typeof Sparkles;
}> = {
  critical: { label: "Critical", badge: "danger", ring: "border-danger/20 bg-danger-soft/50", iconTone: "text-danger", icon: AlertTriangle },
  warning: { label: "Warning", badge: "warning", ring: "border-warning/25 bg-warning-soft/40", iconTone: "text-warning", icon: AlertTriangle },
  info: { label: "Insight", badge: "default", ring: "border-primary/15 bg-primary-soft/40", iconTone: "text-primary", icon: Sparkles },
  positive: { label: "On track", badge: "success", ring: "border-success/20 bg-success-soft/40", iconTone: "text-success", icon: ShieldCheck },
};

const VERDICT_META: Record<PurchaseAdvice["verdict"], { label: string; badge: "success" | "warning" | "danger"; tone: string }> = {
  comfortable: { label: "Comfortable", badge: "success", tone: "text-success" },
  tight: { label: "Tight", badge: "warning", tone: "text-warning" },
  "not-now": { label: "Wait", badge: "danger", tone: "text-danger" },
};

const CHECKOUT_META: Record<PatientCheckout["status"], { label: string; variant: "success" | "warning" | "secondary" | "danger" }> = {
  authorized: { label: "Authorized", variant: "warning" },
  captured: { label: "Captured", variant: "success" },
  voided: { label: "Released", variant: "secondary" },
  expired: { label: "Expired", variant: "danger" },
};

const COOLING_OFF_DAYS = 7;

export default function GuardianPage() {
  const data = useAppData();
  const {
    dismissInsight, addMessage, clearMessages, addCheckout, updateCheckout,
    addTransaction, adjustWallet,
  } = useApp();
  const { status: integration } = useIntegration();
  const currency = data.profile.currency;
  const [searchParams] = useSearchParams();

  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get("tab");
    return t === "ask" || t === "buy" ? t : "insights";
  });
  const [severity, setSeverity] = useState<SeverityFilter>("all");

  const [chatInput, setChatInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [item, setItem] = useState(() => searchParams.get("item") ?? "");
  const [price, setPrice] = useState(() => searchParams.get("price") ?? "");
  const [categoryId, setCategoryId] = useState("cat_shopping");
  const [advice, setAdvice] = useState<PurchaseAdvice | null>(null);
  const advisorInputRef = useRef<HTMLInputElement>(null);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<"confirm" | "pending" | "done">("confirm");
  const [checkoutOrder, setCheckoutOrder] = useState<PayPalOrderResult | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState<PatientCheckout | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const [captureTarget, setCaptureTarget] = useState<PatientCheckout | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [releaseTarget, setReleaseTarget] = useState<PatientCheckout | null>(null);
  const [releasingId, setReleasingId] = useState<string | null>(null);

  const insights = useMemo(() => buildInsights(data, currency), [data, currency]);
  const filteredInsights = severity === "all" ? insights : insights.filter((i) => i.severity === severity);

  const messages = data.messages;
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const chatSuggestions = messages.length === 0 ? GUARDIAN_PROMPTS.slice(0, 4) : lastAssistant?.suggestions ?? [];

  const expenseCategories = data.categories.filter((c) => c.kind === "expense");

  const authorizedHolds = data.patientCheckouts.filter((c) => c.status === "authorized" && daysUntil(c.captureBy) >= 0);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length, thinking, tab]);

  function sendMessage(raw: string) {
    const question = raw.trim();
    if (!question || thinking) return;
    addMessage({ role: "user", content: question });
    setChatInput("");
    setThinking(true);
    window.setTimeout(() => {
      const answer = answerQuestion(question, data, currency);
      addMessage({
        role: "assistant",
        content: answer.text,
        sources: answer.sources,
        suggestions: answer.suggestions,
      });
      setThinking(false);
    }, 450);
  }

  function checkPurchase() {
    const amountInr = parseToInr(price, currency);
    if (!item.trim()) {
      toast.error("What are you thinking of buying?");
      return;
    }
    if (amountInr <= 0) {
      toast.error("Enter a price above zero.");
      return;
    }
    setAdvice(advisePurchase(item.trim(), amountInr, data, currency, categoryId === "none" ? undefined : categoryId));
  }

  function openCheckout() {
    if (!advice) return;
    const amountInr = parseToInr(price, currency);
    if (amountInr > data.profile.walletBalance) {
      toast.error("Not enough in your PayPal wallet", {
        description: "A hold needs wallet balance available for capture. Top up in Wallet & PayPal first.",
      });
      return;
    }
    setCheckoutOrder(null);
    setCheckoutResult(null);
    setCheckoutError(null);
    setCheckoutStep("confirm");
    setCheckoutOpen(true);
  }

  async function completeAuthorization(order: PayPalOrderResult) {
    const amountInr = parseToInr(price, currency);
    const authorization = await authorizePayPalOrder(order.id);
    const created = addCheckout({
      merchant: "PayPal sandbox",
      item: advice?.headline && item.trim() ? item.trim() : "Planned purchase",
      amount: amountInr,
      status: "authorized",
      authorizedAt: todayISO(),
      captureBy: addDaysISO(todayISO(), COOLING_OFF_DAYS),
      categoryId: categoryId === "none" ? "cat_shopping" : categoryId,
      paypalOrderId: order.id,
      authorizationId: authorization.authorizationId,
      simulated: order.simulated || authorization.simulated,
    });
    setCheckoutResult(created);
    setCheckoutStep("done");
    toast.success("Purchase authorized", {
      description: `Capture by ${fmtDate(created.captureBy, "d MMM yyyy")} — or release the hold now.`,
    });
  }

  async function startAuthorization() {
    if (!advice) return;
    const amountInr = parseToInr(price, currency);
    if (amountInr <= 0) {
      setCheckoutError("Enter a valid price before authorizing.");
      return;
    }
    if (amountInr > data.profile.walletBalance) {
      setCheckoutError(`Your wallet has ${formatMoney(data.profile.walletBalance, currency)}. Add money in Wallet & PayPal first.`);
      return;
    }
    setCheckoutBusy(true);
    setCheckoutError(null);
    try {
      const order = await createPayPalOrder({
        amountInr,
        intent: "AUTHORIZE",
        description: `Patient Checkout — ${item.trim() || "Planned purchase"}`,
      });
      if (order.approvalUrl && !order.simulated) {
        setCheckoutOrder(order);
        setCheckoutStep("pending");
        toast.info("Approve the authorization in the PayPal sandbox, then continue here.");
        return;
      }
      await completeAuthorization(order);
    } catch (err) {
      const message = err instanceof Error ? err.message : "The authorization could not be created.";
      setCheckoutError(message);
      toast.error(message);
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function approvePendingOrder() {
    if (!checkoutOrder) return;
    setCheckoutBusy(true);
    setCheckoutError(null);
    try {
      await completeAuthorization(checkoutOrder);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Authorization failed — make sure you approved the order in PayPal.";
      setCheckoutError(message);
      toast.error(message);
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function confirmCapture() {
    if (!captureTarget?.authorizationId) return;
    if (captureTarget.amount > data.profile.walletBalance) {
      toast.error("Not enough wallet balance to capture", { description: "Top up your PayPal wallet first." });
      return;
    }
    setCaptureBusy(true);
    try {
      const res = await captureAuthorization(captureTarget.authorizationId!);
      updateCheckout(captureTarget.id, { status: "captured", captureId: res.captureId });
      // The capture request went to the sandbox; whatever it answered, the
      // expense registers and the wallet is debited.
      adjustWallet(-captureTarget.amount);
      addTransaction({
        type: "expense",
        amount: captureTarget.amount,
        categoryId: captureTarget.categoryId ?? "cat_shopping",
        merchant: captureTarget.item,
        date: todayISO(),
        paymentMethod: "PayPal",
        notes: `Patient Checkout — authorized, then captured after the cooling-off hold${res.simulated ? " (simulated)" : ""}`,
        source: "paypal",
        paypalOrderId: captureTarget.paypalOrderId,
        paypalCaptureId: res.captureId,
        channel: "paypal",
      });
      toast.success("Payment captured", {
        description: res.simulated
          ? "Sandbox simulation — the expense is now in your transactions."
          : "Captured in the PayPal sandbox — the expense is now in your transactions.",
      });
      setCaptureTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Capture failed at PayPal.");
    } finally {
      setCaptureBusy(false);
    }
  }

  async function releaseHold(hold: PatientCheckout) {
    if (!hold.authorizationId) {
      updateCheckout(hold.id, { status: "voided" });
      toast.success("Hold released");
      return;
    }
    setReleasingId(hold.id);
    try {
      await voidAuthorization(hold.authorizationId);
      updateCheckout(hold.id, { status: "voided" });
      setReleaseTarget(null);
      toast.success("Authorization released", { description: "Nothing was captured — the hold no longer counts against your wallet." });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not release the authorization.");
    } finally {
      setReleasingId(null);
    }
  }

  function focusAdvisor() {
    setTab("buy");
    window.setTimeout(() => advisorInputRef.current?.focus(), 50);
  }

  const captureInsufficient = !!captureTarget && captureTarget.amount > data.profile.walletBalance;

  return (
    <div>
      <PageHeader
        title="AI Guardian"
        description="A grounded look at your money: what needs attention, answers that cite your own ledger, and a calmer way to buy."
        eyebrow={<Badge variant="default"><ShieldCheck /> Grounded in your data · not financial advice</Badge>}
        actions={<Button size="sm" variant="outline" onClick={focusAdvisor}><CreditCard /> Check a purchase</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-1 rounded-2xl border border-border/70 bg-card p-1 shadow-soft sm:inline-flex" role="tablist" aria-label="Guardian sections">
        {TABS.map((t) => {
          const Icon = t.icon;
          const count = t.key === "insights" ? insights.length : t.key === "buy" ? authorizedHolds.length : 0;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold transition-colors sm:flex-none",
                tab === t.key ? "bg-primary-soft text-accent-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {count > 0 && <span className="rounded-full bg-primary px-1.5 text-[9.5px] font-bold text-primary-foreground tabular">{count}</span>}
            </button>
          );
        })}
      </div>

      {tab === "insights" && (
        <div>
          <InfoNote className="mb-4" icon={<Database />}>
            Grounded in {data.transactions.length} transactions, {data.budgets.length} monthly budgets, {data.bills.length} bills and{" "}
            {data.subscriptions.length} subscriptions. Every number below traces back to your ledger — nothing is invented.
          </InfoNote>

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {([
              ["all", "All", insights.length],
              ["critical", "Critical", insights.filter((i) => i.severity === "critical").length],
              ["warning", "Warnings", insights.filter((i) => i.severity === "warning").length],
              ["info", "Insights", insights.filter((i) => i.severity === "info").length],
              ["positive", "On track", insights.filter((i) => i.severity === "positive").length],
            ] as const).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSeverity(key)}
                aria-pressed={severity === key}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[11.5px] font-semibold transition-colors",
                  severity === key ? "border-primary/30 bg-primary-soft text-accent-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {label} <span className="tabular opacity-60">{count}</span>
              </button>
            ))}
          </div>

          {filteredInsights.length === 0 ? (
            <Card>
              <EmptyState
                icon={<ShieldCheck />}
                title={insights.length === 0 ? "You're all caught up" : "Nothing in this filter"}
                description={insights.length === 0
                  ? "No over-budget envelopes or risky cash-flow signals right now. New suggestions appear as your month unfolds."
                  : "Try another severity filter, or ask Guardian a direct question about your money."}
                action={<Button size="sm" variant="outline" onClick={() => setTab("ask")}><MessageCircle /> Ask Guardian</Button>}
                className="py-10"
              />
            </Card>
          ) : (
            <div className="grid gap-2.5 lg:grid-cols-2">
              {filteredInsights.map((insight) => {
                const meta = SEVERITY_META[insight.severity];
                const Icon = meta.icon;
                return (
                  <div key={insight.id} className={cn("flex flex-col rounded-2xl border p-4", meta.ring)}>
                    <div className="flex items-start gap-3">
                      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-card/70", meta.iconTone)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={meta.badge}>{meta.label}</Badge>
                          {insight.amount !== undefined && (
                            <span className={cn("text-[11px] font-semibold tabular", meta.iconTone)}>{formatMoney(insight.amount, currency)}</span>
                          )}
                        </div>
                        <h3 className="mt-1.5 text-[13.5px] font-semibold leading-snug">{insight.title}</h3>
                        <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{insight.body}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          dismissInsight(insight.id);
                          toast.success("Suggestion dismissed");
                        }}
                        aria-label={`Dismiss ${insight.title}`}
                        className="rounded-lg p-1 text-muted-foreground/70 transition-colors hover:bg-card/80 hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-3 rounded-xl border border-border/50 bg-card/60 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                      <span className="font-semibold text-foreground">Why: </span>
                      {insight.reason}
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                      {insight.actionHref ? (
                        <Button size="sm" variant="soft" asChild>
                          <Link to={insight.actionHref}>{insight.actionLabel} <ArrowRight /></Link>
                        </Button>
                      ) : (
                        <span />
                      )}
                      <Link to="/app/transactions" className="text-[10.5px] font-medium text-muted-foreground hover:text-foreground">View ledger</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="mt-4 flex items-center justify-center gap-1.5 text-[10.5px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3" /> AI suggestions are not financial advice. You stay in control of every change.
          </p>
        </div>
      )}

      {tab === "ask" && (
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/60">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Sparkles className="h-4 w-4" /></span>
              <div>
                <CardTitle>Ask Guardian</CardTitle>
                <p className="text-[11px] text-muted-foreground">Answers are computed from your ledger, with sources shown.</p>
              </div>
            </div>
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearMessages();
                  toast.success("Conversation cleared");
                }}
              >
                <Eraser /> Clear
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[52vh] min-h-[290px] overflow-y-auto px-4 py-4 sm:px-5">
              {messages.length === 0 ? (
                <div className="mx-auto max-w-md py-6 text-center">
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary"><Sparkles className="h-5 w-5" /></span>
                  <h3 className="mt-3 text-[15px] font-semibold">What would you like to understand?</h3>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    I can total spending by category, check affordability against bills and envelopes, review subscriptions, or explain your safe-to-spend number.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                    {GUARDIAN_PROMPTS.slice(0, 4).map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => sendMessage(prompt)}
                        className="rounded-full border border-border bg-card px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3.5">
                  {messages.map((message) => (
                    <div key={message.id} className={cn("flex gap-2.5", message.role === "user" ? "justify-end" : "justify-start")}>
                      {message.role === "assistant" && (
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><ShieldCheck className="h-3.5 w-3.5" /></span>
                      )}
                      <div className={cn("max-w-[86%] sm:max-w-[78%]", message.role === "user" ? "text-right" : "text-left")}>
                        <div className={cn(
                          "whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed",
                          message.role === "user" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted/60 text-foreground",
                        )}>
                          {message.content}
                        </div>
                        {message.role === "assistant" && message.sources && message.sources.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {message.sources.map((source) => (
                              <span key={source} className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-0.5 text-[9.5px] font-medium text-muted-foreground">
                                <FileText className="h-2.5 w-2.5" /> {source}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {thinking && (
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><ShieldCheck className="h-3.5 w-3.5" /></span>
                      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-muted/60 px-3.5 py-2.5 text-[11.5px] text-muted-foreground">
                        <Spinner className="h-3 w-3" /> Reading your ledger…
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>

            {messages.length > 0 && chatSuggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-border/50 px-4 py-2.5 sm:px-5">
                {chatSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => sendMessage(suggestion)}
                    disabled={thinking}
                    className="rounded-full border border-border bg-card px-2.5 py-1 text-[10.5px] font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage(chatInput);
              }}
              className="flex items-center gap-2 border-t border-border/60 p-3 sm:p-4"
            >
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="e.g. Can I afford a ₹15,000 purchase?"
                aria-label="Message Guardian"
                disabled={thinking}
                className="h-10"
              />
              <Button type="submit" size="icon" aria-label="Send message" disabled={thinking || !chatInput.trim()}>
                {thinking ? <Spinner /> : <Send />}
              </Button>
            </form>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-4 py-2 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Database className="h-3 w-3" /> Grounded answers only — no invented numbers.</span>
              <span>Not financial advice.</span>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "buy" && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary"><CreditCard className="h-3.5 w-3.5" /></span>
                  <div>
                    <CardTitle>Purchase advisor</CardTitle>
                    <p className="text-[11px] text-muted-foreground">Check a buy against bills, envelopes and goals.</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="pa-item">What are you buying?</Label>
                  <Input
                    id="pa-item"
                    ref={advisorInputRef}
                    value={item}
                    onChange={(e) => setItem(e.target.value)}
                    placeholder="e.g. Sony WH-1000XM5 headphones"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pa-price">Price</Label>
                  <MoneyInput id="pa-price" value={price} currency={currency} onChange={setPrice} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pa-category">Budget envelope</Label>
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger id="pa-category" aria-label="Budget envelope"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No specific envelope</SelectItem>
                      {expenseCategories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full justify-center" onClick={checkPurchase}>Check affordability</Button>
                <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                  Guardian compares the price with flexible envelopes, unpaid bills and the pace you need to keep for your goals.
                </p>
              </CardContent>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary"><Sparkles className="h-3.5 w-3.5" /></span>
                  <CardTitle>Guardian's take</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {!advice ? (
                  <EmptyState
                    icon={<CreditCard />}
                    title="No purchase checked yet"
                    description="Add an item and price, then Guardian will show whether it fits — and what it could delay."
                    className="py-8"
                  />
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <Badge variant={VERDICT_META[advice.verdict].badge}>{VERDICT_META[advice.verdict].label}</Badge>
                        <h3 className={cn("mt-2 text-[15px] font-semibold leading-snug", VERDICT_META[advice.verdict].tone)}>{advice.headline}</h3>
                      </div>
                      <p className="tabular text-right text-[18px] font-semibold">{formatMoney(parseToInr(price, currency), currency)}</p>
                    </div>
                    <p className="text-[12px] leading-relaxed text-muted-foreground">{advice.summary}</p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {advice.reasons.map((reason) => (
                        <div key={reason} className="flex items-start gap-1.5 rounded-xl border border-border/60 bg-muted/20 px-2.5 py-2 text-[11px]">
                          <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                          <span className="leading-relaxed text-muted-foreground">{reason}</span>
                        </div>
                      ))}
                    </div>
                    {advice.delays.length > 0 && (
                      <div className="rounded-xl border border-warning/25 bg-warning-soft/40 p-3 text-[11px] leading-relaxed">
                        <p className="flex items-center gap-1.5 font-semibold text-warning"><Target className="h-3.5 w-3.5" /> What it could delay</p>
                        <ul className="mt-1 space-y-0.5 text-muted-foreground">
                          {advice.delays.map((delay) => (
                            <li key={delay.name}>• {delay.name} auto-contribution pauses for about {delay.months} month{delay.months === 1 ? "" : "s"}.</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {parseToInr(price, currency) > data.profile.walletBalance && (
                      <InfoNote className="text-[10.5px]">
                        Your PayPal wallet holds {formatMoney(data.profile.walletBalance, currency)}. Top up in Wallet & PayPal before placing a hold for this amount.
                      </InfoNote>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="soft" onClick={openCheckout}>
                        <Clock /> Hold with Patient Checkout
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <Link to="/app/shopper">Compare prices <ArrowUpRight /></Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setAdvice(null);
                          setItem("");
                          setPrice("");
                          window.setTimeout(() => advisorInputRef.current?.focus(), 50);
                        }}
                      >
                        Start over
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary"><Clock className="h-3.5 w-3.5" /></span>
                <div>
                  <CardTitle>Patient Checkout holds</CardTitle>
                  <p className="text-[11px] text-muted-foreground">Authorize now, decide later. Capture before the hold expires.</p>
                </div>
              </div>
              <Badge variant="outline"><FlaskConical /> Sandbox authorizations</Badge>
            </CardHeader>
            <CardContent>
              {data.patientCheckouts.length === 0 ? (
                <EmptyState
                  icon={<Clock />}
                  title="No holds yet"
                  description="Check a purchase, then authorize it for a 7-day cooling-off period before capturing the payment."
                  action={<Button size="sm" variant="outline" onClick={() => advisorInputRef.current?.focus()}><CreditCard /> Check a purchase</Button>}
                  className="py-8"
                />
              ) : (
                <div className="space-y-2">
                  {data.patientCheckouts.map((hold) => {
                    const expired = hold.status === "authorized" && daysUntil(hold.captureBy) < 0;
                    const meta = expired ? CHECKOUT_META.expired : CHECKOUT_META[hold.status];
                    const daysLeft = daysUntil(hold.captureBy);
                    return (
                      <div key={hold.id} className={cn("flex flex-col gap-3 rounded-2xl border border-border/70 p-3.5 sm:flex-row sm:items-center", expired && "bg-danger-soft/20")}>
                        <span className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                          hold.status === "captured" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : hold.status === "voided" ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
                        )}>
                          {hold.status === "captured" ? <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="truncate text-[12.5px] font-semibold">{hold.item}</p>
                            <Badge variant={meta.variant}>{meta.label}</Badge>
                            {hold.status === "authorized" && !expired && daysLeft <= 2 && <Badge variant="warning">Expires soon</Badge>}
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {hold.status === "captured"
                              ? `Captured ${fmtDate(hold.authorizedAt, "d MMM")}`
                              : expired
                                ? `Hold expired ${fmtDate(hold.captureBy, "d MMM")}`
                                : hold.status === "voided"
                                  ? "Released — nothing captured"
                                  : `Authorized ${fmtDate(hold.authorizedAt, "d MMM")} · capture by ${fmtDate(hold.captureBy, "d MMM")}`}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[9.5px] text-muted-foreground/80">
                            {hold.paypalOrderId ? `order ${hold.paypalOrderId}` : ""}
                            {hold.authorizationId ? ` · auth ${hold.authorizationId}` : ""}
                            {hold.captureId ? ` · capture ${hold.captureId}` : ""}
                          </p>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="tabular text-[14px] font-semibold"><Money value={hold.amount} currency={currency} /></p>
                          <p className="text-[10px] text-muted-foreground">{hold.simulated ? "Simulated" : "Sandbox"}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          {hold.status === "authorized" && !expired && (
                            <>
                              <Button size="sm" variant="soft" onClick={() => setCaptureTarget(hold)}><CheckCircle2 /> Capture</Button>
                              <Button size="sm" variant="ghost" onClick={() => setReleaseTarget(hold)} disabled={releasingId === hold.id}>
                                {releasingId === hold.id ? <Spinner /> : <X />} Release
                              </Button>
                            </>
                          )}
                          {expired && (
                            <Button size="sm" variant="ghost" onClick={() => setReleaseTarget(hold)} disabled={releasingId === hold.id}>
                              {releasingId === hold.id ? <Spinner /> : <X />} Release hold
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <InfoNote icon={<FlaskConical />}>
            Patient Checkout uses PayPal sandbox orders with the AUTHORIZE intent: money is held, not taken, until you capture it — or the authorization expires. Capturing records an expense and debits your sandbox wallet. No real money moves. Suggestions are not financial advice.
          </InfoNote>
        </div>
      )}

      <Dialog
        open={checkoutOpen}
        onOpenChange={(open) => {
          if (!open && !checkoutBusy) setCheckoutOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {checkoutStep === "done" ? "Hold placed" : checkoutStep === "pending" ? "Approve in PayPal" : "Hold this purchase?"}
            </DialogTitle>
            <DialogDescription>
              {checkoutStep === "confirm" && "Guardian will authorize the payment but not capture it. You get a 7-day cooling-off window to change your mind."}
              {checkoutStep === "pending" && "The order needs your approval in the PayPal sandbox before Guardian can place the hold."}
              {checkoutStep === "done" && "The payment is authorized. Capture it when you're sure, or release the hold."}
            </DialogDescription>
          </DialogHeader>

          {checkoutStep === "confirm" && advice && (
            <div className="space-y-3">
              <div className="rounded-xl border border-border/70 bg-muted/30 p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">{item || "Planned purchase"}</p>
                    <p className="text-[11px] text-muted-foreground">Authorization hold · no capture yet</p>
                  </div>
                  <p className="tabular text-[16px] font-semibold">{formatMoney(parseToInr(price, currency), currency)}</p>
                </div>
              </div>
              <dl className="space-y-2 text-[11.5px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Capture by</dt>
                  <dd className="font-medium">{fmtDate(addDaysISO(todayISO(), COOLING_OFF_DAYS), "d MMM yyyy")}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Wallet available</dt>
                  <dd className="font-semibold tabular"><Money value={data.profile.walletBalance} currency={currency} /></dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Verdict</dt>
                  <dd className="font-medium">{advice.headline}</dd>
                </div>
              </dl>
              {checkoutError && (
                <p className="rounded-xl border border-danger/20 bg-danger-soft/40 px-3 py-2 text-[11px] text-danger">{checkoutError}</p>
              )}
              <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
                <FlaskConical className="mt-0.5 h-3 w-3 shrink-0" />
                {integration.configured
                  ? "This authorizes an order in the PayPal sandbox. No real money moves."
                  : "PayPal credentials aren't configured, so this hold is simulated and labelled."}
              </p>
            </div>
          )}

          {checkoutStep === "pending" && checkoutOrder && (
            <div className="space-y-3">
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-[11.5px] leading-relaxed text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                Approve order <span className="font-mono text-[10.5px]">{checkoutOrder.id}</span> in the PayPal sandbox, then authorize it here.
              </div>
              {checkoutOrder.approvalUrl && (
                <Button variant="outline" asChild className="w-full justify-center">
                  <a href={checkoutOrder.approvalUrl} target="_blank" rel="noreferrer">Open PayPal sandbox <ArrowUpRight /></a>
                </Button>
              )}
              {checkoutError && (
                <p className="rounded-xl border border-danger/20 bg-danger-soft/40 px-3 py-2 text-[11px] text-danger">{checkoutError}</p>
              )}
            </div>
          )}

          {checkoutStep === "done" && checkoutResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/30 p-3.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"><Clock className="h-5 w-5" /></span>
                <div>
                  <p className="text-[13px] font-semibold">{checkoutResult.item}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatMoney(checkoutResult.amount, currency)} held until {fmtDate(checkoutResult.captureBy, "d MMM yyyy")} · {checkoutResult.simulated ? "Simulated" : "PayPal sandbox"}
                  </p>
                </div>
              </div>
              <dl className="space-y-2 rounded-xl border border-border/70 p-3.5 text-[11.5px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Order ID</dt>
                  <dd className="truncate font-mono text-[10.5px]">{checkoutResult.paypalOrderId ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Authorization ID</dt>
                  <dd className="truncate font-mono text-[10.5px]">{checkoutResult.authorizationId ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Capture by</dt>
                  <dd className="font-medium">{fmtDate(checkoutResult.captureBy, "d MMM yyyy")}</dd>
                </div>
              </dl>
              <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                Nothing has been captured yet. Capture before the hold expires, or release it and keep your money where it is.
              </p>
            </div>
          )}

          <DialogFooter>
            {checkoutStep === "confirm" && (
              <>
                <Button variant="outline" onClick={() => setCheckoutOpen(false)} disabled={checkoutBusy}>Cancel</Button>
                <Button onClick={startAuthorization} disabled={checkoutBusy}>
                  {checkoutBusy ? <Spinner /> : <Clock />} {checkoutBusy ? "Authorizing…" : "Authorize hold"}
                </Button>
              </>
            )}
            {checkoutStep === "pending" && (
              <>
                <Button variant="outline" onClick={() => setCheckoutOpen(false)} disabled={checkoutBusy}>Cancel</Button>
                <Button onClick={approvePendingOrder} disabled={checkoutBusy}>
                  {checkoutBusy ? <Spinner /> : <Check />} {checkoutBusy ? "Authorizing…" : "I approved it — authorize"}
                </Button>
              </>
            )}
            {checkoutStep === "done" && checkoutResult && (
              <>
                <Button variant="outline" onClick={() => setCheckoutOpen(false)}>Done</Button>
                <Button
                  onClick={() => {
                    setCheckoutOpen(false);
                    setCaptureTarget(checkoutResult);
                  }}
                >
                  <CheckCircle2 /> Capture now
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!captureTarget} onOpenChange={(open) => !open && !captureBusy && setCaptureTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Capture this payment?</DialogTitle>
            <DialogDescription>
              {captureTarget
                ? `${formatMoney(captureTarget.amount, currency)} for ${captureTarget.item}. Capturing is final — it records an expense and debits your sandbox wallet.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {captureTarget && (
            <div className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-3 text-[11.5px]">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Wallet balance</span>
                <span className="font-semibold tabular"><Money value={data.profile.walletBalance} currency={currency} /></span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">After capture</span>
                <span className="font-semibold tabular"><Money value={data.profile.walletBalance - captureTarget.amount} currency={currency} /></span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Hold expires</span>
                <span className="font-medium">{fmtDate(captureTarget.captureBy, "d MMM yyyy")}</span>
              </div>
            </div>
          )}
          {captureInsufficient && (
            <p className="rounded-xl border border-danger/20 bg-danger-soft/40 px-3 py-2 text-[11px] text-danger">
              Your wallet balance is too low to capture this hold. Top up in Wallet & PayPal, or release the hold instead.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCaptureTarget(null)} disabled={captureBusy}>Keep the hold</Button>
            <Button onClick={confirmCapture} disabled={captureBusy || captureInsufficient}>
              {captureBusy ? <Spinner /> : <CheckCircle2 />} {captureBusy ? "Capturing…" : "Capture payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!releaseTarget} onOpenChange={(open) => !open && !releasingId && setReleaseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Release this hold?</DialogTitle>
            <DialogDescription>
              {releaseTarget
                ? `${formatMoney(releaseTarget.amount, currency)} for ${releaseTarget.item}. Releasing cancels the authorization — nothing is captured and your wallet stays unchanged.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleaseTarget(null)} disabled={!!releasingId}>Keep hold</Button>
            <Button variant="destructive" onClick={() => releaseTarget && releaseHold(releaseTarget)} disabled={!!releasingId}>
              {releasingId ? <Spinner /> : <X />} Release hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
