import type { Currency, Goal, Subscription, Transaction, UserData } from "./types";
import { formatMoney, convert } from "./money";
import { monthKey, previousMonthKey, monthLabel, parseISO, lastNMonths } from "./dates";
import {
  budgetSnapshot, envelopeSpent, goalProgress, safeToSpend, spendByCategory, topMerchants,
  monthTotals, subscriptionStats, upcomingBills, upcomingReminders,
} from "./finance";

export interface GuardianAnswer {
  text: string;
  sources: string[];
  suggestions?: string[];
  intent?: string;
}

const CATEGORY_KEYWORDS: { id: string; words: string[]; label: string }[] = [
  { id: "cat_food", words: ["food", "eating out", "restaurant", "swiggy", "zomato", "dining", "delivery"], label: "Food & Dining" },
  { id: "cat_groceries", words: ["grocer", "groceries", "bigbasket", "zepto", "blinkit", "dmart", "supermarket"], label: "Groceries" },
  { id: "cat_rent", words: ["rent", "housing", "landlord"], label: "Rent" },
  { id: "cat_transport", words: ["transport", "travel to work", "uber", "ola", "metro", "fuel", "commute"], label: "Transport" },
  { id: "cat_shopping", words: ["shopping", "clothes", "amazon", "flipkart", "myntra", "croma"], label: "Shopping" },
  { id: "cat_entertainment", words: ["entertainment", "movies", "cinema", "pvr", "gaming"], label: "Entertainment" },
  { id: "cat_subscriptions", words: ["subscription", "subscriptions", "netflix", "spotify", "adobe", "prime"], label: "Subscriptions" },
  { id: "cat_utilities", words: ["utility", "utilities", "electricity", "internet", "airtel", "jio", "water", "gas"], label: "Utilities" },
  { id: "cat_health", words: ["health", "medical", "dentist", "pharmacy", "doctor", "hospital"], label: "Health" },
  { id: "cat_education", words: ["education", "course", "udemy", "coursera", "tuition", "books"], label: "Education" },
  { id: "cat_emi", words: ["emi", "loan", "debt"], label: "Loans & EMI" },
  { id: "cat_travel", words: ["travel", "trip", "flight", "hotel", "vacation", "holiday"], label: "Travel" },
  { id: "cat_personal", words: ["personal care", "salon", "grooming", "gym"], label: "Personal Care" },
];

export const GUARDIAN_PROMPTS = [
  "How much did I spend on food last month?",
  "Can I afford a 15,000 purchase?",
  "Where did my money go this month?",
  "What bills are due soon?",
  "How are my subscriptions doing?",
  "Am I on track with my goals?",
];

function findCategories(question: string) {
  const q = question.toLowerCase();
  return CATEGORY_KEYWORDS.filter((c) => c.words.some((w) => q.includes(w)));
}

function parsePeriod(question: string): { key: string; label: string } {
  const q = question.toLowerCase();
  if (q.includes("last month") || q.includes("previous month")) {
    const key = previousMonthKey(monthKey());
    return { key, label: monthLabel(key) };
  }
  if (q.includes("this month") || q.includes("so far")) {
    return { key: monthKey(), label: `${monthLabel(monthKey())} so far` };
  }
  for (const key of lastNMonths(12)) {
    const label = monthLabel(key).toLowerCase();
    const short = parseISO(`${key}-01`).toLocaleDateString("en-IN", { month: "long" }).toLowerCase();
    if (q.includes(label) || q.includes(short)) return { key, label: monthLabel(key) };
  }
  return { key: monthKey(), label: `${monthLabel(monthKey())} so far` };
}

