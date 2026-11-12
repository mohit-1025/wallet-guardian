import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Pencil,
  PiggyBank,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Badge, EmptyState, InfoNote, Progress } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CategoryIcon } from "@/components/ui/category-icon";
import { Money, MoneyInput } from "@/components/ui/money";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { useApp, useAppData } from "@/lib/app-context";
import {
  budgetSnapshot,
  envelopeSpent,
  flowBudgetComparison,
  generateBudget,
  GROUP_META,
  type BudgetPlan,
} from "@/lib/finance";
import { formatAmountInput, formatCompact, formatMoney, parseToInr } from "@/lib/money";
import { monthKey, monthLabel, nextMonthKey, previousMonthKey } from "@/lib/dates";
import { formatPct } from "@/lib/money";
import type { BudgetEnvelope, EnvelopeGroup } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const GROUP_ORDER: EnvelopeGroup[] = ["necessities", "wants", "savings"];

const GROUP_HINT: Record<EnvelopeGroup, string> = {
  necessities: "Rent, groceries, transport and other must-pay costs.",
  wants: "Food delivery, shopping, fun and everything flexible.",
  savings: "Protected before you spend — feeds your goals.",
};

export default function BudgetPage() {
  const data = useAppData();
  const { ensureBudget, updateEnvelope, moveEnvelopeMoney, rolloverMonth, replaceMonthBudget, updateGoal } = useApp();
  const currency = data.profile.currency;
  const [month, setMonth] = useState(monthKey());
  const [editEnv, setEditEnv] = useState<BudgetEnvelope | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [moveFrom, setMoveFrom] = useState<BudgetEnvelope | null>(null);
  const [moveToId, setMoveToId] = useState("");
  const [moveAmount, setMoveAmount] = useState("");
  const [rolloverOpen, setRolloverOpen] = useState(false);
  const [goalId, setGoalId] = useState("");
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenPreview, setRegenPreview] = useState<BudgetPlan | null>(null);

  useEffect(() => {
    ensureBudget(month);
  }, [month, ensureBudget]);

  const snap = budgetSnapshot(data, month);
  const budget = snap.budget;
  const income = budget?.income ?? data.profile.monthlyIncome;
  const groupTotals = useMemo(() => {
    return GROUP_ORDER.map((group) => {
      const envs = snap.envelopes.filter((e) => e.group === group);
      const allocated = envs.reduce((s, e) => s + e.allocated, 0);
      const spent = envs.reduce((s, e) => s + envelopeSpent(e, data.transactions, month), 0);
      return { group, envs, allocated, spent };
    });
  }, [snap.envelopes, data.transactions, month]);

  const totalAllocated = groupTotals.reduce((s, g) => s + g.allocated, 0);
  const flowRows = useMemo(() => flowBudgetComparison(data, month), [data, month]);
  const overAllocated = totalAllocated > income + 1;
  const isFuture = month > monthKey();
  const canRollover = month < monthKey() && (budget?.rollover ?? 0) === 0 && data.goals.length > 0;

  const rolloverAmount = useMemo(() => {
    if (!budget) return 0;
    return data.envelopes
      .filter((e) => e.budgetId === budget.id && e.group !== "savings")
      .reduce((s, e) => s + Math.max(0, e.allocated - envelopeSpent(e, data.transactions, month)), 0);
  }, [budget, data.envelopes, data.transactions, month]);

  function openEdit(env: BudgetEnvelope) {
    setEditEnv(env);
    setEditAmount(formatAmountInput(env.allocated, currency));
  }

  function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editEnv) return;
    const amount = parseToInr(editAmount, currency);
    updateEnvelope(editEnv.id, amount);
    toast.success(`${editEnv.name} updated`, {
      description: `Now ${formatMoney(amount, currency)} for ${monthLabel(month)}.`,
    });
    setEditEnv(null);
  }

  function openMove(env: BudgetEnvelope) {
    const target = data.envelopes.find((e) => e.budgetId === env.budgetId && e.id !== env.id);
    if (!target) {
      toast.error("Add another envelope before moving money.");
      return;
    }
    setMoveFrom(env);
    setMoveToId(target.id);
    setMoveAmount("");
  }

  function saveMove(e: React.FormEvent) {
    e.preventDefault();
    if (!moveFrom) return;
    const amount = parseToInr(moveAmount, currency);
    if (!amount || amount <= 0) {
      toast.error("Enter an amount above zero.");
      return;
    }
    if (amount > moveFrom.allocated) {
      toast.error("You can only move money that is still unspent in this envelope.");
      return;
    }
    if (!moveToId) {
      toast.error("Choose where the money should go.");
      return;
    }
    const target = data.envelopes.find((e) => e.id === moveToId);
    moveEnvelopeMoney(moveFrom.id, moveToId, amount);
    toast.success("Money moved", { description: `${formatMoney(amount, currency)} moved to ${target?.name ?? "another envelope"}.` });
    setMoveFrom(null);
    setMoveAmount("");
  }

  function openRollover() {
    if (!data.goals.length) {
      toast.error("Create a savings goal first.");
      return;
    }
    setGoalId(data.goals[0].id);
    setRolloverOpen(true);
  }

  function confirmRollover() {
    if (!goalId) return;
    rolloverMonth(month, goalId);
    const goal = data.goals.find((g) => g.id === goalId);
    toast.success(`${formatMoney(rolloverAmount, currency)} rolled over`, { description: `Added to ${goal?.name ?? "your goal"}.` });
    setRolloverOpen(false);
  }

  function openRegen() {
    setRegenPreview(generateBudget(data.profile, data.transactions, data.categories, month, data.goals));
    setRegenOpen(true);
  }

  function confirmRegen() {
    if (!regenPreview) return;
    replaceMonthBudget(month, { budget: regenPreview.budget, envelopes: regenPreview.envelopes });
    const funded = data.goals.filter((g) => g.name.trim() && g.target > 0);
    regenPreview.adaptive.goalRequests.forEach((request, i) => {
      const goal = funded[i];
      if (goal) updateGoal(goal.id, { autoMonthly: request.monthly });
    });
    toast.success("Plan regenerated", { description: "Envelopes and goal funding now follow your latest income and spending." });
    setRegenOpen(false);
  }

  function changeMonth(delta: number) {
    setMonth((m) => (delta < 0 ? previousMonthKey(m) : nextMonthKey(m)));
  }

  const savingsEnv = snap.envelopes.find((e) => e.group === "savings");
  const isCurrent = month === monthKey();

  return (
    <div>
      <PageHeader
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1"><CalendarDays /> {isCurrent ? "Current month" : monthLabel(month)}</Badge>
            {data.profile.incomeType === "irregular" && <Badge variant="outline">Irregular income — averaged</Badge>}
            {overAllocated && <Badge variant="warning"><AlertTriangle /> Allocations exceed income</Badge>}
          </div>
        }
        title="Smart budget"
        description="An adaptive plan that funds your savings goals first, then sizes necessities to your income and lifestyle, not a fixed 50/30/20 split. Edit anything — warning colours show when an envelope is tight."
        actions={
          <>
            <div className="flex h-9 items-center rounded-xl border border-border bg-card shadow-sm">
              <Button variant="ghost" size="icon-sm" className="m-0.5" onClick={() => changeMonth(-1)} aria-label="Previous month">
                <ChevronLeft />
              </Button>
              <span className="min-w-[104px] px-1 text-center text-[12.5px] font-semibold">{monthLabel(month, true)}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="m-0.5"
                onClick={() => changeMonth(1)}
                disabled={month >= nextMonthKey(monthKey())}
                aria-label="Next month"
              >
                <ChevronRight />
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={openRegen}><RefreshCw /> Regenerate</Button>
          </>
        }
      />

      {snap.envelopes.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Sparkles />}
            title="No budget plan for this month yet"
            description="Generate an adaptive plan from your profile and spending history. You can edit every envelope afterwards."
            action={<Button onClick={openRegen}><RefreshCw /> Generate budget</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-8">
              <CardContent className="p-5 sm:p-6">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">Income basis</p>
                    <Money value={income} currency={currency} animate={false} className="mt-1 block text-[17px] font-semibold tracking-tight" />
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                      {data.profile.incomeType === "irregular" ? "3-month average" : "Fixed monthly"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">Planned</p>
                    <Money value={totalAllocated} currency={currency} animate={false} className={cn("mt-1 block text-[17px] font-semibold tracking-tight", overAllocated && "text-danger")} />
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground">{formatPct((totalAllocated / Math.max(1, income)) * 100)} of income</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">Spent so far</p>
                    <Money value={snap.totalSpent} currency={currency} animate={false} className="mt-1 block text-[17px] font-semibold tracking-tight text-danger" />
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground">{Math.round(snap.budgetUsedPct)}% of spending plan</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">Left in envelopes</p>
                    <Money value={snap.remaining} currency={currency} animate={false} className="mt-1 block text-[17px] font-semibold tracking-tight text-success" />
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground">{isFuture ? "Starts next month" : `${monthLabel(month, true)} plan`}</p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {groupTotals.map(({ group, allocated, spent }) => {
                    const target = budget?.split[group] ?? 0;
                    const share = income ? (allocated / income) * 100 : 0;
                    return (
                      <div key={group} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-[11.5px] font-semibold">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: GROUP_META[group].color }} />
                            {GROUP_META[group].label}
                          </span>
                          <span className="text-[10.5px] text-muted-foreground">{formatPct(target)} target</span>
                        </div>
                        <div className="mt-2 flex items-baseline justify-between">
                          <span className="text-[13px] font-semibold tabular">{formatMoney(allocated, currency)}</span>
                          <span className={cn("text-[10.5px] tabular", Math.abs(share - target) > 6 ? "text-warning" : "text-muted-foreground")}>{formatPct(share)} actual</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, target)}%`, backgroundColor: GROUP_META[group].color, opacity: 0.35 }} />
                        </div>
                        <div className="relative -mt-[9px] h-1.5 overflow-hidden rounded-full">
                          <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, share)}%`, backgroundColor: GROUP_META[group].color }} />
                        </div>
                        <p className="mt-1.5 text-[10px] text-muted-foreground">
                          {group === "savings" ? "Protected for goals" : `${formatMoney(spent, currency)} spent`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-4">
              <CardContent className="flex h-full flex-col p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-[12.5px] font-semibold"><ShieldCheck className="h-4 w-4 text-primary" /> Budget health</p>
                  <Badge variant={snap.health.score >= 65 ? "success" : snap.health.score >= 45 ? "warning" : "danger"}>{snap.health.label}</Badge>
                </div>
                <div className="mt-4 flex items-end gap-2">
                  <span className="text-[2.25rem] font-semibold leading-none tabular">{snap.health.score}</span>
                  <span className="pb-1 text-[11px] text-muted-foreground">/ 100</span>
                </div>
                <Progress
                  value={snap.health.score}
                  className="mt-3 h-2"
                  indicatorClassName={snap.health.score >= 65 ? "bg-success" : snap.health.score >= 45 ? "bg-warning" : "bg-danger"}
                />
                <div className="mt-4 space-y-2 border-t border-border/60 pt-3 text-[11.5px]">
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Envelope usage</span><span className="font-semibold tabular">{Math.round(snap.health.usage * 100)}%</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Actual savings</span><span className="font-semibold tabular">{formatMoney(snap.health.actualSavings, currency)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Over budget</span><span className={cn("font-semibold", snap.overspentEnvelopes.length ? "text-danger" : "text-success")}>{snap.overspentEnvelopes.length} envelope{snap.overspentEnvelopes.length === 1 ? "" : "s"}</span></div>
                </div>
                <div className="mt-auto pt-4 text-[11px] leading-relaxed text-muted-foreground">
                  Scored from savings progress, envelope discipline, overdue bills and income buffer.
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Plan vs money flows vs actual</CardTitle>
                  <p className="text-[11.5px] text-muted-foreground">
                    Envelope target, committed money flows and payments recorded this month, per flow category.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[10.5px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-200" /> Plan target</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-600" /> Money flows</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Actual</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {flowRows.length === 0 ? (
                <p className="py-6 text-center text-[11.5px] text-muted-foreground">
                  Add a money flow or record a payment to see the comparison.
                </p>
              ) : (
                <div className="w-full overflow-x-auto">
                  <div className="h-[250px] min-w-[560px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={flowRows} margin={{ top: 8, right: 4, left: -16, bottom: 0 }} barGap={3}>
                        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
                        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10.5 }} dy={6} interval={0} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} tickFormatter={(v) => formatCompact(Number(v), currency)} width={58} />
                        <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />
                        <Bar dataKey="planned" name="Plan target" fill="#c7d2fe" radius={[5, 5, 0, 0]} maxBarSize={18} />
                        <Bar dataKey="flows" name="Money flows" fill="#4f46e5" radius={[5, 5, 0, 0]} maxBarSize={18} />
                        <Bar dataKey="actual" name="Actual" fill="#f59e0b" radius={[5, 5, 0, 0]} maxBarSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
              <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
                Payments from this app, PayPal or autopay update the Actual bar immediately. A payment with no known flow is kept under Others until it is tagged.
              </p>
            </CardContent>
          </Card>

          {isCurrent && (
            <div className="mt-3">
              <InfoNote icon={<ShieldCheck />}>
                Green means comfortable, amber appears at 80% used, and rose means the envelope is over. Unspent money can be rolled into a savings goal at month end.
              </InfoNote>
            </div>
          )}

          <div className="mt-5 grid gap-4 xl:grid-cols-3">
            {groupTotals.map(({ group, envs, allocated, spent }) => (
              <Card key={group} className="flex h-full flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: GROUP_META[group].color }} />
                      {GROUP_META[group].label}
                    </CardTitle>
                    <span className="text-[11px] text-muted-foreground">
                      {group === "savings" ? formatMoney(allocated, currency) : `${formatMoney(spent, currency)} / ${formatMoney(allocated, currency)}`}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-muted-foreground">{GROUP_HINT[group]}</p>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col space-y-2.5">
                  {envs.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-4 text-center text-[11.5px] text-muted-foreground">
                      Nothing allocated here this month.
                    </div>
                  ) : group === "savings" ? (
                    <div className="rounded-xl border border-success/20 bg-success-soft/40 p-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-success/10 text-success"><PiggyBank className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12.5px] font-semibold">Protected savings</p>
                          <p className="text-[10.5px] text-muted-foreground">{formatMoney(allocated, currency)} kept out of spending</p>
                        </div>
                        {savingsEnv && (
                          <Button variant="ghost" size="icon-sm" onClick={() => openEdit(savingsEnv)} aria-label="Edit savings allocation"><Pencil /></Button>
                        )}
                      </div>
                      <div className="mt-3 space-y-1.5">
                        {data.goals.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">No goals yet. <Link to="/app/goals" className="font-medium text-primary hover:underline">Create one</Link> to give this money a purpose.</p>
                        ) : (
                          data.goals.slice(0, 3).map((g) => (
                            <div key={g.id} className="flex items-center gap-2 text-[11px]">
                              <CategoryIcon name={g.icon} className="h-3.5 w-3.5 text-success" />
                              <span className="min-w-0 flex-1 truncate">{g.name}</span>
                              <span className="tabular text-muted-foreground">{formatMoney(g.autoMonthly ?? 0, currency)}/mo</span>
                            </div>
                          ))
                        )}
                      </div>
                      {(budget?.rollover ?? 0) > 0 ? (
                        <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-success/10 px-2.5 py-2 text-[11px] font-medium text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" /> {formatMoney(budget?.rollover ?? 0, currency)} rolled into goals
                        </div>
                      ) : canRollover && rolloverAmount > 0 ? (
                        <Button variant="outline" size="sm" className="mt-3 w-full border-success/30 text-success hover:bg-success-soft" onClick={openRollover}>
                          <Target /> Roll {formatMoney(rolloverAmount, currency)} to a goal
                        </Button>
                      ) : (
                        <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">
                          {data.goals.length ? "Unspent envelopes can be rolled into a goal after this month closes." : "Add a goal to receive unspent envelope money."}
                        </p>
                      )}
                    </div>
                  ) : (
                    envs.map((env) => {
                      const used = envelopeSpent(env, data.transactions, month);
                      const ratio = env.allocated > 0 ? (used / env.allocated) * 100 : used > 0 ? 100 : 0;
                      const over = used > env.allocated && env.allocated > 0;
                      const warning = !over && ratio >= 80;
                      const left = Math.max(0, env.allocated - used);
                      return (
                        <div key={env.id} className={cn("rounded-xl border p-3 transition-colors", over ? "border-danger/25 bg-danger-soft/30" : warning ? "border-warning/25 bg-warning-soft/30" : "border-border/70")}>
                          <div className="flex items-start gap-2.5">
                            <span
                              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                              style={{ backgroundColor: `${GROUP_META[group].color}14`, color: GROUP_META[group].color }}
                            >
                              <CategoryIcon name={env.icon} className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-[12.5px] font-semibold">{env.name}</p>
                                <span className="shrink-0 text-[11px] font-medium tabular text-muted-foreground">
                                  {formatMoney(used, currency)} <span className="font-normal">/ {formatMoney(env.allocated, currency)}</span>
                                </span>
                              </div>
                              <Progress
                                value={Math.min(100, ratio)}
                                className="mt-2 h-1.5"
                                indicatorClassName={over ? "bg-danger" : warning ? "bg-warning" : "bg-success"}
                              />
                              <div className="mt-1.5 flex items-center justify-between gap-2">
                                <span className={cn("text-[10.5px] font-medium", over ? "text-danger" : warning ? "text-warning" : "text-muted-foreground")}>
                                  {over
                                    ? `${formatMoney(used - env.allocated, currency)} over`
                                    : warning
                                      ? `${Math.round(ratio)}% used · ${formatMoney(left, currency)} left`
                                      : `${formatMoney(left, currency)} left`}
                                </span>
                                <div className="flex shrink-0 gap-0.5">
                                  <Button variant="ghost" size="icon-sm" onClick={() => openEdit(env)} aria-label={`Edit ${env.name} allocation`}><Pencil /></Button>
                                  <Button variant="ghost" size="icon-sm" onClick={() => openMove(env)} disabled={env.allocated <= 0} aria-label={`Move money from ${env.name}`}><ArrowRightLeft /></Button>
                                </div>
                              </div>
                              {over && <Badge variant="danger" className="mt-1.5"><AlertTriangle /> Over budget</Badge>}
                              {warning && <Badge variant="warning" className="mt-1.5"><AlertTriangle /> {ratio >= 99.5 ? "Envelope fully used" : "80% warning"}</Badge>}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {snap.unbudgetedSpend > 0 && (
            <div className="mt-3">
              <InfoNote icon={<AlertTriangle />}>
                {formatMoney(snap.unbudgetedSpend, currency)} of spending this month is outside any envelope. Regenerate the plan to fold those categories back in.
              </InfoNote>
            </div>
          )}

          {overAllocated && (
            <div className="mt-3">
              <InfoNote icon={<AlertTriangle />} className="border-warning/30 bg-warning-soft/40 text-warning">
                Your envelopes total more than this month's income. Reduce an allocation or regenerate the plan before spending.
              </InfoNote>
            </div>
          )}

          <div className="mt-5 flex flex-col items-center justify-between gap-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-soft sm:flex-row">
            <p className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Next month's plan adapts automatically as you record transactions.
            </p>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/app/goals">Manage goals <ArrowRight /></Link>
            </Button>
          </div>
        </>
      )}

      {/* Edit envelope */}
      <Dialog open={!!editEnv} onOpenChange={(open) => !open && setEditEnv(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editEnv?.name} allocation</DialogTitle>
            <DialogDescription>
              Change how much of {monthLabel(month)} income is reserved for this envelope. Spending already recorded stays as is.
            </DialogDescription>
          </DialogHeader>
          {editEnv && (
            <form onSubmit={saveEdit} className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-[12px]">
                <div className="flex justify-between"><span className="text-muted-foreground">Currently allocated</span><span className="font-semibold tabular">{formatMoney(editEnv.allocated, currency)}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-muted-foreground">Already spent</span><span className="font-semibold tabular">{editEnv.group === "savings" ? "—" : formatMoney(envelopeSpent(editEnv, data.transactions, month), currency)}</span></div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="env-amount">New allocation</Label>
                <MoneyInput id="env-amount" value={editAmount} currency={currency} onChange={setEditAmount} className="h-12 text-lg" />
                {editEnv.group !== "savings" && parseToInr(editAmount, currency) < envelopeSpent(editEnv, data.transactions, month) && (
                  <p className="text-[11px] text-warning">This is below what you have already spent — the envelope will show as over budget.</p>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditEnv(null)}>Cancel</Button>
                <Button type="submit">Save allocation</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Move money */}
      <Dialog open={!!moveFrom} onOpenChange={(open) => !open && setMoveFrom(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move money between envelopes</DialogTitle>
            <DialogDescription>Balance your plan without changing the total. You cannot move more than the unspent amount.</DialogDescription>
          </DialogHeader>
          {moveFrom && (
            <form onSubmit={saveMove} className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-border bg-muted/30 p-3">
                  <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">From</p>
                  <p className="mt-1 text-[12.5px] font-semibold">{moveFrom.name}</p>
                  <p className="text-[10.5px] text-muted-foreground">{formatMoney(moveFrom.allocated, currency)} allocated</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/30 p-3">
                  <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">To</p>
                  <p className="mt-1 truncate text-[12.5px] font-semibold">
                    {data.envelopes.find((e) => e.id === moveToId)?.name ?? "Choose below"}
                  </p>
                  <p className="text-[10.5px] text-muted-foreground">Same month budget</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="move-to">Destination envelope</Label>
                <Select value={moveToId} onValueChange={setMoveToId}>
                  <SelectTrigger id="move-to"><SelectValue placeholder="Choose an envelope" /></SelectTrigger>
                  <SelectContent>
                    {data.envelopes
                      .filter((e) => e.budgetId === moveFrom.budgetId && e.id !== moveFrom.id)
                      .map((e) => <SelectItem key={e.id} value={e.id}>{e.name} · {GROUP_META[e.group].label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="move-amount">Amount</Label>
                <MoneyInput id="move-amount" value={moveAmount} currency={currency} onChange={setMoveAmount} />
                <p className="text-[11px] text-muted-foreground">Available to move: {formatMoney(moveFrom.allocated, currency)}</p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setMoveFrom(null)}>Cancel</Button>
                <Button type="submit"><ArrowRightLeft /> Move money</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Rollover */}
      <Dialog open={rolloverOpen} onOpenChange={setRolloverOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Roll unspent money into a goal</DialogTitle>
            <DialogDescription>
              Unspent envelope money for {monthLabel(month)} moves into the savings goal you choose. This only records the rollover once.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-success/25 bg-success-soft/50 px-3.5 py-3">
              <span className="text-[12px] text-muted-foreground">Available to roll over</span>
              <span className="text-[15px] font-semibold tabular text-success">{formatMoney(rolloverAmount, currency)}</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rollover-goal">Savings goal</Label>
              <Select value={goalId} onValueChange={setGoalId}>
                <SelectTrigger id="rollover-goal"><SelectValue placeholder="Choose a goal" /></SelectTrigger>
                <SelectContent>
                  {data.goals.map((g) => <SelectItem key={g.id} value={g.id}>{g.name} · {formatMoney(g.saved, currency)} saved</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRolloverOpen(false)}>Cancel</Button>
              <Button variant="success" onClick={confirmRollover} disabled={!goalId || rolloverAmount <= 0}><PiggyBank /> Roll over</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Regenerate */}
      <Dialog open={regenOpen} onOpenChange={(open) => { setRegenOpen(open); if (!open) setRegenPreview(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate this month's plan?</DialogTitle>
            <DialogDescription>
              The engine recalculates from your income, fixed obligations and the last two months of spending. Your current envelope edits will be replaced.
            </DialogDescription>
          </DialogHeader>
          {regenPreview && (
            <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3.5 text-[12px]">
              <div className="flex justify-between"><span className="text-muted-foreground">Income basis</span><span className="font-semibold tabular">{formatMoney(regenPreview.incomeBasis, currency)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Fixed obligations</span><span className="font-semibold tabular">{formatMoney(regenPreview.fixedTotal, currency)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Protected savings</span><span className="font-semibold tabular text-success">{formatMoney(regenPreview.savingsAllocated, currency)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Envelopes</span><span className="font-semibold">{regenPreview.envelopes.length}</span></div>
              <div className="flex justify-between border-t border-border/60 pt-2"><span className="text-muted-foreground">Split</span><span className="font-semibold tabular">{regenPreview.budget.split.necessities} / {regenPreview.budget.split.wants} / {regenPreview.budget.split.savings}</span></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegenOpen(false)}>Keep current plan</Button>
            <Button onClick={confirmRegen} disabled={!regenPreview}><RefreshCw /> Regenerate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
