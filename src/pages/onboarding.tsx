import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Briefcase, Check, CircleDot, FlaskConical, GraduationCap, HeartPulse,
  Home, KeyRound, Landmark, Loader2, Plus, RefreshCw, ShieldCheck, Sparkles, Target, Trash2,
  TrendingUp, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/app-context";
import { useIntegration } from "@/lib/integration-context";
import { adaptiveBudget } from "@/lib/finance";
import { connectPayPalSandbox } from "@/lib/paypal";
import { formatMoney, formatAmountInput, parseToInr, CURRENCY_META } from "@/lib/money";
import type { Currency, FixedObligation } from "@/lib/types";
import { addMonthsISO } from "@/lib/dates";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money";
import { Progress } from "@/components/ui/misc";
import { uid } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface ObligationRow {
  id: string;
  name: string;
  amount: string;
  categoryId: string;
}

interface GoalRow {
  id: string;
  name: string;
  target: string;
  deadline: string;
}

const PRESETS: { name: string; categoryId: string; icon: typeof Home }[] = [
  { name: "Rent", categoryId: "cat_rent", icon: Home },
  { name: "Loan / EMI", categoryId: "cat_emi", icon: Landmark },
  { name: "Utilities", categoryId: "cat_utilities", icon: Zap },
  { name: "Transport", categoryId: "cat_transport", icon: Briefcase },
  { name: "Education", categoryId: "cat_education", icon: GraduationCap },
  { name: "Health", categoryId: "cat_health", icon: HeartPulse },
  { name: "Other", categoryId: "cat_other", icon: CircleDot },
];

const OBLIGATION_CATEGORIES = [
  { id: "cat_rent", label: "Rent / housing" },
  { id: "cat_emi", label: "Loan or EMI" },
  { id: "cat_utilities", label: "Utilities" },
  { id: "cat_transport", label: "Transport" },
  { id: "cat_education", label: "Education" },
  { id: "cat_health", label: "Health" },
  { id: "cat_other", label: "Other fixed cost" },
];