function parseAmountInr(question: string, currency: Currency): number | null {
  const cleaned = question.replace(/,/g, " ").replace(/\s+/g, " ");
  const match = cleaned.match(/(?:₹|rs\.?|inr|\$|€|eur)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|lakh|lac|l)?/i);
  if (!match) return null;
  let n = Number(match[1]);
  const suffix = (match[2] || "").toLowerCase();
  if (suffix === "k" || suffix === "thousand") n *= 1000;
  if (suffix === "lakh" || suffix === "lac" || suffix === "l") n *= 100000;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n / convert(1, currency));
}

function money(n: number, currency: Currency) {
  return formatMoney(n, currency, { compact: false });
}

function sourcesFor(txns: Transaction[], periodLabel: string) {
  return [`${txns.length} transactions · ${periodLabel}`];
}

function affordability(priceInr: number, data: UserData, _currency: Currency) {
  const safe = safeToSpend(data);
  const available = Math.max(0, safe.remainingFlex - safe.upcomingBills);
  const goals = data.goals.map((g) => ({ goal: g, progress: goalProgress(g) }));
  const delays = goals
    .filter((g) => g.progress.remaining > 0)
    .map((g) => ({
      name: g.goal.name,
      months: g.progress.auto > 0 ? Math.ceil(priceInr / g.progress.auto) : null,
    }))
    .filter((d) => d.months !== null)
    .slice(0, 2);
  const verdict: "comfortable" | "tight" | "not-now" =
    priceInr <= Math.max(0, available - data.profile.savingsTarget * 0.25) * 0.5
      ? "comfortable"
      : priceInr <= available
        ? "tight"
        : "not-now";
  return { safe, available, delays, verdict, goals };
}

