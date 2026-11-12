import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Flame,
  PiggyBank,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader, Badge, EmptyState, InfoNote, Progress } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/form";
import { CategoryIcon } from "@/components/ui/category-icon";
import { Money } from "@/components/ui/money";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { useAppData } from "@/lib/app-context";
import { dailySpendSeries, lastMonthComparison, monthTotals, spendByCategory } from "@/lib/finance";
import { addMonths, fmtDate, fmtDateLong, lastNMonths, monthKey, monthLabel, parseISO, previousMonthKey, todayISO } from "@/lib/dates";
import { formatCompact, formatMoney, formatPct } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Category, Transaction } from "@/lib/types";

type Range = "1m" | "3m" | "6m" | "year" | "custom";

const RANGE_LABEL: Record<Range, string> = {
  "1m": "This month",
  "3m": "Last 3 months",
  "6m": "Last 6 months",
  year: "This year",
  custom: "Custom range",
};

function monthsBetween(startISO: string, endISO: string) {
  const out: string[] = [];
  let cursor = parseISO(`${startISO.slice(0, 7)}-01`);
  const end = parseISO(`${endISO.slice(0, 7)}-01`);
  while (cursor <= end && out.length < 24) {
    out.push(monthKey(cursor));
    cursor = addMonths(cursor, 1);
  }
  return out.length ? out : [monthKey()];
}

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  icon?: string;
  amount: number;
  count: number;
  pct: number;
}

function aggregateCategories(txns: Transaction[], categories: Category[]): CategoryRow[] {
  const map = new Map<string, { amount: number; count: number }>();
  for (const t of txns) {
    if (t.type !== "expense" || t.transfer) continue;
    const cur = map.get(t.categoryId) ?? { amount: 0, count: 0 };
    cur.amount += t.amount;
    cur.count += 1;
    map.set(t.categoryId, cur);
  }
  const rows = [...map.entries()].map(([id, v]) => {
    const cat = categories.find((c) => c.id === id);
    return { id, name: cat?.name ?? "Other", color: cat?.color ?? "#64748b", icon: cat?.icon, amount: v.amount, count: v.count, pct: 0 };
  });
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return rows.sort((a, b) => b.amount - a.amount).map((r) => ({ ...r, pct: total ? (r.amount / total) * 100 : 0 }));
}

