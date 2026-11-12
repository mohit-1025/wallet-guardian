import type {
  AiInsight,
  Bill,
  Budget,
  BudgetEnvelope,
  Category,
  EnvelopeGroup,
  FlowTab,
  Goal,
  Profile,
  Subscription,
  Transaction,
  Currency,
  UserData,
} from "./types";
import { FLOW_TAB_LABEL, FLOW_TABS, flowTabForBudgetCategory, guessFlowTab } from "./flows";
import { daysInMonth, daysLeftInMonth, lastNMonths, monthKey, nextOccurrence, previousMonthKey, daysUntil, todayISO, parseISO, fmtDate, format } from "./dates";
import { formatMoney } from "./money";
import { differenceInCalendarDays } from "date-fns";
import { clamp, pct, round2, uid } from "./utils";

export const GROUP_META: Record<EnvelopeGroup, { label: string; color: string }> = {
  necessities: { label: "Necessities", color: "#0f766e" },
  wants: { label: "Wants", color: "#d97706" },
  savings: { label: "Savings", color: "#047857" },
};

export const NEEDS_CATEGORIES = ["cat_rent", "cat_groceries", "cat_transport", "cat_utilities", "cat_education", "cat_emi", "cat_health"];
export const WANTS_CATEGORIES = ["cat_food", "cat_shopping", "cat_entertainment", "cat_subscriptions", "cat_travel", "cat_personal", "cat_other"];

const BASELINE_WEIGHTS: Record<string, number> = {
  cat_groceries: 0.36,
  cat_transport: 0.2,
  cat_utilities: 0.26,
  cat_education: 0.12,
  cat_health: 0.06,
  cat_food: 0.34,
  cat_shopping: 0.2,
  cat_entertainment: 0.14,
  cat_subscriptions: 0.18,
  cat_personal: 0.07,
  cat_travel: 0.07,
};

export function monthTotals(txns: Transaction[], key: string) {
  let income = 0;
  let expenses = 0;
  for (const t of txns) {
    if (!t.date.startsWith(key) || t.transfer) continue;
    if (t.type === "income") income += t.amount;
    else expenses += t.amount;
  }
  return { income, expenses, net: income - expenses, savingsRate: income > 0 ? ((income - expenses) / income) * 100 : 0 };
}

export function txnsInMonth(txns: Transaction[], key: string) {
  return txns.filter((t) => t.date.startsWith(key));
}

export function spendByCategory(txns: Transaction[], key: string, categories: Category[]) {
  const map = new Map<string, number>();
  for (const t of txns) {
    if (t.type !== "expense" || t.transfer || !t.date.startsWith(key)) continue;
    map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount);
  }
  return [...map.entries()]
    .map(([categoryId, amount]) => {
      const cat = categories.find((c) => c.id === categoryId);
      return {
        categoryId,
        name: cat?.name ?? "Other",
        color: cat?.color ?? "#64748b",
        amount,
        pct: 0,
      };
    })
    .sort((a, b) => b.amount - a.amount)
    .map((row, _, arr) => {
      const total = arr.reduce((s, r) => s + r.amount, 0);
      return { ...row, pct: total ? (row.amount / total) * 100 : 0 };
    });
}

export function monthlyAverageIncome(txns: Transaction[], months = 3) {
  const keys = lastNMonths(months);
  const totals = keys.map((k) => txns.filter((t) => t.type === "income" && t.date.startsWith(k)).reduce((s, t) => s + t.amount, 0));
  const withData = totals.filter((t) => t > 0);
  if (!withData.length) return 0;
  return withData.reduce((s, t) => s + t, 0) / withData.length;
}

export function avgCategorySpend(txns: Transaction[], categoryIds: string[], months = 2) {
  const keys = lastNMonths(months + 1, new Date()).slice(0, months);
  const out: Record<string, number> = {};
  for (const id of categoryIds) {
    let sum = 0;
    for (const k of keys) {
      sum += txns
        .filter((t) => t.type === "expense" && t.categoryId === id && t.date.startsWith(k))
        .reduce((s, t) => s + t.amount, 0);
    }
    out[id] = sum / Math.max(1, keys.length);
  }
  return out;
}

export interface BudgetGoalInput {
  name: string;
  target: number;
  saved?: number;
  deadline: string;
}

export interface GoalFunding {
  name: string;
  requested: number;
  monthly: number;
}

export interface AdaptiveBudget {
  income: number;
  fixedNeeds: number;
  fixedWants: number;
  essentials: number;
  wants: number;
  savings: number;
  buffer: number;
  goalRequests: GoalFunding[];
  goalRequestedTotal: number;
  goalMonthlyTotal: number;
  goalShortfall: number;
  needsShare: number;
  wantsShare: number;
  savingsShare: number;
  notes: string[];
}

