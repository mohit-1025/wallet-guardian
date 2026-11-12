import { daysUntil, fmtDate, todayISO } from "./dates";
import { formatMoney } from "./money";
import type { FlowExpense, FlowTab, ScheduledPayment, Subscription, UserData } from "./types";

export type FlowEventKind = "overdue" | "dueSoon" | "upcoming" | "paid";

export interface FlowCalendarEvent {
  id: string;
  name: string;
  date: string;
  amount: number;
  kind: FlowEventKind;
}

export type FlagSeverity = "critical" | "warning" | "info";

export interface FlowFlag {
  id: string;
  severity: FlagSeverity;
  title: string;
  body: string;
  /** Annual rupees that could be freed by acting on the flag. */
  saving?: number;
}

function dueKind(date: string): FlowEventKind {
  const days = daysUntil(date);
  if (days < 0) return "overdue";
  if (days <= 3) return "dueSoon";
  return "upcoming";
}

/** Due, due-soon, upcoming and paid events for a tab's calendar. */
export function flowCalendarEvents(data: UserData, tab: FlowTab): FlowCalendarEvent[] {
  const events: FlowCalendarEvent[] = [];
  const scheduleById = new Map(data.scheduledPayments.map((p) => [p.id, p]));

  if (tab === "autopay") {
    for (const payment of data.scheduledPayments) {
      if (payment.status === "active") {
        events.push({
          id: `due_${payment.id}`,
          name: payment.payeeName,
          date: payment.nextRunDate,
          amount: payment.amount,
          kind: dueKind(payment.nextRunDate),
        });
      }
      for (const run of payment.history) {
        if (run.status === "failed") continue;
        events.push({ id: run.id, name: payment.payeeName, date: run.date, amount: run.amount, kind: "paid" });
      }
    }
    return events;
  }

  for (const flow of data.flowExpenses.filter((f) => f.tab === tab)) {
    const schedule = flow.autopayId ? scheduleById.get(flow.autopayId) : undefined;
    if (flow.status === "active") {
      const activeSchedule = schedule?.status === "active" ? schedule : undefined;
      const date = activeSchedule?.nextRunDate ?? flow.dueDate;
      if (date) {
        events.push({
          id: `due_${flow.id}`,
          name: flow.name,
          date,
          amount: activeSchedule?.amount ?? flow.amount,
          kind: dueKind(date),
        });
      }
    }
    if (schedule) {
      for (const run of schedule.history) {
        if (run.status === "failed") continue;
        events.push({ id: run.id, name: flow.name, date: run.date, amount: run.amount, kind: "paid" });
      }
    }
  }
  return events;
}

function monthlyCost(sub: Subscription) {
  return sub.cycle === "monthly" ? sub.cost : sub.cost / 12;
}

function addDueFlags(flags: FlowFlag[], dated: { name: string; date: string; amount: number }[], currency: UserData["profile"]["currency"]) {
  const today = todayISO();
  const overdue = dated.filter((d) => d.date < today);
  const dueSoon = dated.filter((d) => d.date >= today && daysUntil(d.date) <= 3);

  if (overdue.length) {
    const total = overdue.reduce((s, d) => s + d.amount, 0);
    flags.push({
      id: "due_overdue",
      severity: "warning",
      title: `${overdue.length} ${overdue.length === 1 ? "expense is" : "expenses are"} past due`,
      body: `${formatMoney(total, currency)} is past its due date (${overdue.map((d) => d.name).slice(0, 3).join(", ")}${overdue.length > 3 ? "…" : ""}). Pay it or move the due date to keep the calendar honest.`,
    });
  }
  if (dueSoon.length) {
    const total = dueSoon.reduce((s, d) => s + d.amount, 0);
    flags.push({
      id: "due_soon",
      severity: "info",
      title: `${dueSoon.length} ${dueSoon.length === 1 ? "expense" : "expenses"} due in the next 3 days`,
      body: `${formatMoney(total, currency)} is coming up. Make sure the wallet covers it${dueSoon.length === 1 ? ` for ${dueSoon[0].name} on ${fmtDate(dueSoon[0].date, "d MMM")}` : ""}.`,
    });
  }
}

function scheduleFor(flow: FlowExpense, schedules: Map<string, ScheduledPayment>) {
  return flow.autopayId ? schedules.get(flow.autopayId) : undefined;
}