export default function OnboardingPage() {
  const { data, completeOnboarding, setProfile, signOut } = useApp();
  const { status: integration, loading: integrationLoading, refresh: refreshIntegration } = useIntegration();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profile = data!.profile;
  const currency = profile.currency;
  const isDemo = !!profile.demo;
  const [income, setIncome] = useState(profile.monthlyIncome ? formatAmountInput(profile.monthlyIncome, currency) : "");
  const [incomeType, setIncomeType] = useState<"fixed" | "irregular">(profile.incomeType);
  const [rows, setRows] = useState<ObligationRow[]>(() =>
    profile.fixedObligations.length
      ? profile.fixedObligations.map((o) => ({ id: o.id, name: o.name, amount: formatAmountInput(o.amount, currency), categoryId: o.categoryId }))
      : [],
  );
  const [goals, setGoals] = useState<GoalRow[]>([]);

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const incomeInr = parseToInr(income, currency);
  const fixedRows = rows.filter((r) => r.name.trim() && parseToInr(r.amount, currency) > 0);
  const fixedTotal = fixedRows.reduce((s, r) => s + parseToInr(r.amount, currency), 0);
  const goalRows = goals.filter((g) => g.name.trim() && parseToInr(g.target, currency) > 0);

  const preview = useMemo(() => {
    const fixedNeeds = fixedRows
      .filter((r) => data!.categories.find((c) => c.id === r.categoryId)?.group !== "wants")
      .reduce((s, r) => s + parseToInr(r.amount, currency), 0);
    const fixedWants = fixedTotal - fixedNeeds;
    return adaptiveBudget(
      incomeInr,
      fixedNeeds,
      fixedWants,
      goalRows.map((g) => ({ name: g.name, target: parseToInr(g.target, currency), deadline: g.deadline })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomeInr, fixedTotal, fixedRows, goalRows, currency, data]);

  function changeCurrency(next: Currency) {
    if (next === currency) return;
    const convert = (v: string) => (v ? formatAmountInput(parseToInr(v, currency), next) : "");
    setIncome(convert(income));
    setRows((prev) => prev.map((r) => ({ ...r, amount: convert(r.amount) })));
    setGoals((prev) => prev.map((g) => ({ ...g, target: convert(g.target) })));
    setProfile({ currency: next });
  }

  function addRow(preset?: (typeof PRESETS)[number]) {
    setRows((prev) => [
      ...prev,
      { id: uid("ob"), name: preset?.name ?? "", amount: "", categoryId: preset?.categoryId ?? "cat_other" },
    ]);
  }

  function addGoal() {
    setGoals((prev) => [...prev, { id: uid("goal"), name: "", target: "", deadline: addMonthsISO(new Date().toISOString().slice(0, 10), 12) }]);
  }

  function updateGoal(id: string, patch: Partial<GoalRow>) {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }

  async function connectSandbox() {
    setConnectError(null);
    if (clientId.trim().length < 10 || clientSecret.trim().length < 10) {
      setConnectError("Enter the sandbox Client ID and Secret from your PayPal developer app.");
      return;
    }
    setConnecting(true);
    try {
      await connectPayPalSandbox(clientId.trim(), clientSecret.trim());
      setClientId("");
      setClientSecret("");
      refreshIntegration();
      toast.success("Sandbox credentials attached", { description: "They belong to this account permanently and can never be changed or removed." });
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Could not connect the sandbox.");
    } finally {
      setConnecting(false);
    }
  }

  function next() {
    setError(null);
    if (step === 1) {
      if (!isDemo && !integration.configured) {
        return setError("Connect your PayPal sandbox credentials to continue. They attach to this account permanently — each account uses its own sandbox.");
      }
      if (incomeInr <= 0) return setError("Enter your monthly income so the budget has something to work with.");
      setStep(2);
      return;
    }
    if (step === 2) {
      if (fixedTotal >= incomeInr) return setError("Fixed obligations can't use all of your income. Adjust the amounts to continue.");
      setStep(3);
    }
  }

  function finish() {
    setError(null);
    if (incomeInr <= 0) return setError("Enter your monthly income first.");
    if (goals.some((g) => (g.name.trim() || parseToInr(g.target, currency) > 0) && !(g.name.trim() && parseToInr(g.target, currency) > 0))) {
      return setError("Give every savings goal a name and a target, or remove the row.");
    }
    setBusy(true);
    try {
      completeOnboarding({
        monthlyIncome: incomeInr,
        incomeType,
        obligations: fixedRows.map<FixedObligation>((r) => ({
          id: r.id,
          name: r.name.trim(),
          amount: parseToInr(r.amount, currency),
          categoryId: r.categoryId,
        })),
        goals: goalRows.map((g) => ({ name: g.name.trim(), target: parseToInr(g.target, currency), deadline: g.deadline })),
        openingCreditInr: isDemo ? 0 : Math.round(5000 * integration.usdRate),
      });
      toast.success("Your AI budget is ready", {
        description: goalRows.length ? `${goalRows.length} goal${goalRows.length === 1 ? "" : "s"} funded before wants.` : "Savings maximised for your income.",
      });
      navigate("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish setup.");
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    { n: 1, label: "Sandbox", icon: FlaskConical },
    { n: 2, label: "Obligations", icon: Landmark },
    { n: 3, label: "Goals", icon: Target },
  ];

  const sandboxNote = integration.source === "env" ? "Credentials come from the server environment." : "Stored encrypted on the server.";

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border/60 bg-card/50">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Logo />
          <div className="flex items-center gap-2">
            <span className="hidden text-[11.5px] text-muted-foreground sm:inline">Setting up {profile.email}</span>
            <Select value={currency} onValueChange={(v) => changeCurrency(v as Currency)}>
              <SelectTrigger className="h-8 w-[92px] text-xs" aria-label="Currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CURRENCY_META) as Currency[]).map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => { signOut(); navigate("/"); }}>Sign out</Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-6 px-5 py-8 lg:grid-cols-[1fr_320px] lg:py-12">
        <div className="rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-primary">Step {step} of 3</p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
                {step === 1 ? "Connect your PayPal sandbox" : step === 2 ? "What's already spoken for?" : "What are you saving for?"}
              </h1>
            </div>
            <div className="flex items-center gap-1.5" aria-hidden>
              {steps.map((s) => (
                <div key={s.n} className={cn("h-1.5 rounded-full transition-all", s.n === step ? "w-8 bg-primary" : s.n < step ? "w-4 bg-emerald-500" : "w-4 bg-muted")} />
              ))}
            </div>
          </div>

          <div className="mt-6">
            {step === 1 && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-border p-4">
                  <div className="flex items-start gap-3">
                    <span className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                      integration.configured ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
                    )}>
                      {integration.configured ? <ShieldCheck className="h-4 w-4" /> : <FlaskConical className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold">
                        {integrationLoading ? "Checking sandbox…" : integration.configured ? "Sandbox credentials attached" : "Attach your PayPal sandbox"}
                      </p>
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                        {integration.configured
                          ? `Orders, invoices and payouts run on api-m.sandbox.paypal.com through your own sandbox account. ${sandboxNote}`
                          : isDemo
                            ? "The demo workspace shares the server's sandbox account — nothing to connect."
                            : "Every account uses its own sandbox credentials. They are verified with PayPal, stored encrypted on the server, and can never be changed or removed afterwards."}
                      </p>
                      {integration.configured && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px]">
                          <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">api-m.sandbox</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">{integration.payoutsEnabled ? "Payouts on" : "Payouts off"}</span>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Attached permanently</span>
                          <button type="button" onClick={refreshIntegration} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                            <RefreshCw className="h-3 w-3" /> Re-check
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {!isDemo && !integration.configured && !integrationLoading && (
                    <div className="mt-4 space-y-3 border-t border-border/70 pt-4">
                      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                        Paste your sandbox app credentials from{" "}
                        <a href="https://developer.paypal.com/dashboard/applications/sandbox" target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">developer.paypal.com</a>.
                        They are sent to the server, verified with PayPal, and stored encrypted — never in this app's code or browser storage. Attaching them credits your account with the $5,000 opening balance.
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="sandbox-client-id">Sandbox Client ID</Label>
                          <Input id="sandbox-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="AY…" autoComplete="off" spellCheck={false} disabled={connecting} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="sandbox-client-secret">Sandbox Secret</Label>
                          <Input id="sandbox-client-secret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="EL…" autoComplete="off" spellCheck={false} disabled={connecting} />
                        </div>
                      </div>
                      {connectError && <p role="alert" className="text-[11.5px] font-medium text-danger">{connectError}</p>}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" onClick={connectSandbox} disabled={connecting}>
                          {connecting ? <Loader2 className="animate-spin" /> : <KeyRound />}
                          {connecting ? "Verifying…" : "Attach sandbox credentials"}
                        </Button>
                        <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Required — each account uses its own sandbox.</span>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <Label className="mb-2 block">Income pattern</Label>
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Income pattern">
                    {[
                      { id: "fixed" as const, label: "Fixed salary", sub: "Same most months", icon: Briefcase },
                      { id: "irregular" as const, label: "Irregular", sub: "Freelance / gig work", icon: TrendingUp },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        aria-checked={incomeType === opt.id}
                        onClick={() => setIncomeType(opt.id)}
                        className={cn(
                          "flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-all",
                          incomeType === opt.id ? "border-primary bg-primary-soft/60 shadow-sm" : "border-border hover:border-primary/40 hover:bg-muted/40",
                        )}
                      >
                        <opt.icon className={cn("mt-0.5 h-4 w-4", incomeType === opt.id ? "text-primary" : "text-muted-foreground")} />
                        <span>
                          <span className="block text-[13px] font-semibold">{opt.label}</span>
                          <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{opt.sub}</span>
                        </span>
                        {incomeType === opt.id && <Check className="ml-auto mt-0.5 h-4 w-4 text-primary" />}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="income">Typical monthly income</Label>
                  <MoneyInput id="income" value={income} currency={currency} onChange={setIncome} />
                  <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                    {incomeType === "irregular"
                      ? "We'll start with this number, then adapt to the average of your last three months as income lands."
                      : "Use your take-home amount after tax — the money that actually reaches your account."}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-muted/40 p-4">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold"><Sparkles className="h-3.5 w-3.5 text-primary" /> Your budget is built in the next steps</p>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                    Add fixed costs and savings goals, then the AI builds an adaptive budget: essentials grow slower than income, goals are funded first, and whatever a calm lifestyle leaves over is saved.
                  </p>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  Rent, EMIs, internet, health cover — the costs that repeat no matter what. These get funded first.
                </p>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => addRow(p)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      <p.icon className="h-3 w-3" /> {p.name}
                    </button>
                  ))}
                </div>

                {rows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border px-5 py-8 text-center">
                    <Landmark className="mx-auto h-6 w-6 text-muted-foreground" />
                    <p className="mt-2 text-[13px] font-semibold">No fixed obligations yet</p>
                    <p className="mt-1 text-[11.5px] text-muted-foreground">Add rent, an EMI, health cover or another recurring bill above. You can skip this if nothing repeats.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {rows.map((row) => (
                      <div key={row.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-2xl border border-border bg-muted/20 p-2.5 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-center">
                        <Input value={row.name} onChange={(e) => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, name: e.target.value } : r)))} placeholder="Name (e.g. Rent)" aria-label="Obligation name" className="h-10" />
                        <Select value={row.categoryId} onValueChange={(v) => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, categoryId: v } : r)))}>
                          <SelectTrigger className="h-10 text-xs" aria-label="Obligation category"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {OBLIGATION_CATEGORIES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <MoneyInput value={row.amount} currency={currency} onChange={(v) => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, amount: v } : r)))} className="h-10" />
                        <Button variant="ghost" size="icon-sm" onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))} aria-label={`Remove ${row.name || "obligation"}`}>
                          <Trash2 className="text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => addRow()} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:underline">
                  <Plus className="h-3.5 w-3.5" /> Add another fixed cost
                </button>

                <div className="rounded-2xl border border-border/70 bg-muted/40 p-4">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-medium">Fixed obligations</span>
                    <span className="tabular font-semibold">{formatMoney(fixedTotal, currency)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11.5px] text-muted-foreground">
                    <span>Share of income</span>
                    <span className={cn("font-semibold", incomeInr && fixedTotal / incomeInr > 0.6 ? "text-warning" : "text-foreground")}>
                      {incomeInr ? Math.round((fixedTotal / incomeInr) * 100) : 0}%
                    </span>
                  </div>
                  <Progress value={incomeInr ? (fixedTotal / incomeInr) * 100 : 0} className="mt-2" indicatorClassName={fixedTotal / Math.max(1, incomeInr) > 0.6 ? "bg-warning" : "bg-primary"} />
                  {fixedTotal / Math.max(1, incomeInr) > 0.6 && (
                    <p className="mt-2 text-[11px] text-warning">Over 60% of income is fixed. The AI will trim wants and defer goals instead of starving essentials.</p>
                  )}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  Add as many goals as you want. The AI funds them first, then builds the budget around what's already spoken for — no fixed 50/30/20.
                </p>

                {goals.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border px-5 py-7 text-center">
                    <Target className="mx-auto h-6 w-6 text-muted-foreground" />
                    <p className="mt-2 text-[13px] font-semibold">No goals yet</p>
                    <p className="mt-1 text-[11.5px] text-muted-foreground">Without goals, every spare rupee still goes to an unassigned savings buffer.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {goals.map((goal) => {
                      const planIndex = goalRows.findIndex((g) => g.id === goal.id);
                      const funding = planIndex >= 0 ? preview.goalRequests[planIndex] : null;
                      return (
                        <div key={goal.id} className="rounded-2xl border border-border bg-muted/20 p-2.5">
                          <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1.3fr_1fr_1fr_auto] sm:items-center">
                            <Input value={goal.name} onChange={(e) => updateGoal(goal.id, { name: e.target.value })} placeholder="Goal name (e.g. Emergency fund)" aria-label="Goal name" className="h-10" />
                            <MoneyInput value={goal.target} currency={currency} onChange={(v) => updateGoal(goal.id, { target: v })} placeholder="Target" className="h-10" />
                            <Input type="date" value={goal.deadline} onChange={(e) => updateGoal(goal.id, { deadline: e.target.value })} min={new Date().toISOString().slice(0, 10)} aria-label="Goal deadline" className="h-10" />
                            <Button variant="ghost" size="icon-sm" onClick={() => setGoals((prev) => prev.filter((g) => g.id !== goal.id))} aria-label={`Remove ${goal.name || "goal"}`}>
                              <Trash2 className="text-muted-foreground" />
                            </Button>
                          </div>
                          {funding && (
                            <p className="mt-1.5 px-1 text-[10.5px] text-muted-foreground">
                              Needs {formatMoney(funding.requested, currency)}/mo to hit the date · AI funds <span className="font-semibold text-foreground">{formatMoney(funding.monthly, currency)}/mo</span>
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <button type="button" onClick={addGoal} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:underline">
                  <Plus className="h-3.5 w-3.5" /> Add a savings goal
                </button>

                {incomeInr > 0 && (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-border p-4">
                      <div className="flex items-center justify-between">
                        <p className="flex items-center gap-1.5 text-[12px] font-semibold"><Sparkles className="h-3.5 w-3.5 text-primary" /> Your AI budget</p>
                        <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">Adaptive, not 50/30/20</span>
                      </div>
                      <div className="mt-3 space-y-2.5">
                        {[
                          { label: "Necessities", amount: preview.essentials, share: preview.needsShare, color: "bg-teal-600" },
                          { label: "Wants & others", amount: preview.wants, share: preview.wantsShare, color: "bg-amber-500" },
                          { label: "Savings", amount: preview.savings, share: preview.savingsShare, color: "bg-emerald-500" },
                        ].map((g) => (
                          <div key={g.label}>
                            <div className="flex items-center justify-between text-[12px]">
                              <span className="flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", g.color)} /> {g.label}</span>
                              <span className="tabular font-semibold">{formatMoney(g.amount, currency)} <span className="text-muted-foreground">· {g.share}%</span></span>
                            </div>
                            <Progress value={incomeInr ? (g.amount / incomeInr) * 100 : 0} className="mt-1.5 h-1.5" indicatorClassName={g.color} />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/70 bg-muted/40 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">How the AI decided</p>
                      <ul className="mt-2 space-y-1.5">
                        {preview.notes.map((note) => (
                          <li key={note} className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                            <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" /> {note}
                          </li>
                        ))}
                      </ul>
                      {preview.goalShortfall > 0 && (
                        <p className="mt-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-[11px] font-medium text-warning">
                          Goals are {formatMoney(preview.goalShortfall, currency)}/mo short of their deadlines at this income — the plan funds what it can.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div role="alert" className="mt-5 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-[12.5px] font-medium text-danger">{error}</div>
          )}

          <div className="mt-7 flex items-center justify-between gap-3 border-t border-border/60 pt-5">
            <Button variant="ghost" onClick={() => (step > 1 ? setStep(step - 1) : navigate("/"))} disabled={busy}>
              <ArrowLeft /> {step > 1 ? "Back" : "Exit"}
            </Button>
            {step < 3 ? (
              <Button onClick={next}>Continue <ArrowRight /></Button>
            ) : (
              <Button onClick={finish} disabled={busy} className="gap-2">
                {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                {busy ? "Building your budget…" : "Create my AI budget"}
              </Button>
            )}
          </div>
        </div>

        <aside className="hidden space-y-4 lg:block">
          <div className="rounded-3xl border border-border bg-gradient-to-b from-card to-muted/40 p-5 shadow-soft">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Your setup</p>
            <div className="mt-4 space-y-3">
              {[
                { n: 1, label: "PayPal sandbox", value: integration.configured ? "Attached" : isDemo ? "Shared demo sandbox" : "Required", icon: FlaskConical },
                { n: 2, label: "Fixed obligations", value: fixedTotal > 0 ? formatMoney(fixedTotal, currency) : "None yet", icon: Landmark },
                { n: 3, label: "Savings goals", value: goalRows.length ? `${goalRows.length} goal${goalRows.length === 1 ? "" : "s"}` : "None yet", icon: Target },
              ].map((s) => (
                <div key={s.n} className={cn("flex items-center gap-3 rounded-xl border p-3 transition-all", step === s.n ? "border-primary/40 bg-primary-soft/40" : "border-transparent")}>
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", step === s.n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                    <s.icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10.5px] font-medium text-muted-foreground">{s.label}</p>
                    <p className="truncate text-[12.5px] font-semibold tabular">{s.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-border bg-card p-5">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold"><Sparkles className="h-3.5 w-3.5 text-primary" /> The budget AI will</p>
            <ul className="mt-3 space-y-2 text-[11.5px] leading-relaxed text-muted-foreground">
              {[
                "Model essentials below a fixed 50% as income grows",
                "Fund every savings goal before wants get money",
                "Keep a calm lifestyle floor instead of cutting to zero",
                "Push every remaining rupee into savings",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />{t}</li>
              ))}
            </ul>
            <p className="mt-4 border-t border-border/60 pt-3 text-[10px] leading-relaxed text-muted-foreground">
              The engine is deterministic and auditable — every split is explained. Not financial advice.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