export interface BudgetPlan {
  budget: Budget;
  envelopes: BudgetEnvelope[];
  incomeBasis: number;
  incomeSource: "fixed" | "irregular average";
  fixedTotal: number;
  savingsAllocated: number;
  adaptive: AdaptiveBudget;
}

// Calibration for the adaptive engine: at ₹50k income essentials land near
// ₹25k, and every doubling of income raises them by only ~1.62x (0.7
// exponent). Raising income therefore adds more to savings than to lifestyle.
const NEEDS_REF_INCOME = 50_000;
const NEEDS_REF_AMOUNT = 25_000;
const NEEDS_ELASTICITY = 0.7;

function round10(value: number) {
  return Math.round(value / 10) * 10;
}

function goalMonthlyNeed(goal: BudgetGoalInput) {
  const remaining = Math.max(0, goal.target - (goal.saved ?? 0));
  if (remaining <= 0) return 0;
  const days = Math.max(0, differenceInCalendarDays(parseISO(goal.deadline), new Date()));
  const months = Math.max(1, Math.ceil(days / 30));
  return Math.ceil(remaining / months);
}

/**
 * Adaptive budget AI (deterministic):
 * 1. Model essentials with a sublinear lifestyle curve instead of a fixed 50%.
 * 2. Fund savings goals before discretionary money is handed out.
 * 3. Keep wants at a lifestyle floor that declines as income rises, then save
 *    everything left over — the savings rate climbs with income.
 * 4. Trim wants further when fixed commitments are heavy, and defer goals
 *    proportionally (never silently) when income cannot cover them.
 */
export function adaptiveBudget(
  incomeInput: number,
  fixedNeedsInput: number,
  fixedWantsInput: number,
  goals: BudgetGoalInput[],
): AdaptiveBudget {
  const income = Math.max(0, Math.round(incomeInput));
  const fixedNeeds = Math.max(0, Math.round(fixedNeedsInput));
  const fixedWants = Math.max(0, Math.round(fixedWantsInput));
  const goalRequests: GoalFunding[] = goals
    .filter((g) => g.name.trim() && g.target > 0)
    .map((g) => ({ name: g.name.trim(), requested: goalMonthlyNeed(g), monthly: 0 }));
  const goalRequestedTotal = goalRequests.reduce((s, g) => s + g.requested, 0);
  const notes: string[] = [];
  const share = (value: number) => (income > 0 ? Math.round((value / income) * 100) : 0);

  if (income <= 0) {
    return {
      income: 0, fixedNeeds, fixedWants, essentials: 0, wants: 0, savings: 0, buffer: 0,
      goalRequests, goalRequestedTotal, goalMonthlyTotal: 0, goalShortfall: goalRequestedTotal,
      needsShare: 0, wantsShare: 0, savingsShare: 0,
      notes: ["Add a monthly income so the budget has something to work with."],
    };
  }

  if (fixedNeeds >= income) {
    const essentials = Math.min(income, fixedNeeds);
    const wants = Math.min(Math.max(0, income - essentials), fixedWants);
    const savings = Math.max(0, income - essentials - wants);
    notes.push(
      fixedNeeds > income
        ? `Fixed commitments (${formatMoney(fixedNeeds)}) are larger than income, so there is nothing to split until they shrink.`
        : "Fixed commitments already use your whole income, so goals and wants wait until something frees up.",
    );
    return {
      income, fixedNeeds, fixedWants, essentials, wants, savings, buffer: savings,
      goalRequests, goalRequestedTotal, goalMonthlyTotal: 0, goalShortfall: goalRequestedTotal,
      needsShare: share(essentials), wantsShare: share(wants), savingsShare: share(savings), notes,
    };
  }

  const lifestyleNeeds = NEEDS_REF_AMOUNT * Math.pow(income / NEEDS_REF_INCOME, NEEDS_ELASTICITY);
  const essentials = Math.min(income, round10(Math.max(fixedNeeds, lifestyleNeeds)));
  const flexible = Math.max(0, income - essentials);

  const minWants = Math.min(flexible, round10(Math.max(Math.min(income * 0.1, Math.max(1500, income * 0.06)), fixedWants)));
  const maxGoalFunding = Math.max(0, flexible - minWants);
  const factor = goalRequestedTotal > maxGoalFunding ? maxGoalFunding / Math.max(1, goalRequestedTotal) : 1;
  goalRequests.forEach((g) => {
    // Rounding a fully funded goal down leaves a small fake shortfall
    // ("add ₹2/mo"), so exact needs are kept when nothing is deferred.
    g.monthly = factor === 1 ? g.requested : round10(g.requested * factor);
  });
  let goalMonthlyTotal = goalRequests.reduce((s, g) => s + g.monthly, 0);
  if (goalMonthlyTotal > maxGoalFunding) {
    const overflow = goalMonthlyTotal - maxGoalFunding;
    const last = [...goalRequests].reverse().find((g) => g.monthly > 0);
    if (last) last.monthly = Math.max(0, last.monthly - overflow);
    goalMonthlyTotal = goalRequests.reduce((s, g) => s + g.monthly, 0);
  }
  const goalShortfall = Math.max(0, goalRequestedTotal - goalMonthlyTotal);

  const fixedPressure = (fixedNeeds + fixedWants) / income;
  const baseWantRate = clamp(0.45 - 0.08 * Math.log10(income / NEEDS_REF_INCOME), 0.26, 0.5);
  const wantRate = fixedPressure > 0.5 ? baseWantRate * 0.7 : baseWantRate;
  const wantsPool = Math.max(0, income - essentials - goalMonthlyTotal);
  const wants = Math.max(minWants, Math.min(round10(wantsPool * wantRate), wantsPool));
  const savings = Math.max(0, income - essentials - wants);
  const buffer = Math.max(0, savings - goalMonthlyTotal);

  notes.push(
    `Essentials are modelled at ${formatMoney(essentials)} (${share(essentials)}%) — lifestyle costs rise slower than income, so a raise adds more to savings than to spending.`,
  );
  if (goalRequestedTotal > 0) {
    notes.push(
      goalShortfall > 0
        ? `Your ${goalRequests.length} goal${goalRequests.length === 1 ? "" : "s"} ask for ${formatMoney(goalRequestedTotal)}/mo; the plan funds ${formatMoney(goalMonthlyTotal)} now and defers ${formatMoney(goalShortfall)} until income or spending changes.`
        : `Goals are funded first at ${formatMoney(goalMonthlyTotal)}/mo, before any discretionary money is set aside.`,
    );
  }
  notes.push(
    `Wants and other spending are held to ${share(wants)}% (${formatMoney(wants)}) so lifestyle inflation stays below income growth.`,
  );
  if (buffer > 0) {
    notes.push(`Another ${formatMoney(buffer)}/mo has no job yet, so it becomes an unassigned savings buffer — total savings ${share(savings)}%.`);
  }
  if (fixedPressure > 0.5) {
    notes.push(`Fixed commitments take ${Math.round(fixedPressure * 100)}% of income, so wants are trimmed further to keep goals funded.`);
  }

  return {
    income, fixedNeeds, fixedWants, essentials, wants, savings, buffer,
    goalRequests, goalRequestedTotal, goalMonthlyTotal, goalShortfall,
    needsShare: share(essentials), wantsShare: share(wants), savingsShare: share(savings),
    notes,
  };
}

