import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowDownLeft, ArrowRight, ArrowUpRight, BellRing, CalendarDays, PiggyBank,
  ReceiptText, ShieldCheck, Sparkles, Target, TrendingDown, TrendingUp, Wallet, Zap,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp, useAppData } from "@/lib/app-context";
import { useUI } from "@/components/layout/ui-context";
import { formatMoney, formatCompact } from "@/lib/money";
import { Money } from "@/components/ui/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Progress, EmptyState, PageHeader } from "@/components/ui/misc";
import { CategoryIcon } from "@/components/ui/category-icon";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import {
  budgetSnapshot, buildInsights, goalProgress, incomeExpenseSeries, monthTotals, safeToSpend,
  upcomingBills, upcomingReminders,
} from "@/lib/finance";
import { dayOfMonth, daysUntil, fmtDate, monthKey, monthLabel, previousMonthKey, relativeDue } from "@/lib/dates";
import { guardianDailyLine } from "@/lib/guardian";
import { cn } from "@/lib/utils";

const severityMeta = {
  critical: { icon: AlertTriangle, badge: "danger" as const, label: "Critical", ring: "border-danger/20 bg-danger-soft/60", iconTone: "text-danger", cta: "Review now" },
  warning: { icon: AlertTriangle, badge: "warning" as const, label: "Warning", ring: "border-warning/20 bg-warning-soft/60", iconTone: "text-warning", cta: "Review" },
  info: { icon: Sparkles, badge: "default" as const, label: "Insight", ring: "border-primary/15 bg-primary-soft/50", iconTone: "text-primary", cta: "Open" },
  positive: { icon: ShieldCheck, badge: "success" as const, label: "On track", ring: "border-success/20 bg-success-soft/60", iconTone: "text-success", cta: "View" },
};