/** Rules-based waste and optimisation flags for one Money flows tab. */
export function flowFlags(data: UserData, tab: FlowTab): FlowFlag[] {
  if (tab === "autopay") return autopayFlags(data);

  const currency = data.profile.currency;
  const rows = data.flowExpenses.filter((f) => f.tab === tab);
  const active = rows.filter((f) => f.status === "active");
  const paused = rows.filter((f) => f.status === "paused");
  const scheduleById = new Map(data.scheduledPayments.map((p) => [p.id, p]));
  const subById = new Map(data.subscriptions.map((s) => [s.id, s]));
  const flags: FlowFlag[] = [];

  const dated = active
    .map((flow) => {
      const schedule = scheduleFor(flow, scheduleById);
      const activeSchedule = schedule?.status === "active" ? schedule : undefined;
      const date = activeSchedule?.nextRunDate ?? flow.dueDate;
      return date ? { name: flow.name, date, amount: activeSchedule?.amount ?? flow.amount } : null;
    })
    .filter((d): d is { name: string; date: string; amount: number } => Boolean(d));
  addDueFlags(flags, dated, currency);

  if (tab === "subscriptions") {
    const groups = new Map<string, FlowExpense[]>();
    for (const flow of active) {
      const sub = flow.legacyId ? subById.get(flow.legacyId) : undefined;
      const word = flow.name.toLowerCase().trim().split(/[^a-z0-9]+/).filter(Boolean)[0] ?? "";
      const key = sub?.duplicateGroup ? `group:${sub.duplicateGroup}` : word.length >= 4 ? `word:${word}` : "";
      if (!key) continue;
      groups.set(key, [...(groups.get(key) ?? []), flow]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const waste = [...group].sort((a, b) => a.amount - b.amount).slice(1).reduce((s, f) => s + f.amount, 0);
      flags.push({
        id: `dupe_${group.map((g) => g.id).sort().join("_")}`,
        severity: "warning",
        title: `Possible overlap: ${group.map((g) => g.name).join(" + ")}`,
        body: `These look like the same kind of subscription. Keeping the cheapest one frees about ${formatMoney(waste * 12, currency)} a year.`,
        saving: Math.round(waste * 12),
      });
    }
  }

  for (const flow of active) {
    const sub = flow.legacyId ? subById.get(flow.legacyId) : undefined;
    if (!sub) continue;
    if (sub.lastUsedDaysAgo >= 60) {
      const yearly = Math.round(monthlyCost(sub) * 12);
      flags.push({
        id: `unused_${flow.id}`,
        severity: "warning",
        title: `${flow.name} looks forgotten`,
        body: `No logged use in ${sub.lastUsedDaysAgo} days, but it still bills ${formatMoney(sub.cost, currency)}/${sub.cycle === "monthly" ? "mo" : "yr"}. Cancelling frees about ${formatMoney(yearly, currency)} a year.`,
        saving: yearly,
      });
    }
    const first = sub.priceHistory[0]?.price;
    const latest = sub.priceHistory[sub.priceHistory.length - 1]?.price;
    if (first && latest && latest > first) {
      const yearly = Math.round(sub.cycle === "monthly" ? (latest - first) * 12 : latest - first);
      flags.push({
        id: `price_${flow.id}`,
        severity: "warning",
        title: `${flow.name} costs more than before`,
        body: `The price went from ${formatMoney(first, currency)} to ${formatMoney(latest, currency)} per ${sub.cycle === "monthly" ? "month" : "year"} — ${formatMoney(yearly, currency)} more a year.`,
        saving: yearly,
      });
    }
  }

  const manual = active.filter((f) => !scheduleFor(f, scheduleById));
  if (manual.length) {
    const total = manual.reduce((s, f) => s + f.amount, 0);
    flags.push({
      id: "manual_payments",
      severity: "info",
      title: `${manual.length} ${manual.length === 1 ? "expense has" : "expenses have"} no autopay`,
      body: `${formatMoney(total, currency)} per cycle is paid manually. Link a sandbox schedule to avoid missed payments, or keep paying by hand.`,
    });
  }

  const undated = active.filter((f) => !f.dueDate && !scheduleFor(f, scheduleById));
  if (undated.length) {
    flags.push({
      id: "no_due_date",
      severity: "info",
      title: `${undated.length} ${undated.length === 1 ? "expense has" : "expenses have"} no due date`,
      body: "Without a due date they won't appear on the calendar. Add a next-due date from Edit so upcoming costs stay visible.",
    });
  }

  const total = active.reduce((s, f) => s + f.amount, 0);
  const top = [...active].sort((a, b) => b.amount - a.amount)[0];
  if (active.length >= 2 && total > 0 && top.amount / total >= 0.5) {
    flags.push({
      id: `concentration_${top.id}`,
      severity: "info",
      title: `${top.name} is ${Math.round((top.amount / total) * 100)}% of this tab`,
      body: `At ${formatMoney(top.amount, currency)} per cycle it dominates the category. Renegotiating or splitting this line moves the needle most.`,
    });
  }

  if (tab === "emis" && data.profile.monthlyIncome > 0 && active.length) {
    const pct = Math.round((total / data.profile.monthlyIncome) * 100);
    if (pct >= 35) {
      flags.push({
        id: "emi_load",
        severity: pct >= 50 ? "critical" : "warning",
        title: `EMIs use ${pct}% of monthly income`,
        body: "Lenders usually prefer instalments below 40% of income. Consider prepaying the smallest loan or refinancing before adding a new one.",
      });
    }
  }

  if (paused.length) {
    const pausedTotal = paused.reduce((s, f) => s + f.amount, 0);
    flags.push({
      id: "paused_rows",
      severity: "info",
      title: `${paused.length} paused ${paused.length === 1 ? "expense" : "expenses"}`,
      body: `${formatMoney(pausedTotal, currency)} per cycle is paused and excluded from commitments. Delete anything you've actually cancelled.`,
    });
  }

  return flags.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

function autopayFlags(data: UserData): FlowFlag[] {
  const currency = data.profile.currency;
  const today = todayISO();
  const schedules = data.scheduledPayments;
  const active = schedules.filter((p) => p.status === "active");
  const paused = schedules.filter((p) => p.status === "paused");
  const flags: FlowFlag[] = [];

  const dated = active.map((p) => ({ name: p.payeeName, date: p.nextRunDate, amount: p.amount }));
  addDueFlags(flags, dated, currency);

  const failed = schedules.flatMap((p) => p.history.filter((run) => run.status === "failed"));
  if (failed.length) {
    flags.push({
      id: "failed_runs",
      severity: "warning",
      title: `${failed.length} payout ${failed.length === 1 ? "run" : "runs"} failed`,
      body: "The sandbox rejected the last attempts. Check the receiver's PayPal email and retry the schedule.",
    });
  }

  const dueIn7 = active
    .filter((p) => p.nextRunDate >= today && daysUntil(p.nextRunDate) <= 7)
    .reduce((s, p) => s + p.amount, 0);
  if (dueIn7 > data.profile.walletBalance) {
    flags.push({
      id: "wallet_short",
      severity: "critical",
      title: "Wallet won't cover the next 7 days",
      body: `${formatMoney(dueIn7, currency)} is due from active schedules, but the sandbox wallet holds ${formatMoney(data.profile.walletBalance, currency)}. Top up before running them.`,
    });
  }

  const byEmail = new Map<string, ScheduledPayment[]>();
  for (const payment of active) {
    const email = payment.payeeEmail.trim().toLowerCase();
    byEmail.set(email, [...(byEmail.get(email) ?? []), payment]);
  }
  for (const [email, group] of byEmail) {
    if (group.length < 2) continue;
    flags.push({
      id: `same_payee_${email}`,
      severity: "info",
      title: `${group.length} active schedules pay ${email}`,
      body: `That's ${formatMoney(group.reduce((s, p) => s + p.amount, 0), currency)} per run. Merge them if it's the same commitment.`,
    });
  }

  if (paused.length) {
    flags.push({
      id: "paused_schedules",
      severity: "info",
      title: `${paused.length} ${paused.length === 1 ? "schedule is" : "schedules are"} paused`,
      body: `${formatMoney(paused.reduce((s, p) => s + p.amount, 0), currency)} per run won't leave the wallet until you resume. Delete the ones you no longer need.`,
    });
  }

  return flags.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

function severityRank(severity: FlagSeverity) {
  return severity === "critical" ? 0 : severity === "warning" ? 1 : 2;
}