export function generateBudget(
  profile: Profile,
  txns: Transaction[],
  categories: Category[],
  month = monthKey(),
  goals: BudgetGoalInput[] = [],
): BudgetPlan {
  const irregularAvg = monthlyAverageIncome(txns, 3);
  const fixedBasis = profile.incomeType === "irregular" ? irregularAvg || profile.monthlyIncome : profile.monthlyIncome;
  const income = Math.max(0, Math.round(fixedBasis));

  let fixedNeeds = 0;
  let fixedWants = 0;
  const fixedByCat = new Map<string, number>();
  for (const ob of profile.fixedObligations) {
    const cat = categories.find((c) => c.id === ob.categoryId);
    if (cat?.group === "wants") fixedWants += ob.amount;
    else fixedNeeds += ob.amount;
    fixedByCat.set(ob.categoryId, (fixedByCat.get(ob.categoryId) ?? 0) + ob.amount);
  }
  const fixedTotal = fixedNeeds + fixedWants;

  const adaptive = adaptiveBudget(income, fixedNeeds, fixedWants, goals);
  const { essentials, wants, savings } = adaptive;

  const budget: Budget = {
    id: `bud_${month}`,
    month,
    income,
    split: {
      necessities: adaptive.needsShare,
      wants: adaptive.wantsShare,
      savings: adaptive.savingsShare,
    },
    rollover: 0,
    createdAt: new Date().toISOString(),
  };

  const envelopes: BudgetEnvelope[] = [];
  const needsCats = categories.filter((c) => c.kind === "expense" && NEEDS_CATEGORIES.includes(c.id) && !fixedByCat.has(c.id));
  const wantsCats = categories.filter((c) => c.kind === "expense" && WANTS_CATEGORIES.includes(c.id) && !fixedByCat.has(c.id));
  const historical = avgCategorySpend(txns, [...needsCats, ...wantsCats].map((c) => c.id), 2);

  for (const [categoryId, amount] of fixedByCat) {
    const cat = categories.find((c) => c.id === categoryId);
    envelopes.push({
      id: uid("env"),
      budgetId: budget.id,
      name: cat?.name ?? "Fixed obligation",
      group: cat?.group === "wants" ? "wants" : "necessities",
      categoryId,
      allocated: Math.round(amount),
      icon: cat?.icon,
    });
  }

  const allocate = (cats: Category[], pool: number, group: EnvelopeGroup) => {
    if (pool <= 0 || !cats.length) return;
    const weights = cats.map((c) => Math.max(0.02, historical[c.id] > 0 ? historical[c.id] : (BASELINE_WEIGHTS[c.id] ?? 0.05) * 1000));
    const sum = weights.reduce((s, w) => s + w, 0);
    let remaining = Math.round(pool);
    cats.forEach((cat, i) => {
      const isLast = i === cats.length - 1;
      const amount = isLast ? remaining : Math.round((weights[i] / sum) * pool);
      remaining -= amount;
      envelopes.push({
        id: uid("env"),
        budgetId: budget.id,
        name: cat.name,
        group,
        categoryId: cat.id,
        allocated: Math.max(0, amount),
        icon: cat.icon,
      });
    });
  };

  allocate(needsCats, Math.max(0, essentials - fixedNeeds), "necessities");
  allocate(wantsCats, Math.max(0, wants - fixedWants), "wants");
  envelopes.push({
    id: uid("env"),
    budgetId: budget.id,
    name: "Savings & goals",
    group: "savings",
    allocated: Math.round(savings),
    icon: "piggy-bank",
  });

  return {
    budget,
    envelopes,
    incomeBasis: income,
    incomeSource: profile.incomeType === "irregular" ? "irregular average" : "fixed",
    fixedTotal,
    savingsAllocated: Math.round(savings),
    adaptive,
  };
}

