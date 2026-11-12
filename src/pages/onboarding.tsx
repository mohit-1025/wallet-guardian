import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Briefcase, Check, GraduationCap, Home, Landmark, Loader2,
  Plus, ShieldCheck, Sparkles, Target, Trash2, TrendingUp, Wallet, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/app-context";
import { formatMoney, formatAmountInput, parseToInr, CURRENCY_META } from "@/lib/money";
import type { Currency, FixedObligation } from "@/lib/types";
import { addMonthsISO } from "@/lib/dates";
import { generateBudget } from "@/lib/finance";
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

const PRESETS: { name: string; categoryId: string; icon: typeof Home }[] = [
  { name: "Rent", categoryId: "cat_rent", icon: Home },
  { name: "Loan / EMI", categoryId: "cat_emi", icon: Landmark },
  { name: "Utilities", categoryId: "cat_utilities", icon: Zap },
  { name: "Transport", categoryId: "cat_transport", icon: Briefcase },
  { name: "Education", categoryId: "cat_education", icon: GraduationCap },
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
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profile = data!.profile;
  const currency = profile.currency;
  const [income, setIncome] = useState(profile.monthlyIncome ? formatAmountInput(profile.monthlyIncome, currency) : "");
  const [incomeType, setIncomeType] = useState<"fixed" | "irregular">(profile.incomeType);
  const [rows, setRows] = useState<ObligationRow[]>(() =>
    profile.fixedObligations.length
      ? profile.fixedObligations.map((o) => ({ id: o.id, name: o.name, amount: formatAmountInput(o.amount, currency), categoryId: o.categoryId }))
      : [],
  );
  const [savings, setSavings] = useState(
    profile.savingsTarget ? formatAmountInput(profile.savingsTarget, currency) : "",
  );
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalDeadline, setGoalDeadline] = useState(addMonthsISO(new Date().toISOString().slice(0, 10), 12));

  const incomeInr = parseToInr(income, currency);
  const savingsInr = parseToInr(savings, currency);
  const fixedRows = rows.filter((r) => r.name.trim() && parseToInr(r.amount, currency) > 0);
  const fixedTotal = fixedRows.reduce((s, r) => s + parseToInr(r.amount, currency), 0);

  const preview = useMemo(() => {
    const tempProfile = {
      ...profile,
      monthlyIncome: incomeInr,
      incomeType,
      savingsTarget: savingsInr || Math.round(incomeInr * 0.2),
      fixedObligations: fixedRows.map<FixedObligation>((r) => ({
        id: r.id,
        name: r.name,
        amount: parseToInr(r.amount, currency),
        categoryId: r.categoryId,
      })),
    };
    const plan = generateBudget(tempProfile, [], data!.categories);
    const groups = {
      necessities: plan.envelopes.filter((e) => e.group === "necessities").reduce((s, e) => s + e.allocated, 0),
      wants: plan.envelopes.filter((e) => e.group === "wants").reduce((s, e) => s + e.allocated, 0),
      savings: plan.envelopes.filter((e) => e.group === "savings").reduce((s, e) => s + e.allocated, 0),
    };
    return { plan, groups };
  }, [profile, incomeInr, incomeType, savingsInr, fixedRows, currency, data]);

  function changeCurrency(next: Currency) {
    if (next === currency) return;
    const convert = (v: string) => (v ? formatAmountInput(parseToInr(v, currency), next) : "");
    setIncome(convert(income));
    setSavings(convert(savings));
    setRows((prev) => prev.map((r) => ({ ...r, amount: convert(r.amount) })));
    setGoalTarget(convert(goalTarget));
    setProfile({ currency: next });
  }

  function addRow(preset?: (typeof PRESETS)[number]) {
    setRows((prev) => [
      ...prev,
      { id: uid("ob"), name: preset?.name ?? "", amount: "", categoryId: preset?.categoryId ?? "cat_other" },
    ]);
  }

  function next() {
    setError(null);
    if (step === 1) {
      if (incomeInr <= 0) return setError("Enter your monthly income so the budget has something to work with.");
      setStep(2);
      return;
    }
    if (step === 2) {
      if (fixedTotal >= incomeInr) return setError("Fixed obligations can't use all of your income. Adjust the amounts to continue.");
      setStep(3);
    }
  }

  async function finish() {
    setError(null);
    if (savingsInr < 0) return setError("Savings target can't be negative.");
    if (goalName.trim() && parseToInr(goalTarget, currency) <= 0) {
      return setError("Add a target amount for your goal, or clear the goal name.");
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
        savingsTarget: savingsInr || Math.round(incomeInr * 0.2),
        goal: goalName.trim()
          ? { name: goalName, target: parseToInr(goalTarget, currency), deadline: goalDeadline }
          : null,
      });
      toast.success("Your guardian is ready", { description: "Budget envelopes created and savings target set." });
      navigate("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish setup.");
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    { n: 1, label: "Income", icon: Wallet },
    { n: 2, label: "Obligations", icon: Landmark },
    { n: 3, label: "Savings goal", icon: Target },
  ];

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
                {step === 1 ? "What comes in each month?" : step === 2 ? "What's already spoken for?" : "What are you saving for?"}
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
              <div className="space-y-6">
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
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold"><Sparkles className="h-3.5 w-3.5 text-primary" /> How we use this</p>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                    Your income sets the budget ceiling. We protect 20% for savings, cover fixed costs at face value, and split the rest between necessities and wants. You can edit every envelope later.
                  </p>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  Rent, EMIs, internet — the costs that repeat no matter what. These get funded first.
                </p>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => addRow(p)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      <Plus className="h-3 w-3" /> {p.name}
                    </button>
                  ))}
                </div>

                {rows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border px-5 py-8 text-center">
                    <Landmark className="mx-auto h-6 w-6 text-muted-foreground" />
                    <p className="mt-2 text-[13px] font-semibold">No fixed obligations yet</p>
                    <p className="mt-1 text-[11.5px] text-muted-foreground">Add rent, an EMI, or a recurring bill above. You can also skip this if nothing repeats.</p>
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
                    <p className="mt-2 text-[11px] text-warning">Over 60% of income is fixed. We'll shift more of the variable budget toward necessities.</p>
                  )}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <div className="space-y-1.5">
                  <Label htmlFor="savings">Monthly savings target</Label>
                  <MoneyInput id="savings" value={savings} currency={currency} onChange={setSavings} placeholder={incomeInr ? formatAmountInput(Math.round(incomeInr * 0.2), currency) : "0"} />
                  <div className="flex gap-2 pt-1">
                    {[10, 20, 30].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setSavings(formatAmountInput(Math.round(incomeInr * (pct / 100)), currency))}
                        className={cn(
                          "rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors",
                          savings && Math.abs(savingsInr - incomeInr * (pct / 100)) < incomeInr * 0.01
                            ? "border-primary bg-primary-soft text-primary"
                            : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {pct}% of income
                      </button>
                    ))}
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                    Leave blank to use 20%. If money is tight we protect a smaller amount rather than break the budget.
                  </p>
                </div>

                <div className="rounded-2xl border border-border p-4">
                  <div className="flex items-start gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><Target className="h-4 w-4" /></span>
                    <div>
                      <p className="text-[13px] font-semibold">Start a goal (optional)</p>
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">A named goal makes saving feel real. You can add more later.</p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
                    <Input value={goalName} onChange={(e) => setGoalName(e.target.value)} placeholder="e.g. Emergency fund" aria-label="Goal name" />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <MoneyInput value={goalTarget} currency={currency} onChange={setGoalTarget} placeholder="Target amount" />
                      <div className="space-y-1">
                        <Label htmlFor="goal-deadline" className="sr-only">Goal deadline</Label>
                        <Input id="goal-deadline" type="date" value={goalDeadline} onChange={(e) => setGoalDeadline(e.target.value)} min={new Date().toISOString().slice(0, 10)} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70 bg-muted/40 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Your starting split</p>
                  <div className="mt-3 space-y-2.5">
                    {[
                      { label: "Necessities", amount: preview.groups.necessities, color: "bg-teal-600" },
                      { label: "Wants", amount: preview.groups.wants, color: "bg-amber-500" },
                      { label: "Savings", amount: preview.groups.savings, color: "bg-emerald-500" },
                    ].map((g) => (
                      <div key={g.label}>
                        <div className="flex items-center justify-between text-[12px]">
                          <span className="flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", g.color)} /> {g.label}</span>
                          <span className="tabular font-semibold">{formatMoney(g.amount, currency)}</span>
                        </div>
                        <Progress value={incomeInr ? (g.amount / incomeInr) * 100 : 0} className="mt-1.5 h-1.5" indicatorClassName={g.color} />
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">
                    Adapted from 50/30/20 for your fixed costs and savings target. Envelopes are editable any time.
                  </p>
                </div>
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
                {busy ? "Building your budget…" : "Create my budget"}
              </Button>
            )}
          </div>
        </div>

        <aside className="hidden space-y-4 lg:block">
          <div className="rounded-3xl border border-border bg-gradient-to-b from-card to-muted/40 p-5 shadow-soft">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Your setup</p>
            <div className="mt-4 space-y-3">
              {[
                { n: 1, label: "Monthly income", value: incomeInr > 0 ? formatMoney(incomeInr, currency) : "—", icon: Wallet },
                { n: 2, label: "Fixed obligations", value: fixedTotal > 0 ? formatMoney(fixedTotal, currency) : "None yet", icon: Landmark },
                { n: 3, label: "Savings target", value: savingsInr > 0 ? `${formatMoney(savingsInr, currency)}/mo` : "20% default", icon: Target },
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
            <p className="flex items-center gap-1.5 text-[12px] font-semibold"><Sparkles className="h-3.5 w-3.5 text-primary" /> Your guardian will</p>
            <ul className="mt-3 space-y-2 text-[11.5px] leading-relaxed text-muted-foreground">
              {["Build envelopes from your real fixed costs", "Set a safe-to-spend number for every day", "Watch for unusual charges and subscription waste", "Show the maths behind every suggestion"].map((t) => (
                <li key={t} className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />{t}</li>
              ))}
            </ul>
            <p className="mt-4 border-t border-border/60 pt-3 text-[10px] leading-relaxed text-muted-foreground">AI suggestions are not financial advice.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