export default function AnalyticsPage() {
  const data = useAppData();
  const currency = data.profile.currency;
  const categories = data.categories;

  const [range, setRange] = useState<Range>("3m");
  const [customFrom, setCustomFrom] = useState(() => `${lastNMonths(3)[0]}-01`);
  const [customTo, setCustomTo] = useState(todayISO());
  const [heatmapMonth, setHeatmapMonth] = useState(monthKey());

  const bounds = useMemo(() => {
    if (range === "1m") return { from: `${monthKey()}-01`, to: todayISO() };
    if (range === "3m") return { from: `${lastNMonths(3)[0]}-01`, to: todayISO() };
    if (range === "6m") return { from: `${lastNMonths(6)[0]}-01`, to: todayISO() };
    if (range === "year") return { from: `${new Date().getFullYear()}-01-01`, to: todayISO() };
    const a = customFrom || `${monthKey()}-01`;
    const b = customTo || todayISO();
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  }, [range, customFrom, customTo]);

  const months = useMemo(() => monthsBetween(bounds.from, bounds.to), [bounds]);

  const filtered = useMemo(
    () => data.transactions.filter((t) => t.date >= bounds.from && t.date <= bounds.to),
    [data.transactions, bounds],
  );

  const totals = useMemo(() => {
    let income = 0;
    let expenses = 0;
    let count = 0;
    for (const t of filtered) {
      if (t.transfer) continue;
      count += 1;
      if (t.type === "income") income += t.amount;
      else expenses += t.amount;
    }
    return { income, expenses, net: income - expenses, count, savingsRate: income ? ((income - expenses) / income) * 100 : 0 };
  }, [filtered]);

  const categoryRows = useMemo(() => aggregateCategories(filtered, categories), [filtered, categories]);

  const donutData = useMemo(() => {
    if (categoryRows.length <= 6) return categoryRows;
    const top = categoryRows.slice(0, 6);
    const rest = categoryRows.slice(6);
    const amount = rest.reduce((s, r) => s + r.amount, 0);
    const count = rest.reduce((s, r) => s + r.count, 0);
    return [...top, { id: "other_group", name: "Other categories", color: "#94a3b8", amount, count, pct: rest.reduce((s, r) => s + r.pct, 0) }];
  }, [categoryRows]);

  const trendMonths = months.length >= 2 ? months : lastNMonths(6);
  const series = useMemo(
    () =>
      trendMonths.map((key) => {
        const t = monthTotals(data.transactions, key);
        return {
          key,
          label: parseISO(`${key}-01`).toLocaleDateString("en-IN", { month: "short" }),
          income: Math.round(t.income),
          expenses: Math.round(t.expenses),
          rate: Math.round(t.savingsRate),
        };
      }),
    [data.transactions, trendMonths],
  );

  const comparison = useMemo(() => lastMonthComparison(data.transactions), [data.transactions]);
  const monthNow = monthKey();
  const prevKey = previousMonthKey(monthNow);

  const movers = useMemo(() => {
    const cur = spendByCategory(data.transactions, monthNow, categories);
    const prev = spendByCategory(data.transactions, prevKey, categories);
    return cur
      .map((row) => {
        const before = prev.find((p) => p.categoryId === row.categoryId)?.amount ?? 0;
        return { ...row, before, delta: row.amount - before };
      })
      .filter((r) => r.before > 0 || r.amount > 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 4);
  }, [data.transactions, categories, monthNow, prevKey]);

  const merchantRows = useMemo(() => {
    const map = new Map<string, { merchant: string; amount: number; count: number; categoryId: string }>();
    for (const t of filtered) {
      if (t.type !== "expense" || t.transfer) continue;
      const key = t.merchant.toLowerCase();
      const cur = map.get(key) ?? { merchant: t.merchant, amount: 0, count: 0, categoryId: t.categoryId };
      cur.amount += t.amount;
      cur.count += 1;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, 6);
  }, [filtered]);

  const heatmapDays = useMemo(() => dailySpendSeries(data.transactions, heatmapMonth), [data.transactions, heatmapMonth]);
  const heatmapTotal = heatmapDays.reduce((s, d) => s + d.amount, 0);
  const heatmapMax = Math.max(1, ...heatmapDays.map((d) => d.amount));
  const heatmapActive = heatmapDays.filter((d) => d.amount > 0).length;
  const heatmapOffset = (parseISO(`${heatmapMonth}-01`).getDay() + 6) % 7;
  const heatmapOptions = useMemo(() => {
    const keys = new Set([...lastNMonths(6), ...months, heatmapMonth]);
    return [...keys].sort((a, b) => b.localeCompare(a));
  }, [months, heatmapMonth]);

  const topCategory = categoryRows[0];
  const topMerchant = merchantRows[0];
  const biggestMover = [...movers].sort((a, b) => b.delta - a.delta)[0];
  const rangeText = `${fmtDateLong(bounds.from)} – ${fmtDateLong(bounds.to)}`;

  const stats = [
    { label: "Income", value: totals.income, icon: ArrowDownLeft, tone: "text-success", soft: "bg-success-soft text-success" },
    { label: "Expenses", value: totals.expenses, icon: ArrowUpRight, tone: "text-danger", soft: "bg-danger-soft text-danger" },
    { label: "Net saved", value: totals.net, icon: PiggyBank, tone: totals.net >= 0 ? "text-success" : "text-danger", soft: "bg-primary-soft text-primary" },
  ];

  const heatTone = (amount: number) => {
    if (amount <= 0) return { background: "hsl(var(--muted) / 0.6)", color: "hsl(var(--muted-foreground))" };
    const ratio = amount / heatmapMax;
    return {
      background: `rgba(79, 70, 229, ${0.12 + ratio * 0.8})`,
      color: ratio > 0.55 ? "#ffffff" : "hsl(var(--foreground))",
    };
  };

  return (
    <div>
      <PageHeader
        eyebrow={<Badge variant="secondary" className="gap-1"><CalendarDays /> {rangeText}</Badge>}
        title="Analytics"
        description={`Where your money went, how your habits are shifting and what to watch. All amounts in ${currency} at indicative rates; wallet transfers are excluded.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={range} onValueChange={(v) => setRange(v as Range)}>
              <SelectTrigger aria-label="Analytics date range" className="h-9 w-[150px] text-[12.5px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
                  <SelectItem key={r} value={r}>{RANGE_LABEL[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {range === "custom" && (
        <Card className="mb-4 p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            <div className="space-y-1">
              <Label htmlFor="an-from" className="text-[11px] text-muted-foreground">From</Label>
              <Input id="an-from" type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className="h-10 text-[13px]" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="an-to" className="text-[11px] text-muted-foreground">To</Label>
              <Input id="an-to" type="date" value={customTo} min={customFrom} max={todayISO()} onChange={(e) => setCustomTo(e.target.value)} className="h-10 text-[13px]" />
            </div>
          </div>
        </Card>
      )}

      {data.transactions.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet />}
            title="Analytics unlock with your first records"
            description="Add a few transactions or load the sample storyline to see category trends, daily rhythms and month-over-month changes."
            action={<Button asChild><Link to="/app/transactions">Go to transactions <ArrowRight /></Link></Button>}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {stats.map((stat) => {
              const Icon = stat.icon;
              return (
                <Card key={stat.label} className="p-3 sm:p-4">
                  <div className="flex items-center gap-2">
                    <span className={`hidden h-7 w-7 items-center justify-center rounded-lg sm:flex ${stat.soft}`}><Icon className="h-3.5 w-3.5" /></span>
                    <p className="text-[11px] font-medium text-muted-foreground sm:text-xs">{stat.label}</p>
                  </div>
                  <Money value={stat.value} currency={currency} signed={stat.label === "Net saved"} animate={false} className={`mt-2 block text-[15px] font-semibold tracking-tight sm:text-lg ${stat.tone}`} />
                  <p className="mt-0.5 hidden text-[10.5px] text-muted-foreground sm:block">{totals.count} transactions in range</p>
                </Card>
              );
            })}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-12">
            {/* Donut */}
            <Card className="lg:col-span-5">
              <CardHeader>
                <CardTitle>Category split</CardTitle>
                <p className="text-[11.5px] text-muted-foreground">{rangeText}</p>
              </CardHeader>
              <CardContent>
                {categoryRows.length === 0 ? (
                  <EmptyState icon={<ReceiptText />} title="No expenses in this range" description="Try a wider date range." className="py-8" />
                ) : (
                  <>
                    <div className="relative h-[210px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={donutData} dataKey="amount" nameKey="name" innerRadius={58} outerRadius={84} paddingAngle={2} stroke="none">
                            {donutData.map((row) => (
                              <Cell key={row.id} fill={row.color} />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTooltip currency={currency} />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Total spent</span>
                        <Money value={totals.expenses} currency={currency} compact animate={false} className="mt-0.5 text-[19px] font-semibold tracking-tight" />
                        <span className="mt-0.5 text-[10px] text-muted-foreground">{categoryRows.length} categories</span>
                      </div>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {donutData.map((row) => (
                        <li key={row.id} className="flex items-center gap-2 text-[11.5px]">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.name}</span>
                          <span className="tabular font-medium">{formatMoney(row.amount, currency)}</span>
                          <span className="w-9 text-right tabular text-[10.5px] text-muted-foreground">{Math.round(row.pct)}%</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Trend */}
            <Card className="lg:col-span-7">
              <CardHeader className="flex-row items-start justify-between">
                <div>
                  <CardTitle>Income vs expenses</CardTitle>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {months.length >= 2 ? `${months.length} months in range · ${currency}` : "Last 6 months for context"}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[10.5px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-600" /> Income</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Expenses</span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[230px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={series} margin={{ top: 8, right: 4, left: -16, bottom: 0 }} barGap={4}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} dy={6} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} tickFormatter={(v) => formatCompact(Number(v), currency)} width={54} />
                      <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />
                      <Bar dataKey="income" name="Income" fill="#4f46e5" radius={[5, 5, 0, 0]} maxBarSize={22} />
                      <Bar dataKey="expenses" name="Expenses" fill="#f59e0b" radius={[5, 5, 0, 0]} maxBarSize={22} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {months.length === 1 && <p className="mt-1 text-[10.5px] text-muted-foreground">A single month is too short for a trend, so the last six months are shown.</p>}
              </CardContent>
            </Card>

            {/* Savings rate */}
            <Card className="lg:col-span-7">
              <CardHeader>
                <CardTitle>Savings rate over time</CardTitle>
                <p className="text-[11.5px] text-muted-foreground">Share of income kept each month · target 20%</p>
              </CardHeader>
              <CardContent>
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} dy={6} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} width={46} domain={[-20, 70]} />
                      <ReferenceLine y={20} stroke="#059669" strokeDasharray="4 4" strokeOpacity={0.6} />
                      <ReferenceLine y={0} stroke="hsl(var(--border))" />
                      <Tooltip content={<ChartTooltip currency={currency} formatter={(value) => `${Math.round(value)}%`} />} />
                      <Line type="monotone" dataKey="rate" name="Savings rate" stroke="#4f46e5" strokeWidth={2.4} dot={{ r: 2.5, strokeWidth: 0, fill: "#4f46e5" }} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-1 flex items-center justify-between text-[10.5px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="h-px w-5 border-t border-dashed border-emerald-600" /> 20% guardian target</span>
                  <span>Current month is partial</span>
                </div>
              </CardContent>
            </Card>

            {/* MoM */}
            <Card className="lg:col-span-5">
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Month over month</CardTitle>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">{monthLabel(monthNow)} vs {monthLabel(prevKey, true)}</p>
                </div>
                <Badge variant={comparison.pctChange <= 0 ? "success" : "warning"}>
                  {comparison.pctChange <= 0 ? <TrendingDown /> : <TrendingUp />} {formatPct(Math.abs(comparison.pctChange))} spend
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "Expenses", cur: comparison.cur.expenses, prev: comparison.prev.expenses, goodWhenDown: true },
                  { label: "Income", cur: comparison.cur.income, prev: comparison.prev.income, goodWhenDown: false },
                  { label: "Net saved", cur: comparison.cur.net, prev: comparison.prev.net, goodWhenDown: false },
                ].map((row) => {
                  const delta = row.prev ? ((row.cur - row.prev) / Math.abs(row.prev)) * 100 : 0;
                  const good = row.goodWhenDown ? delta <= 0 : delta >= 0;
                  return (
                    <div key={row.label} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2.5">
                      <div>
                        <p className="text-[11.5px] font-medium">{row.label}</p>
                        <p className="text-[10px] text-muted-foreground">Last month {formatMoney(row.prev, currency)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[12.5px] font-semibold tabular">{formatMoney(row.cur, currency)}</p>
                        <p className={cn("flex items-center justify-end gap-0.5 text-[10px] font-medium", good ? "text-success" : "text-danger")}>
                          {delta >= 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                          {Math.abs(Math.round(delta))}% vs last month
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div className="border-t border-border/60 pt-3">
                  <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Biggest category moves</p>
                  <div className="space-y-1.5">
                    {movers.length === 0 && <p className="text-[11.5px] text-muted-foreground">Not enough history for category comparisons yet.</p>}
                    {movers.map((m) => (
                      <div key={m.categoryId} className="flex items-center gap-2 text-[11.5px]">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{m.name}</span>
                        <span className={cn("tabular font-medium", m.delta > 0 ? "text-danger" : "text-success")}>
                          {m.delta > 0 ? "+" : "−"}{formatMoney(Math.abs(m.delta), currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Heatmap */}
            <Card className="lg:col-span-7">
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-1.5"><Flame className="h-4 w-4 text-warning" /> Daily spending heatmap</CardTitle>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">{formatMoney(heatmapTotal, currency)} across {heatmapActive} active days</p>
                </div>
                <Select value={heatmapMonth} onValueChange={setHeatmapMonth}>
                  <SelectTrigger aria-label="Heatmap month" className="h-8 w-[128px] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {heatmapOptions.map((key) => <SelectItem key={key} value={key}>{monthLabel(key, true)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-7 gap-1.5 text-center text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={`${d}-${i}`}>{d}</span>)}
                </div>
                <div className="mt-1.5 grid grid-cols-7 gap-1.5">
                  {Array.from({ length: heatmapOffset }).map((_, i) => <span key={`offset-${i}`} aria-hidden />)}
                  {heatmapDays.map((d) => (
                    <div
                      key={d.day}
                      role="img"
                      aria-label={`${d.day} ${monthLabel(heatmapMonth, true)}: ${formatMoney(d.amount, currency)}`}
                      title={`${fmtDate(`${heatmapMonth}-${String(d.day).padStart(2, "0")}`, "d MMM")} · ${formatMoney(d.amount, currency)}`}
                      style={heatTone(d.amount)}
                      className="flex aspect-square min-h-[26px] items-center justify-center rounded-[6px] text-[10px] font-medium transition-transform hover:scale-105"
                    >
                      {d.day}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Darker means more spent that day.</span>
                  <span className="flex items-center gap-1">
                    Less
                    <span className="h-2.5 w-2.5 rounded-[3px] bg-indigo-600/15" />
                    <span className="h-2.5 w-2.5 rounded-[3px] bg-indigo-600/45" />
                    <span className="h-2.5 w-2.5 rounded-[3px] bg-indigo-600/80" />
                    More
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Top merchants */}
            <Card className="lg:col-span-5">
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Top merchants</CardTitle>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">By spend in this range</p>
                </div>
                <Link to="/app/transactions" className="text-[11px] font-semibold text-primary hover:underline">Transactions</Link>
              </CardHeader>
              <CardContent>
                {merchantRows.length === 0 ? (
                  <p className="py-6 text-center text-[12px] text-muted-foreground">No expenses in this range.</p>
                ) : (
                  <ol className="space-y-2.5">
                    {merchantRows.map((m, i) => {
                      const cat = categories.find((c) => c.id === m.categoryId);
                      return (
                        <li key={m.merchant} className="flex items-center gap-2.5">
                          <span className="w-4 text-[10.5px] font-semibold tabular text-muted-foreground">{i + 1}</span>
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${cat?.color ?? "#64748b"}14`, color: cat?.color ?? "#64748b" }}>
                            <CategoryIcon name={cat?.icon} className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-[12px] font-medium">{m.merchant}</span>
                              <span className="shrink-0 text-[11.5px] font-semibold tabular">{formatMoney(m.amount, currency)}</span>
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <Progress value={(m.amount / merchantRows[0].amount) * 100} className="h-1" indicatorClassName="bg-primary/70" />
                              <span className="shrink-0 text-[9.5px] text-muted-foreground">{m.count}×</span>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Where did my money go */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Where did my money go?</CardTitle>
              <p className="text-[11.5px] text-muted-foreground">Plain-language read of the selected range</p>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-primary/15 bg-primary-soft/40 p-3.5 text-[12.5px] leading-relaxed">
                You spent <strong><Money value={totals.expenses} currency={currency} animate={false} /></strong> across {totals.count} recorded transactions between {fmtDate(bounds.from, "d MMM")} and {fmtDate(bounds.to, "d MMM yyyy")}.
                {topCategory && (
                  <> <strong>{topCategory.name}</strong> was the biggest drain at <strong>{Math.round(topCategory.pct)}%</strong> ({formatMoney(topCategory.amount, currency)}).</>
                )}
                {topMerchant && (
                  <> Your most frequent large merchant was <strong>{topMerchant.merchant}</strong> at {formatMoney(topMerchant.amount, currency)} over {topMerchant.count} transaction{topMerchant.count === 1 ? "" : "s"}.</>
                )}
                {biggestMover && (
                  <> Versus last month, <strong>{biggestMover.name}</strong> moved {biggestMover.delta >= 0 ? "up" : "down"} {formatMoney(Math.abs(biggestMover.delta), currency)}.</>
                )}
                {totals.income > 0 && (
                  <> You kept <strong>{Math.round(totals.savingsRate)}%</strong> of income in this range.</>
                )}
              </div>

              <div className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2">
                {categoryRows.map((row) => (
                  <div key={row.id}>
                    <div className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                        <span className="truncate">{row.name}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{row.count}×</span>
                      </span>
                      <span className="shrink-0 font-medium tabular">{formatMoney(row.amount, currency)} <span className="text-[10.5px] font-normal text-muted-foreground">{Math.round(row.pct)}%</span></span>
                    </div>
                    <Progress value={row.pct} className="mt-1.5 h-1.5" indicatorClassName="bg-primary/60" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="mt-4">
            <InfoNote icon={<ArrowRight />}>
              Totals ignore transfers between your own accounts. Month-over-month compares full calendar months, while the selected range above may be partial.
            </InfoNote>
          </div>
        </>
      )}
    </div>
  );
}