export function envelopeSpent(env: BudgetEnvelope, txns: Transaction[], month: string) {
  if (env.group === "savings") return 0;
  if (!env.categoryId) return 0;
  return txns
    .filter((t) => t.type === "expense" && t.categoryId === env.categoryId && t.date.startsWith(month))
    .reduce((s, t) => s + t.amount, 0);
}

export function budgetSnapshot(data: UserData, month = monthKey()) {
  const budget = data.budgets.find((b) => b.month === month) ?? data.budgets[data.budgets.length - 1];
  const envelopes = budget ? data.envelopes.filter((e) => e.budgetId === budget.id) : [];
  const totals = monthTotals(data.transactions, month);
  const spendingEnvelopes = envelopes.filter((e) => e.group !== "savings");
  const allocated = spendingEnvelopes.reduce((s, e) => s + e.allocated, 0);
  const spent = spendingEnvelopes.reduce((s, e) => s + envelopeSpent(e, data.transactions, month), 0);
  const savingsEnv = envelopes.find((e) => e.group === "savings");
  const unbudgetedSpend = data.transactions
    .filter((t) => t.type === "expense" && t.date.startsWith(month) && !envelopes.some((e) => e.categoryId === t.categoryId))
    .reduce((s, t) => s + t.amount, 0);
  const overspentEnvelopes = spendingEnvelopes.filter((e) => envelopeSpent(e, data.transactions, month) > e.allocated && e.allocated > 0);
  const totalSpent = spent + unbudgetedSpend;
  const health = budgetHealth(data, month, spendingEnvelopes, savingsEnv);
  return {
    budget,
    envelopes,
    spendingEnvelopes,
    totals,
    allocated,
    spent,
    totalSpent,
    unbudgetedSpend,
    overspentEnvelopes,
    savingsAllocated: savingsEnv?.allocated ?? 0,
    budgetUsedPct: pct(totalSpent, allocated + unbudgetedSpend),
    remaining: Math.max(0, allocated - spent),
    health,
  };
}

export function budgetHealth(
  data: UserData,
  month: string,
  envelopes: BudgetEnvelope[],
  savingsEnv?: BudgetEnvelope,
) {
  const totals = monthTotals(data.transactions, month);
  const totalAllocated = envelopes.reduce((s, e) => s + e.allocated, 0);
  const totalSpent = envelopes.reduce((s, e) => s + envelopeSpent(e, data.transactions, month), 0);
  const usage = totalAllocated ? totalSpent / totalAllocated : 0;

  const savingsBase = Math.max(1, savingsEnv?.allocated ?? 1);
  const actualSavings = Math.max(0, totals.income - totals.expenses);
  const savingsScore = clamp(actualSavings / savingsBase, 0, 1) * 35;

  let disciplineScore = 35;
  if (usage > 1) disciplineScore = Math.max(0, 35 - (usage - 1) * 140);
  else if (usage > 0.8) disciplineScore = 35 - (usage - 0.8) * 50;
  const overspentCount = envelopes.filter((e) => e.allocated > 0 && envelopeSpent(e, data.transactions, month) > e.allocated).length;
  disciplineScore = Math.max(0, disciplineScore - overspentCount * 5);

  const overdueBills = data.bills.filter(
    (b) => (b.status === "overdue" || (b.status !== "paid" && daysUntil(b.dueDate) < 0)) && b.dueDate <= `${month}-31`,
  ).length;
  const billScore = Math.max(0, 15 - overdueBills * 5);

  const utilisation = totals.income ? totals.expenses / totals.income : 0;
  const bufferScore = utilisation <= 0.75 ? 15 : utilisation <= 0.9 ? 10 : 5;
  const score = Math.round(clamp(savingsScore + disciplineScore + billScore + bufferScore, 0, 100));
  const label = score >= 80 ? "Excellent" : score >= 65 ? "Healthy" : score >= 45 ? "Watch closely" : "Needs attention";
  return { score, label, actualSavings, usage };
}