export function answerQuestion(question: string, data: UserData, currency: Currency): GuardianAnswer {
  const q = question.trim().toLowerCase();
  const txns = data.transactions.filter((t) => !t.transfer);
  const cats = findCategories(question);
  const period = parsePeriod(question);
  const totals = monthTotals(txns, period.key);
  const snapshot = budgetSnapshot(data, period.key);

  if (!q) {
    return { text: "Ask me anything about your money — I'll answer using only your recorded transactions, budgets, bills and goals.", sources: [] };
  }

  if (/(can i afford|afford|should i buy|is it okay to buy)/.test(q)) {
    const price = parseAmountInr(question, currency);
    if (!price) {
      return {
        text: "Tell me the amount, for example: “Can I afford a ₹15,000 purchase?” I'll compare it with your flexible envelopes, upcoming bills and goal contributions.",
        sources: [],
        suggestions: ["Can I afford a 15,000 purchase?"],
        intent: "afford",
      };
    }
    const a = affordability(price, data, currency);
    const allowance = Math.max(0, a.available);
    const delayText = a.delays
      .filter((d) => d.months)
      .map((d) => `• ${d.name}: this would pause its auto-contribution for about ${d.months} month${d.months === 1 ? "" : "s"}.`)
      .join("\n");
    const headline =
      a.verdict === "comfortable"
        ? `Yes — ${money(price, currency)} fits without crowding the rest of your month.`
        : a.verdict === "tight"
          ? `Possible, but tight. ${money(price, currency)} would use most of what's flexible right now.`
          : `I'd wait. ${money(price, currency)} is more than your flexible money after bills.`;
    const body = [
      headline,
      "",
      `Here's the maths:`,
      `• Flexible envelopes left: ${money(a.safe.remainingFlex, currency)}`,
      `• Bills still due this month: ${money(a.safe.upcomingBills, currency)}`,
      `• Available before touching savings: ${money(allowance, currency)}`,
      `• Safe to spend per day: ${money(a.safe.daily, currency)} for ${a.safe.daysLeft} more day${a.safe.daysLeft === 1 ? "" : "s"}`,
      "",
      a.verdict === "comfortable"
        ? "You'd still keep your savings envelope intact. If this is a want rather than a need, the cooling-off checkout can still hold it for you."
        : a.verdict === "tight"
          ? "You'd need to trim other wants. Use Patient Checkout to authorize now and decide after a cooling-off period."
          : "I'd keep this out of this month's budget. Consider a savings goal for it, or use Patient Checkout once more room opens up.",
      delayText ? `\nWhat it could delay:\n${delayText}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return {
      text: body,
      sources: [
        `${snapshot.spendingEnvelopes.length} budget envelopes · ${monthLabel(monthKey())}`,
        `${data.bills.filter((b) => b.status !== "paid").length} unpaid bills`,
        "AI suggestions are not financial advice",
      ],
      intent: "afford",
      suggestions: ["Where did my money go this month?", "How are my subscriptions doing?"],
    };
  }

  if (/(spend|spent|spending)/.test(q) && cats.length) {
    const rows = cats.map((cat) => {
      const spent = txns
        .filter((t) => t.type === "expense" && t.categoryId === cat.id && t.date.startsWith(period.key))
        .reduce((s, t) => s + t.amount, 0);
      return { ...cat, spent };
    });
    const total = rows.reduce((s, r) => s + r.spent, 0);
    const catTx = txns.filter((t) => t.type === "expense" && rows.some((r) => r.id === t.categoryId) && t.date.startsWith(period.key));
    const env = snapshot.spendingEnvelopes.find((e) => rows.some((r) => r.id === e.categoryId));
    const envLine = env
      ? `\nYour ${env.name} envelope has ${money(env.allocated, currency)} allocated, so you've used ${Math.round((rows.find((r) => r.id === env.categoryId)!.spent / Math.max(1, env.allocated)) * 100)}% of it.`
      : "";
    const merchants = rows
      .flatMap((r) => topMerchants(catTx, period.key, 10).filter((m) => catTx.some((t) => t.merchant === m.merchant && t.categoryId === r.id)))
      .slice(0, 3);
    const merchantLine = merchants.length
      ? `\nBiggest merchants: ${merchants.map((m) => `${m.merchant} (${money(m.amount, currency)})`).join(", ")}.`
      : "";
    return {
      text: `You spent ${money(total, currency)} on ${rows.map((r) => r.label).join(" and ")} in ${period.label}.${envLine}${merchantLine}`,
      sources: sourcesFor(catTx, period.label),
      intent: "category-spend",
      suggestions: ["Compare with last month", "Can I afford a 15,000 purchase?"],
    };
  }

  if (/(spend|spent|spending|expenses)/.test(q)) {
    const byCat = spendByCategory(txns, period.key, data.categories);
    const top = byCat.slice(0, 3);
    const topLine = top.map((c) => `• ${c.name}: ${money(c.amount, currency)} (${Math.round(c.pct)}%)`).join("\n");
    return {
      text: `You spent ${money(totals.expenses, currency)} in ${period.label}. Top categories:\n${topLine}\n\nThis is ${Math.round((totals.expenses / Math.max(1, totals.income)) * 100)}% of the money that came in (${money(totals.income, currency)}).`,
      sources: [`${txns.filter((t) => t.type === "expense" && t.date.startsWith(period.key)).length} expense transactions · ${period.label}`],
      intent: "total-spend",
      suggestions: ["Where did my money go this month?", "How much did I spend on food last month?"],
    };
  }

  if (/(earn|earned|income|salary)/.test(q)) {
    return {
      text: `You received ${money(totals.income, currency)} in ${period.label}. That's ${data.transactions.filter((t) => t.type === "income" && !t.transfer && t.date.startsWith(period.key)).length} income entries, including salary and freelance work. Your expenses were ${money(totals.expenses, currency)}, leaving a net ${money(totals.net, currency)}.`,
      sources: [`${data.transactions.filter((t) => t.type === "income" && t.date.startsWith(period.key)).length} income transactions · ${period.label}`],
      intent: "income",
    };
  }

  if (/(subscription|netflix|spotify|adobe)/.test(q)) {
    const stats = subscriptionStats(data.subscriptions);
    const flagged = stats.active.filter((s) => s.lastUsedDaysAgo > 45 || s.duplicateGroup);
    const lines = flagged
      .slice(0, 4)
      .map((s) => `• ${s.name}: ${money(s.cost, currency)}/${s.cycle === "monthly" ? "mo" : "yr"}; last used ${s.lastUsedDaysAgo} days ago${s.duplicateGroup ? "; possible duplicate" : ""}`)
      .join("\n");
    return {
      text: `You have ${stats.count} active subscriptions costing ${money(stats.monthly, currency)}/month (${money(stats.yearly, currency)}/year).\n${lines ? `\nWorth a look:\n${lines}` : "Nothing looks unused — nice."}\n\nCancelling the flagged ones could keep about ${money(flagged.reduce((s, sub) => s + (sub.cycle === "monthly" ? sub.cost : sub.cost / 12) * 12, 0), currency)} a year.`,
      sources: [`${stats.count} active subscriptions`, "AI suggestions are not financial advice"],
      intent: "subscriptions",
      suggestions: ["What bills are due soon?", "Where did my money go this month?"],
    };
  }

  if (/(bill|due|payment|ticket|autopay)/.test(q)) {
    const bills = upcomingBills(data, 30);
    if (!bills.length) return { text: "Nothing is due in the next 30 days. Your upcoming list is clear.", sources: ["0 unpaid bills in the next 30 days"] };
    const lines = bills.slice(0, 5).map((b) => `• ${b.title}: ${money(b.amount, currency)} — ${b.derivedStatus === "overdue" ? "overdue" : `due ${b.dueDate}`}`).join("\n");
    const total = bills.reduce((s, b) => s + b.amount, 0);
    return {
      text: `You have ${bills.length} unpaid bill${bills.length === 1 ? "" : "s"} in the next 30 days totalling ${money(total, currency)}:\n${lines}`,
      sources: [`${data.bills.length} bills tracked`, "AI suggestions are not financial advice"],
      intent: "bills",
      suggestions: ["Can I afford a 15,000 purchase?", "Am I on track with my goals?"],
    };
  }

  if (/(goal|save|saving|savings|emergency|trip)/.test(q)) {
    const lines = data.goals
      .map((g) => {
        const p = goalProgress(g);
        return `• ${g.name}: ${money(g.saved, currency)} of ${money(g.target, currency)} (${Math.round(p.progress)}%), ${p.onTrack ? "on track" : "behind"}; needs ${money(p.requiredMonthly, currency)}/month.`;
      })
      .join("\n");
    const monthlySave = Math.max(0, totals.income - totals.expenses);
    return {
      text: `${lines || "You don't have any goals yet — creating one gives your savings a target."}\n\nThis month so far you've kept ${money(monthlySave, currency)} (${Math.round(totals.savingsRate)}% savings rate). Your declared monthly savings target is ${money(data.profile.savingsTarget, currency)}.`,
      sources: [`${data.goals.length} active goals`, `${monthLabel(monthKey())} income and expenses`, "AI suggestions are not financial advice"],
      intent: "goals",
    };
  }

  if (/(owe|owed|remind|borrow|lend)/.test(q)) {
    const rems = upcomingReminders(data);
    if (!rems.length) return { text: "You have no open reminders. Everything is settled.", sources: ["0 open reminders"] };
    const lines = rems.map((r) => `• ${r.direction === "owe" ? "You owe" : "Owed to you by"} ${r.person}: ${money(r.amount, currency)} (due ${r.dueDate})`).join("\n");
    return {
      text: `Open reminders:\n${lines}`,
      sources: [`${rems.length} open reminders`, "AI suggestions are not financial advice"],
      intent: "reminders",
    };
  }

  if (/(budget|envelope|overspend|safe to spend)/.test(q)) {
    const over = snapshot.spendingEnvelopes
      .map((e) => ({ e, spent: envelopeSpent(e, data.transactions, period.key) }))
      .filter((x) => x.spent > x.e.allocated);
    const safe = safeToSpend(data);
    return {
      text: `For ${monthLabel(monthKey())}, you've spent ${money(snapshot.totalSpent, currency)} against ${money(snapshot.allocated, currency)} of spending envelopes. ${over.length ? `Over budget: ${over.map((x) => `${x.e.name} by ${money(x.spent - x.e.allocated, currency)}`).join(", ")}.` : "Every envelope is within budget so far."}\n\nSafe to spend today: ${money(safe.daily, currency)} (${safe.formula}).`,
      sources: [`${snapshot.spendingEnvelopes.length} envelopes · ${monthLabel(monthKey())}`, "AI suggestions are not financial advice"],
      intent: "budget",
      suggestions: ["Can I afford a 15,000 purchase?", "How are my subscriptions doing?"],
    };
  }

  if (/(where.*money|top merchant|biggest|summary|overview)/.test(q)) {
    const merchants = topMerchants(txns, period.key, 3);
    const byCat = spendByCategory(txns, period.key, data.categories).slice(0, 3);
    return {
      text: `In ${period.label} your money went mainly to:\n${byCat.map((c) => `• ${c.name}: ${money(c.amount, currency)} (${Math.round(c.pct)}% of spending)`).join("\n")}\n\nTop merchants: ${merchants.map((m) => `${m.merchant} (${money(m.amount, currency)})`).join(", ")}.`,
      sources: sourcesFor(txns.filter((t) => t.type === "expense" && t.date.startsWith(period.key)), period.label),
      intent: "where-money",
      suggestions: ["Can I afford a 15,000 purchase?", "What bills are due soon?"],
    };
  }

  return {
    text: `Here's your snapshot for ${monthLabel(monthKey())}: ${money(totals.income, currency)} in, ${money(totals.expenses, currency)} out, net ${money(totals.net, currency)}. Safe to spend today is ${money(safeToSpend(data).daily, currency)}.\n\nI can go deeper on spending by category, affordability, bills, subscriptions, reminders or goals — try one of the suggestions below.`,
    sources: ["Your recorded transactions and budget", "AI suggestions are not financial advice"],
    intent: "fallback",
    suggestions: GUARDIAN_PROMPTS.slice(0, 3),
  };
}

export interface PurchaseAdvice {
  verdict: "comfortable" | "tight" | "not-now";
  headline: string;
  summary: string;
  reasons: string[];
  delays: { name: string; months: number }[];
  available: number;
  safeDaily: number;
  wantsRemaining: number;
  savingsRate: number;
}

export function advisePurchase(item: string, priceInr: number, data: UserData, currency: Currency, categoryId?: string): PurchaseAdvice {
  const snapshot = budgetSnapshot(data);
  const safe = safeToSpend(data);
  const wants = snapshot.spendingEnvelopes.filter((e) => e.group === "wants");
  const wantsRemaining = wants.reduce((s, e) => s + Math.max(0, e.allocated - envelopeSpent(e, data.transactions, monthKey())), 0);
  const available = Math.max(0, safe.remainingFlex - safe.upcomingBills);
  const goal = data.goals[0];
  const targetEnv = categoryId ? snapshot.spendingEnvelopes.find((e) => e.categoryId === categoryId) : undefined;
  const targetRemaining = targetEnv ? Math.max(0, targetEnv.allocated - envelopeSpent(targetEnv, data.transactions, monthKey())) : null;

  let verdict: PurchaseAdvice["verdict"] = "not-now";
  if (priceInr > available) verdict = "not-now";
  else if (priceInr > wantsRemaining * 0.4 || (targetRemaining !== null && priceInr > targetRemaining)) verdict = "tight";
  else verdict = "comfortable";

  const delays =
    verdict === "comfortable"
      ? []
      : data.goals
          .map((g) => ({ name: g.name, auto: g.autoMonthly ?? 0 }))
          .filter((g) => g.auto > 0)
          .map((g) => ({ name: g.name, months: Math.ceil(priceInr / g.auto) }))
          .slice(0, 2);

  const headline =
    verdict === "comfortable"
      ? `This fits your budget` 
      : verdict === "tight"
        ? "Possible, but it squeezes your month"
        : "Not comfortably affordable right now";

  const summary =
    verdict === "comfortable"
      ? `${item || "This purchase"} at ${money(priceInr, currency)} leaves ${money(available - priceInr, currency)} of flexible money before your goal contributions. It won't touch savings.`
      : verdict === "tight"
        ? `${item || "This purchase"} at ${money(priceInr, currency)} fits, but it would use about ${Math.round((priceInr / Math.max(1, wantsRemaining)) * 100)}% of your remaining wants budget. You'd need to trim something else.`
        : `${item || "This purchase"} at ${money(priceInr, currency)} is above the ${money(available, currency)} you can spend without dipping into savings or missing a bill.`;

  const reasons = [
    `Flexible money left after bills: ${money(available, currency)}`,
    `Wants envelopes remaining: ${money(wantsRemaining, currency)}`,
    `Safe to spend per day: ${money(safe.daily, currency)} for ${safe.daysLeft} days`,
    targetEnv ? `${targetEnv.name} envelope has ${money(Math.max(0, targetEnv.allocated - envelopeSpent(targetEnv, data.transactions, monthKey())), currency)} left` : `Savings goal allocation: ${money(data.profile.savingsTarget, currency)}/month`,
    goal ? `${goal.name}: ${Math.round(goalProgress(goal).progress)}% funded` : "",
  ].filter(Boolean);

  return { verdict, headline, summary, reasons, delays, available, safeDaily: safe.daily, wantsRemaining, savingsRate: snapshot.totals.savingsRate };
}

export function draftCancellation(sub: Subscription, name: string): string {
  return `Hi ${sub.name} support team,

I'd like to cancel my subscription (${sub.name}, currently ${formatMoney(sub.cost, "INR")} per ${sub.cycle === "monthly" ? "month" : "year"}, next renewal ${sub.nextBillingDate}).

Please confirm the cancellation, stop future renewals, and let me know whether any unused time is refundable. My account is under ${name}.

Thank you,
${name}`;
}

export function draftPaymentRequest(reminder: { person: string; amount: number; note?: string; dueDate: string }, payerName: string, currency: Currency): string {
  return `Hi ${reminder.person},

A quick payment reminder for ${money(reminder.amount, currency)}${reminder.note ? ` (${reminder.note})` : ""}, due ${reminder.dueDate}.

I've attached a PayPal request — you can pay securely from the link. Let me know if you've already sent it.

Thanks,
${payerName}`;
}

export function guardianDailyLine(data: UserData, currency: Currency): string {
  const safe = safeToSpend(data);
  const snap = budgetSnapshot(data);
  if (safe.daily <= 0) return `Flexible money is fully committed. Hold non-essential spending until payday.`;
  if (snap.overspentEnvelopes.length) return `${snap.overspentEnvelopes.length} envelope${snap.overspentEnvelopes.length === 1 ? "" : "s"} over budget — ${money(safe.daily, currency)}/day is your safe pace.`;
  return `${money(safe.daily, currency)}/day keeps you on budget with ${safe.daysLeft} days left this month.`;
}

export function goalNextStep(goal: Goal, currency: Currency): string {
  const p = goalProgress(goal);
  if (p.remaining === 0) return `${goal.name} is fully funded.`;
  if (p.onTrack) return `On track — ${money(p.requiredMonthly, currency)}/month keeps ${goal.name} on time.`;
  return `Behind by ${money(p.gap, currency)}/month. Add ${money(p.requiredMonthly, currency)} monthly to catch up.`;
}