export default function DashboardPage() {
  const data = useAppData();
  const { loadSample } = useApp();
  const { openQuickAdd } = useUI();
  const currency = data.profile.currency;
  const month = monthKey();
  const snap = budgetSnapshot(data, month);
  const totals = snap.totals;
  const safe = safeToSpend(data);
  const insights = buildInsights(data, currency);
  const topInsight = insights[0];
  const bills = upcomingBills(data, 14).slice(0, 3);
  const reminders = upcomingReminders(data).filter((r) => daysUntil(r.dueDate) <= 14).slice(0, 2);
  const goals = data.goals.slice(0, 2);
  const series = incomeExpenseSeries(data.transactions, 6);
  const hasTrend = series.some((p) => p.income > 0 || p.expenses > 0);
  const totalBalance = data.accounts.reduce((s, a) => s + a.balance, 0);

  const prevKey = previousMonthKey(month);
  const prevDay = Math.min(dayOfMonth(), 28);
  const prevCutoff = `${prevKey}-${String(prevDay).padStart(2, "0")}`;
  const currentExpense = data.transactions
    .filter((t) => t.type === "expense" && !t.transfer && t.date.startsWith(month))
    .reduce((s, t) => s + t.amount, 0);
  const prevExpenseToDate = data.transactions
    .filter((t) => t.type === "expense" && !t.transfer && t.date.startsWith(prevKey) && t.date <= prevCutoff)
    .reduce((s, t) => s + t.amount, 0);
  const expenseDelta = prevExpenseToDate ? ((currentExpense - prevExpenseToDate) / prevExpenseToDate) * 100 : 0;
  const prevTotals = monthTotals(data.transactions, prevKey);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = data.profile.name.split(" ")[0];
  const isEmpty = data.transactions.length === 0;

  const ringValue = snap.health.score;
  const ringColor = ringValue >= 80 ? "#059669" : ringValue >= 65 ? "#4f46e5" : ringValue >= 45 ? "#d97706" : "#e11d48";
  const circumference = 2 * Math.PI * 42;

  return (
    <div>
      <PageHeader
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1"><CalendarDays /> {monthLabel(month)}</Badge>
            {data.profile.demo && <Badge variant="default">Demo data</Badge>}
            {data.profile.incomeType === "irregular" && <Badge variant="outline">Irregular income</Badge>}
          </div>
        }
        title={`${greeting}, ${firstName}`}
        description={guardianDailyLine(data, currency)}
        actions={
          <>
            <Button variant="outline" onClick={() => openQuickAdd("income")} className="hidden sm:inline-flex"><ArrowDownLeft /> Add income</Button>
            <Button onClick={() => openQuickAdd("expense")}><ArrowUpRight /> Add expense</Button>
          </>
        }
      />

      {isEmpty ? (
        <Card className="mb-5">
          <EmptyState
            icon={<Wallet />}
            title="Your guardian is ready for its first record"
            description="Add income and a few expenses to unlock envelopes, safe-to-spend and grounded insights. Or load the sample storyline to explore."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => openQuickAdd("expense")}><ArrowUpRight /> Add an expense</Button>
                <Button variant="outline" onClick={() => loadSample()}><Sparkles /> Load sample data</Button>
              </div>
            }
          />
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-12">
        {/* Net balance */}
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-[#312e81] via-[#3730a3] to-[#1e1b4b] text-white shadow-lift md:col-span-5">
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-indigo-400/20 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 left-1/3 h-40 w-40 rounded-full bg-emerald-400/10 blur-2xl" />
          <div className="relative p-5 sm:p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-indigo-200">Net balance</p>
                <p className="mt-2 text-[2rem] font-semibold leading-none tracking-tight tabular">
                  <Money value={totalBalance} currency={currency} />
                </p>
                <p className="mt-2 text-[11.5px] text-indigo-200/80">Across wallet, bank and card</p>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                <Wallet className="h-4 w-4 text-indigo-100" />
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <div className="rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10">
                <p className="flex items-center gap-1 text-[10px] font-medium text-indigo-200"><ArrowDownLeft className="h-3 w-3" /> Income this month</p>
                <p className="mt-1 text-[15px] font-semibold tabular">{formatMoney(totals.income, currency)}</p>
                {prevTotals.income > 0 ? (
                  <p className={cn("mt-0.5 text-[10px]", totals.income >= prevTotals.income ? "text-emerald-300" : "text-rose-300")}>
                    {totals.income >= prevTotals.income ? "Ahead of" : "Behind"} {monthLabel(prevKey, true)} so far
                  </p>
                ) : (
                  <p className="mt-0.5 text-[10px] text-indigo-200/80">
                    {totals.income > 0 ? "First income recorded" : "No income recorded yet"}
                  </p>
                )}
              </div>
              <div className="rounded-xl bg-white/[0.07] p-3 ring-1 ring-white/10">
                <p className="flex items-center gap-1 text-[10px] font-medium text-indigo-200"><ArrowUpRight className="h-3 w-3" /> Spent this month</p>
                <p className="mt-1 text-[15px] font-semibold tabular">{formatMoney(totals.expenses, currency)}</p>
                {currentExpense === 0 && prevExpenseToDate === 0 ? (
                  <p className="mt-0.5 text-[10px] text-indigo-200/80">Nothing spent yet</p>
                ) : (
                  <p className={cn("mt-0.5 flex items-center gap-0.5 text-[10px]", expenseDelta > 0 ? "text-rose-300" : "text-emerald-300")}>
                    {expenseDelta > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                    {Math.abs(Math.round(expenseDelta))}% vs same days last month
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-xl bg-white/[0.06] px-3 py-2.5 ring-1 ring-white/10">
              <span className="text-[11px] text-indigo-100">Net this month</span>
              <span className="flex items-center gap-2 text-[13px] font-semibold tabular">
                <Money value={totals.net} currency={currency} signed />
                <Badge className="border-0 bg-emerald-400/20 text-emerald-200">
                  {Math.round(totals.savingsRate)}% saved
                </Badge>
              </span>
            </div>
          </div>
        </Card>

        {/* Budget health ring */}
        <Card className="md:col-span-3">
          <CardContent className="flex h-full flex-col p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-semibold">Budget health</p>
              <Badge variant={ringValue >= 65 ? "success" : ringValue >= 45 ? "warning" : "danger"}>{snap.health.label}</Badge>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center py-4">
              <div className="relative h-[124px] w-[124px]">
                <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={`Budget health ${ringValue} out of 100`}>
                  <circle cx="50" cy="50" r="42" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
                  <circle
                    cx="50" cy="50" r="42" fill="none" stroke={ringColor} strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference - (ringValue / 100) * circumference}
                    className="transition-all duration-1000 ease-spring"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[28px] font-semibold leading-none tabular">{ringValue}</span>
                  <span className="mt-1 text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">out of 100</span>
                </div>
              </div>
            </div>
            <div className="space-y-2 border-t border-border/60 pt-3 text-[11px]">
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Envelopes used</span><span className="font-semibold tabular">{Math.round(snap.budgetUsedPct)}%</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Over budget</span><span className={cn("font-semibold", snap.overspentEnvelopes.length ? "text-danger" : "text-success")}>{snap.overspentEnvelopes.length} envelope{snap.overspentEnvelopes.length === 1 ? "" : "s"}</span></div>
            </div>
          </CardContent>
        </Card>

        {/* Safe to spend */}
        <Card className="relative overflow-hidden border-emerald-200/60 bg-gradient-to-b from-emerald-50/80 to-card dark:border-emerald-500/15 dark:from-emerald-500/[0.07] md:col-span-4">
          <CardContent className="flex h-full flex-col p-5 sm:p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5" /> Safe to spend today
                </p>
                <p className="mt-2 text-[2rem] font-semibold leading-none tracking-tight tabular text-emerald-950 dark:text-emerald-50">
                  <Money value={safe.daily} currency={currency} />
                </p>
                <p className="mt-1.5 text-[11.5px] text-emerald-800/70 dark:text-emerald-200/70">
                  {safe.daysLeft} days left · {formatMoney(safe.upcomingBills, currency)} of bills still due
                </p>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                <Zap className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-4 rounded-xl border border-emerald-200/60 bg-white/60 p-3 text-[11px] leading-relaxed text-emerald-900/80 dark:border-emerald-500/15 dark:bg-emerald-500/5 dark:text-emerald-100/70">
              <span className="font-semibold text-emerald-900 dark:text-emerald-200">How it's calculated: </span>
              {formatMoney(safe.remainingFlex, currency)} flexible left, minus bills, spread over remaining days.
            </div>
            <Button variant="outline" size="sm" asChild className="mt-3 w-fit border-emerald-300/70 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-500/20 dark:text-emerald-200 dark:hover:bg-emerald-500/10">
              <Link to="/app/budget">Open budget <ArrowRight /></Link>
            </Button>
          </CardContent>
        </Card>

        {/* Trend chart */}
        <Card className="md:col-span-7">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Income vs expenses</CardTitle>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">Last 6 months · {currency}</p>
            </div>
            <Link to="/app/analytics" className="text-[11.5px] font-semibold text-primary hover:underline">Analytics</Link>
          </CardHeader>
          <CardContent>
            {hasTrend ? (
              <>
                <div className="h-[230px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                      <defs>
                        <linearGradient id="dashIncome" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="dashExpense" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.22} />
                          <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} dy={6} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} tickFormatter={(v) => formatCompact(Number(v), currency)} width={54} />
                      <Tooltip content={<ChartTooltip currency={currency} />} />
                      <Area type="monotone" dataKey="income" name="Income" stroke="#4f46e5" strokeWidth={2.2} fill="url(#dashIncome)" dot={false} activeDot={{ r: 4 }} />
                      <Area type="monotone" dataKey="expenses" name="Expenses" stroke="#f59e0b" strokeWidth={2.2} fill="url(#dashExpense)" dot={false} activeDot={{ r: 4 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-1 flex items-center gap-4 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-indigo-600" /> Income</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> Expenses</span>
                  {month === monthKey() && <span className="ml-auto text-[10px]">Current month is partial</span>}
                </div>
              </>
            ) : (
              <div className="flex h-[262px] flex-col items-center justify-center text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <TrendingUp className="h-5 w-5" />
                </span>
                <p className="mt-3 text-[13px] font-semibold">No activity to chart yet</p>
                <p className="mt-1 max-w-[240px] text-[11.5px] leading-relaxed text-muted-foreground">
                  Your six-month income and expense trend appears after your first records.
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => openQuickAdd("expense")}>
                  <ArrowUpRight /> Add a transaction
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top insight */}
        <Card className="md:col-span-5">
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary"><Sparkles className="h-3.5 w-3.5" /></span>
              <CardTitle>Guardian's top insight</CardTitle>
            </div>
            <Link to="/app/guardian" className="text-[11.5px] font-semibold text-primary hover:underline">All insights</Link>
          </CardHeader>
          <CardContent>
            {topInsight ? (
              <div className="flex h-full flex-col">
                <div className={cn("rounded-2xl border p-4", severityMeta[topInsight.severity].ring)}>
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={severityMeta[topInsight.severity].badge}>
                      {(() => {
                        const Icon = severityMeta[topInsight.severity].icon;
                        return <Icon />;
                      })()}
                      {severityMeta[topInsight.severity].label}
                    </Badge>
                    {topInsight.amount ? <span className="text-[11px] font-semibold tabular text-muted-foreground">{formatMoney(topInsight.amount, currency)}</span> : null}
                  </div>
                  <p className="mt-2.5 text-[14px] font-semibold leading-snug">{topInsight.title}</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{topInsight.body}</p>
                  <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted-foreground/90"><span className="font-medium text-foreground">Why: </span>{topInsight.reason}</p>
                  <Button size="sm" variant="outline" asChild className="mt-3">
                    <Link to={topInsight.actionHref ?? "/app/guardian"}>{topInsight.actionLabel} <ArrowRight /></Link>
                  </Button>
                </div>
                <div className="mt-auto flex items-center justify-between pt-3 text-[10.5px] text-muted-foreground">
                  <span>{insights.length} actionable insight{insights.length === 1 ? "" : "s"} today</span>
                  <span>Not financial advice</span>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center py-8 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><ShieldCheck className="h-6 w-6" /></span>
                <p className="mt-3 text-[14px] font-semibold">Nothing needs your attention</p>
                <p className="mt-1 max-w-[260px] text-[12px] text-muted-foreground">Envelopes are on track and no unusual charges were found. Ask the Guardian anything about your money.</p>
                <Button variant="outline" size="sm" asChild className="mt-4"><Link to="/app/guardian">Ask the Guardian <ArrowRight /></Link></Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upcoming */}
        <Card className="md:col-span-6">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Upcoming bills & reminders</CardTitle>
            <Link to="/app/bills" className="text-[11.5px] font-semibold text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {bills.length === 0 && reminders.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-8 text-center">
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
                <p className="mt-2 text-[12.5px] font-medium">Nothing due in the next two weeks</p>
                <p className="text-[11px] text-muted-foreground">Your upcoming list is clear.</p>
              </div>
            ) : (
              <>
                {bills.map((b) => (
                  <Link key={b.id} to="/app/bills" className="flex items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-muted/30">
                    <span className={cn("flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg text-[9px] font-bold uppercase leading-none", b.derivedStatus === "overdue" ? "bg-danger-soft text-danger" : b.derivedStatus === "due" ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground")}>
                      <span className="text-[12px]">{b.dueDate.slice(8, 10)}</span>
                      {fmtDate(b.dueDate, "MMM")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <ReceiptText className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate text-[12.5px] font-medium">{b.title}</span>
                      </span>
                      <span className={cn("text-[10.5px]", b.derivedStatus === "overdue" ? "text-danger" : "text-muted-foreground")}>
                        {b.derivedStatus === "overdue" ? relativeDue(b.dueDate) : `${b.derivedStatus === "due" ? "Due " : ""}${relativeDue(b.dueDate)}`}
                      </span>
                    </span>
                    <span className="text-[12.5px] font-semibold tabular">{formatMoney(b.amount, currency)}</span>
                  </Link>
                ))}
                {reminders.map((r) => (
                  <Link key={r.id} to="/app/reminders" className="flex items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-muted/30">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                      <BellRing className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">{r.direction === "owe" ? `You owe ${r.person}` : `${r.person} owes you`}</span>
                      <span className={cn("text-[10.5px]", daysUntil(r.dueDate) < 0 ? "text-danger" : "text-muted-foreground")}>{relativeDue(r.dueDate)}</span>
                    </span>
                    <span className={cn("text-[12.5px] font-semibold tabular", r.direction === "owed" ? "text-success" : "")}>{formatMoney(r.amount, currency)}</span>
                  </Link>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        {/* Goals */}
        <Card className="md:col-span-6">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Savings goals</CardTitle>
            <Link to="/app/goals" className="text-[11.5px] font-semibold text-primary hover:underline">Manage goals</Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {goals.length === 0 ? (
              <EmptyState
                icon={<Target />}
                title="No goals yet"
                description="Give your savings a name and a deadline — the guardian will work out the monthly amount."
                action={<Button size="sm" asChild><Link to="/app/goals">Create a goal</Link></Button>}
                className="py-6"
              />
            ) : (
              goals.map((goal) => {
                const p = goalProgress(goal);
                return (
                  <Link key={goal.id} to="/app/goals" className="block rounded-xl border border-border/70 p-3.5 transition-colors hover:border-primary/30 hover:bg-muted/20">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: `${goal.color}18`, color: goal.color }}>
                        <CategoryIcon name={goal.icon} className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[12.5px] font-semibold">{goal.name}</p>
                          <Badge variant={p.onTrack ? "success" : "warning"}>{p.onTrack ? "On track" : "Behind"}</Badge>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-muted-foreground">
                          <span className="tabular">{formatMoney(goal.saved, currency)} of {formatMoney(goal.target, currency)}</span>
                          <span className="font-semibold text-foreground">{Math.round(p.progress)}%</span>
                        </div>
                        <Progress value={p.progress} className="mt-1.5 h-1.5" indicatorClassName="bg-current" />
                        <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1"><PiggyBank className="h-2.5 w-2.5" /> {formatMoney(p.requiredMonthly, currency)}/mo needed</span>
                          <span>{p.daysLeft} days left</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          { to: "/app/subscriptions", icon: ReceiptText, title: "Subscriptions", stat: `${data.subscriptions.filter((s) => s.status === "active").length} active`, sub: "Find duplicates and waste" },
          { to: "/app/reminders", icon: BellRing, title: "Reminders", stat: `${data.reminders.filter((r) => r.status === "open").length} open`, sub: "Who owes whom, settled" },
          { to: "/app/shopper", icon: Sparkles, title: "Smart Shopper", stat: "Compare 5 sellers", sub: "Trust-weighted best pick" },
        ].map((c) => (
          <Link key={c.to} to={c.to} className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary"><c.icon className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold">{c.title}</p>
              <p className="truncate text-[10.5px] text-muted-foreground">{c.stat} · {c.sub}</p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>

      <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[10.5px] text-muted-foreground">
        <ShieldCheck className="h-3 w-3" /> Guardian suggestions use your recorded data and are not financial advice.
      </p>
    </div>
  );
}