export interface FlowBudgetRow {
  tab: FlowTab;
  label: string;
  /** Envelope money the plan sets aside for this flow category. */
  planned: number;
  /** Active money flows, normalised to a monthly amount. */
  flows: number;
  /** Expenses actually recorded this month. */
  actual: number;
}

/**
 * Compares three views of the same flow category for a month: the budget
 * envelope target, the active money flows the user maintains, and the payments
 * actually recorded. Autopay is a delivery channel, not a category, so it is
 * folded into the flow tab each schedule belongs to instead of a separate row.
 */
export function flowBudgetComparison(data: UserData, month = monthKey()): FlowBudgetRow[] {
  const budget = data.budgets.find((b) => b.month === month) ?? data.budgets[data.budgets.length - 1];
  const envelopes = budget ? data.envelopes.filter((e) => e.budgetId === budget.id && e.group !== "savings") : [];

  const plannedByTab = new Map<FlowTab, number>();
  for (const env of envelopes) {
    const tab = env.categoryId ? flowTabForBudgetCategory(env.categoryId) : null;
    if (!tab) continue;
    plannedByTab.set(tab, (plannedByTab.get(tab) ?? 0) + env.allocated);
  }

  const scheduleById = new Map(data.scheduledPayments.map((p) => [p.id, p]));
  const flowsByTab = new Map<FlowTab, number>();
  for (const flow of data.flowExpenses) {
    if (flow.status !== "active") continue;
    const schedule = flow.autopayId ? scheduleById.get(flow.autopayId) : undefined;
    const monthly = schedule?.frequency === "weekly" ? flow.amount * 4.33 : schedule?.frequency === "once" ? 0 : flow.amount;
    flowsByTab.set(flow.tab, (flowsByTab.get(flow.tab) ?? 0) + monthly);
  }

  const actualByTab = new Map<FlowTab, number>();
  for (const t of data.transactions) {
    if (t.type !== "expense" || t.transfer || !t.date.startsWith(month)) continue;
    const tab = t.flowTab ?? guessFlowTab(t.merchant, t.categoryId, t.type)?.tab;
    if (!tab) continue;
    actualByTab.set(tab, (actualByTab.get(tab) ?? 0) + t.amount);
  }

  return FLOW_TABS.filter(({ key }) => key !== "autopay")
    .map(({ key }) => ({
      tab: key,
      label: FLOW_TAB_LABEL[key],
      planned: Math.round(plannedByTab.get(key) ?? 0),
      flows: Math.round(flowsByTab.get(key) ?? 0),
      actual: Math.round(actualByTab.get(key) ?? 0),
    }))
    .filter((row) => row.planned > 0 || row.flows > 0 || row.actual > 0);
}

export function safeToSpend(data: UserData, month = monthKey()) {
  const snap = budgetSnapshot(data, month);
  const flexible = snap.spendingEnvelopes.filter((e) => e.group === "wants" || ["cat_groceries", "cat_transport"].includes(e.categoryId ?? ""));
  const remainingFlex = flexible.reduce((s, e) => s + Math.max(0, e.allocated - envelopeSpent(e, data.transactions, month)), 0);
  const upcomingBills = data.bills
    .filter((b) => b.status !== "paid" && b.dueDate.startsWith(month) && daysUntil(b.dueDate) >= 0)
    .reduce((s, b) => s + b.amount, 0);
  const daily = Math.max(0, Math.floor((remainingFlex - upcomingBills) / daysLeftInMonth()));
  return {
    daily,
    remainingFlex,
    upcomingBills,
    daysLeft: daysLeftInMonth(),
    formula: "flexible envelopes left − bills still due this month, ÷ days remaining",
  };
}

export function savingsRateSeries(txns: Transaction[], months = 6) {
  return lastNMonths(months).map((key) => {
    const t = monthTotals(txns, key);
    return { key, label: parseISO(`${key}-01`).toLocaleDateString("en-IN", { month: "short" }), rate: Math.round(t.savingsRate), income: t.income, expenses: t.expenses };
  });
}

export function incomeExpenseSeries(txns: Transaction[], months = 6) {
  return lastNMonths(months).map((key) => {
    const t = monthTotals(txns, key);
    return {
      key,
      label: parseISO(`${key}-01`).toLocaleDateString("en-IN", { month: "short" }),
      income: Math.round(t.income),
      expenses: Math.round(t.expenses),
      net: Math.round(t.net),
    };
  });
}

export function dailySpendSeries(txns: Transaction[], month: string) {
  const days = Number(month.split("-")[1]) === 2 ? 29 : new Date(Number(month.split("-")[0]), Number(month.split("-")[1]), 0).getDate();
  const out = Array.from({ length: days }, (_, i) => ({ day: i + 1, amount: 0 }));
  for (const t of txns) {
    if (t.type !== "expense" || t.transfer || !t.date.startsWith(month)) continue;
    const d = Number(t.date.slice(8, 10));
    if (out[d - 1]) out[d - 1].amount += t.amount;
  }
  return out;
}

export function topMerchants(txns: Transaction[], month: string, limit = 5) {
  const map = new Map<string, { merchant: string; amount: number; count: number; categoryId: string }>();
  for (const t of txns) {
    if (t.type !== "expense" || t.transfer || !t.date.startsWith(month)) continue;
    const cur = map.get(t.merchant.toLowerCase()) ?? { merchant: t.merchant, amount: 0, count: 0, categoryId: t.categoryId };
    cur.amount += t.amount;
    cur.count += 1;
    map.set(t.merchant.toLowerCase(), cur);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
}

export function goalProgress(goal: Goal) {
  const saved = goal.saved;
  const remaining = Math.max(0, goal.target - saved);
  const daysLeft = Math.max(0, differenceInCalendarDays(parseISO(goal.deadline), new Date()));
  const monthsLeft = Math.max(1, Math.ceil(daysLeft / 30));
  const requiredMonthly = Math.ceil(remaining / monthsLeft);
  const auto = goal.autoMonthly ?? 0;
  const projected = saved + auto * monthsLeft;
  const onTrack = remaining === 0 || projected >= goal.target;
  return {
    saved,
    remaining,
    daysLeft,
    monthsLeft,
    requiredMonthly,
    auto,
    projected: Math.min(projected, goal.target),
    onTrack,
    progress: clamp((saved / goal.target) * 100, 0, 100),
    gap: Math.max(0, requiredMonthly - auto),
  };
}

export function subscriptionMonthly(sub: Subscription) {
  return sub.status === "active" ? (sub.cycle === "monthly" ? sub.cost : sub.cost / 12) : 0;
}

export function subscriptionStats(subs: Subscription[]) {
  const active = subs.filter((s) => s.status === "active");
  const monthly = active.reduce((s, sub) => s + subscriptionMonthly(sub), 0);
  const yearly = monthly * 12;
  const flagged = active.filter(
    (s) => s.duplicateGroup || s.lastUsedDaysAgo > 45 || (s.priceHistory.length > 1 && s.priceHistory[s.priceHistory.length - 1].price > s.priceHistory[0].price),
  );
  return { active, monthly, yearly, flagged, count: active.length };
}

export function billStatus(bill: Bill): Bill["status"] {
  if (bill.status === "paid") return "paid";
  const d = daysUntil(bill.dueDate);
  if (d < 0) return "overdue";
  if (d <= 3) return "due";
  return "upcoming";
}

export function savingsGoalTotals(goals: Goal[]) {
  return goals.reduce((acc, g) => ({ target: acc.target + g.target, saved: acc.saved + g.saved }), { target: 0, saved: 0 });
}

export function upcomingBills(data: UserData, days = 30) {
  return data.bills
    .filter((b) => b.status !== "paid")
    .map((b) => ({ ...b, derivedStatus: billStatus(b) }))
    .filter((b) => daysUntil(b.dueDate) <= days)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function upcomingReminders(data: UserData) {
  return data.reminders
    .filter((r) => r.status === "open")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Deterministic, rules-based guardian insights backed by real records. */
export function buildInsights(data: UserData, currency: Currency = "INR", month = monthKey()): AiInsight[] {
  const insights: AiInsight[] = [];
  const envelopeAlerts: AiInsight[] = [];
  const snap = budgetSnapshot(data, month);
  const txns = txnsInMonth(data.transactions, month);
  const totals = snap.totals;
  const now = new Date().toISOString();

  for (const env of snap.spendingEnvelopes) {
    const spent = envelopeSpent(env, data.transactions, month);
    if (env.allocated <= 0) continue;
    const usage = spent / env.allocated;
    if (usage > 1) {
      envelopeAlerts.push({
        id: `ins_over_${env.categoryId ?? env.id}_${month}`,
        type: "overspend",
        severity: "critical",
        title: `${env.name} is over budget`,
        body: `You've spent ${formatMoney(spent, currency)} of ${formatMoney(env.allocated, currency)} in ${env.name} — about ${formatMoney(spent - env.allocated, currency)} over.`,
        reason: `The envelope passed 100% on ${fmtDate(data.transactions.filter((t) => t.categoryId === env.categoryId && t.date.startsWith(month)).slice(-1)[0]?.date ?? todayISO(), "d MMM")}. Move a little from Wants or pause non-essential spend here.`,
        actionLabel: "Rebalance envelope",
        actionHref: "/app/budget",
        amount: Math.round(spent - env.allocated),
        createdAt: now,
      });
    } else if (usage >= 0.8) {
      envelopeAlerts.push({
        id: `ins_warn_${env.categoryId ?? env.id}_${month}`,
        type: "overspend",
        severity: "warning",
        title: `${env.name} is ${Math.round(usage * 100)}% used`,
        body: `Only ${formatMoney(Math.max(0, env.allocated - spent), currency)} is left in this envelope for the rest of ${parseISO(`${month}-01`).toLocaleDateString("en-IN", { month: "long" })}.`,
        reason: "At your current pace this envelope runs out before month end. A small adjustment now avoids a bigger overspend later.",
        actionLabel: "Review envelope",
        actionHref: "/app/budget",
        amount: Math.round(env.allocated - spent),
        createdAt: now,
      });
    }
  }

  const necessityIds = new Set(data.categories.filter((c) => c.group === "necessities").map((c) => c.id));
  const expenses = txns.filter((t) => t.type === "expense" && !necessityIds.has(t.categoryId));
  if (expenses.length > 3) {
    const amounts = expenses.map((t) => t.amount);
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const sd = Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length);
    const outlier = expenses
      .filter((t) => t.amount > Math.max(mean + 2 * sd, mean * 2.5) && t.amount > 2500)
      .sort((a, b) => b.amount - a.amount)[0];
    if (outlier) {
      insights.push({
        id: `ins_unusual_${outlier.id}`,
        type: "unusual",
        severity: "warning",
        title: `Unusual charge at ${outlier.merchant}`,
        body: `${formatMoney(outlier.amount, currency)} on ${fmtDate(outlier.date, "d MMM")} is ${(outlier.amount / mean).toFixed(1)}× your average transaction (${formatMoney(Math.round(mean), currency)}).`,
        reason: "This is the largest single expense this month. If it wasn't planned, check the receipt or move money from Savings.",
        actionLabel: "Open transaction",
        actionHref: "/app/transactions",
        amount: outlier.amount,
        createdAt: now,
      });
    }
  }

  const subs = subscriptionStats(data.subscriptions);
  for (const sub of subs.active) {
    const prev = sub.priceHistory.length > 1 ? sub.priceHistory[sub.priceHistory.length - 2].price : null;
    if (prev && sub.cost > prev) {
      insights.push({
        id: `ins_price_${sub.id}`,
        type: "subscription",
        severity: "warning",
        title: `${sub.name} raised its price`,
        body: `Now ${formatMoney(sub.cost, currency)}/mo, up from ${formatMoney(prev, currency)} — ${formatMoney((sub.cost - prev) * 12, currency)} more per year.`,
        reason: "A quiet price increase compounds. Confirm you still get enough value before the next renewal.",
        actionLabel: "Review subscription",
        actionHref: "/app/flows/subscriptions",
        amount: sub.cost - prev,
        createdAt: now,
      });
    }
  }
  const duplicate = subs.active.find((s) => s.duplicateGroup);
  if (duplicate) {
    const group = subs.active.filter((s) => s.duplicateGroup === duplicate.duplicateGroup);
    if (group.length > 1) {
      const waste = group.slice(1).reduce((s, g) => s + subscriptionMonthly(g), 0);
      insights.push({
        id: `ins_dupe_${duplicate.duplicateGroup}`,
        type: "subscription",
        severity: "warning",
        title: "Possible duplicate subscriptions",
        body: `${group.map((g) => g.name).join(" and ")} overlap in the same category — ${formatMoney(Math.round(waste * 12), currency)}/year could be saved.`,
        reason: "Both renew this month and serve the same purpose. Pick one and cancel the other.",
        actionLabel: "Draft cancellation",
        actionHref: "/app/flows/subscriptions",
        amount: Math.round(waste * 12),
        createdAt: now,
      });
    }
  }
  const likelyUnused = subs.active.find((s) => s.lastUsedDaysAgo > 60);
  if (likelyUnused) {
    insights.push({
      id: `ins_unused_${likelyUnused.id}`,
      type: "subscription",
      severity: "info",
      title: `${likelyUnused.name} looks forgotten`,
      body: `No usage in ${likelyUnused.lastUsedDaysAgo} days, but it still bills ${formatMoney(likelyUnused.cost, currency)}/${likelyUnused.cycle === "monthly" ? "mo" : "yr"}.`,
      reason: "You're paying for access you haven't used in over two months. Cancelling keeps the money in your savings envelope.",
      actionLabel: "Review & cancel",
      actionHref: "/app/flows/subscriptions",
      amount: subscriptionMonthly(likelyUnused) * 12,
      createdAt: now,
    });
  }

  const latestIncome = [...data.transactions]
    .filter((t) => t.type === "income" && !t.transfer)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const salaryDay = latestIncome ? Number(latestIncome.date.slice(8, 10)) : 1;
  const nextSalary = fmtDate(format(nextOccurrence(salaryDay, parseISO(`${month}-01`)), "yyyy-MM-dd"), "d MMM");
  const dueSoon = data.bills.filter((b) => b.status !== "paid" && daysUntil(b.dueDate) >= 0 && daysUntil(b.dueDate) <= 14);
  const dueTotal = dueSoon.reduce((s, b) => s + b.amount, 0);
  const pastSpend = lastNMonths(4, parseISO(`${month}-01`))
    .filter((k) => k !== month)
    .map((k) => monthTotals(data.transactions, k).expenses)
    .filter((v) => v > 0);
  const monthStart = parseISO(`${month}-01`);
  const elapsedDays = monthKey(monthStart) === monthKey() ? new Date().getDate() : daysInMonth(monthStart);
  const runRateProjection = (totals.expenses / Math.max(1, elapsedDays)) * daysInMonth(monthStart);
  const projectedSpend = pastSpend.length
    ? Math.max(totals.expenses, pastSpend.reduce((s, v) => s + v, 0) / pastSpend.length)
    : Math.max(totals.expenses, runRateProjection);
  const projectedSurplus = totals.income - projectedSpend;
  if (dueTotal > 0 && projectedSurplus - dueTotal < data.profile.savingsTarget * 0.25) {
    insights.push({
      id: `ins_cashflow_${month}`,
      type: "cashflow",
      severity: "critical",
      title: "Cash-flow crunch before payday",
      body: `${formatMoney(dueTotal, currency)} of bills are due in the next 14 days, while your projected month-end surplus is ${formatMoney(Math.round(projectedSurplus), currency)}${projectedSurplus < 0 ? " — a shortfall" : ""}.`,
      reason: `Your recent months averaged ${formatMoney(Math.round(projectedSpend), currency)} of spending. Hold discretionary spending until the next salary credit around ${nextSalary}.`,
      actionLabel: "See upcoming bills",
      actionHref: "/app/flows/bills",
      amount: dueTotal,
      createdAt: now,
    });
  }

  const savingsRate = totals.savingsRate;
  if (totals.income > 0) {
    if (savingsRate >= 20) {
      insights.push({
        id: `ins_save_good_${month}`,
        type: "positive",
        severity: "positive",
        title: `You're saving ${Math.round(savingsRate)}% this month`,
        body: `That's ${formatMoney(Math.max(0, Math.round(totals.income - totals.expenses)), currency)} kept so far — ahead of your 20% baseline.`,
        reason: "Consistent savings are doing more for your goals than any single purchase decision. Consider moving part of it to your emergency fund.",
        actionLabel: "Top up a goal",
        actionHref: "/app/goals",
        amount: Math.round(totals.income - totals.expenses),
        createdAt: now,
      });
    } else if (snap.remaining < totals.income * 0.1 && savingsRate < 20) {
      insights.push({
        id: `ins_save_low_${month}`,
        type: "savings",
        severity: "info",
        title: "A savings opportunity is within reach",
        body: `Cutting ${formatMoney(Math.round(totals.income * 0.05), currency)} from Wants would lift your savings rate to about ${Math.round(savingsRate + 5)}%.`,
        reason: "Your Wants envelopes still have room to flex. Small trims now protect your goals without changing fixed costs.",
        actionLabel: "Open budget",
        actionHref: "/app/budget",
        amount: Math.round(totals.income * 0.05),
        createdAt: now,
      });
    }
  }

  const order: Record<AiInsight["severity"], number> = { critical: 0, warning: 1, info: 2, positive: 3 };
  const overspent = envelopeAlerts.filter((i) => i.severity === "critical").slice(0, 2);
  const nearlyFull = envelopeAlerts.filter((i) => i.severity === "warning").slice(0, 1);
  return [...insights, ...overspent, ...nearlyFull]
    .filter((i) => !data.dismissedInsights.includes(i.id))
    .sort((a, b) => order[a.severity] - order[b.severity])
    .slice(0, 8);
}

export function merchantList(txns: Transaction[]) {
  const set = new Set(txns.filter((t) => t.type === "expense").map((t) => t.merchant));
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function savingsForecast(data: UserData, monthlySave: number) {
  const start = data.goals.reduce((s, g) => s + g.saved, 0);
  const out: { month: string; saved: number }[] = [];
  let total = start;
  for (let i = 0; i < 12; i++) {
    total += monthlySave;
    const d = new Date();
    d.setMonth(d.getMonth() + i + 1);
    out.push({ month: d.toLocaleDateString("en-IN", { month: "short" }), saved: Math.round(total) });
  }
  return out;
}

export function roundEnvelope(amount: number) {
  return round2(Math.round(amount / 10) * 10);
}

export function lastMonthComparison(txns: Transaction[], month = monthKey()) {
  const cur = monthTotals(txns, month);
  const prev = monthTotals(txns, previousMonthKey(month));
  const diff = cur.expenses - prev.expenses;
  return {
    cur,
    prev,
    diff,
    pctChange: prev.expenses ? (diff / prev.expenses) * 100 : 0,
    isCurrentPartial: month === monthKey(),
  };
}

export { todayISO };
