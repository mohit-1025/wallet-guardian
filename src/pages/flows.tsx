import { useEffect, useMemo } from "react";
import { Navigate, useParams } from "react-router-dom";
import { FlaskConical, Layers } from "lucide-react";
import { PageHeader, Badge, InfoNote } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { AutopayPanel } from "@/components/flows/autopay-panel";
import { FlowCalendar } from "@/components/flows/flow-calendar";
import { FlowFlags } from "@/components/flows/flow-flags";
import { FlowPanel, TAB_ICON } from "@/components/flows/flow-panel";
import { useApp, useAppData } from "@/lib/app-context";
import { FLOW_TAB_LABEL, FLOW_TABS } from "@/lib/flows";
import { daysUntil } from "@/lib/dates";
import type { FlowTab, ScheduledPayment } from "@/lib/types";

const VALID_TABS = FLOW_TABS.map((t) => t.key);

function monthlyEquivalent(p: ScheduledPayment) {
  if (p.frequency === "monthly") return p.amount;
  if (p.frequency === "weekly") return Math.round((p.amount * 52) / 12);
  return 0;
}

function amountInNext30(p: ScheduledPayment) {
  if (p.status !== "active") return 0;
  const days = daysUntil(p.nextRunDate);
  if (days > 30) return 0;
  const runs = p.frequency === "weekly" ? Math.floor((30 - Math.max(0, days)) / 7) + 1 : 1;
  return runs * p.amount;
}

export default function FlowCategoryPage() {
  const { tab } = useParams();
  const data = useAppData();
  const { initializeFlowExpenses } = useApp();

  useEffect(() => {
    initializeFlowExpenses();
  }, [initializeFlowExpenses]);

  const current = tab as FlowTab;
  const rows = useMemo(
    () => data.flowExpenses.filter((f) => f.tab === current),
    [data.flowExpenses, current],
  );

  if (!tab || !VALID_TABS.includes(current)) return <Navigate to="/app" replace />;

  const currency = data.profile.currency;
  const Icon = TAB_ICON[current];
  const hint = FLOW_TABS.find((t) => t.key === current)?.hint ?? "";
  const isAutopay = current === "autopay";

  const active = rows.filter((f) => f.status === "active");
  const onAutopay = rows.filter((f) => f.autopayId && data.scheduledPayments.some((p) => p.id === f.autopayId));
  const autopayAmount = onAutopay
    .filter((f) => f.status === "active")
    .reduce((s, f) => s + (data.scheduledPayments.find((p) => p.id === f.autopayId)?.amount ?? f.amount), 0);

  const activeSchedules = data.scheduledPayments.filter((p) => p.status === "active");
  const scheduleStats = {
    monthly: activeSchedules.reduce((s, p) => s + monthlyEquivalent(p), 0),
    next30: data.scheduledPayments.reduce((s, p) => s + amountInNext30(p), 0),
    runs: data.scheduledPayments.flatMap((p) => p.history).filter((r) => r.status === "paid" || r.status === "simulated").length,
  };

  const stats = isAutopay
    ? [
        { label: "Active schedules", value: activeSchedules.length, sub: `${data.scheduledPayments.length - activeSchedules.length} paused or finished`, money: false },
        { label: "Monthly commitment", value: scheduleStats.monthly, sub: "Recurring active schedules", money: true },
        { label: "Next 30 days", value: scheduleStats.next30, sub: "Due from active schedules", money: true },
        { label: "Payout runs", value: scheduleStats.runs, sub: "Paid or simulated", money: false },
      ]
    : [
        { label: "Active expenses", value: active.length, sub: `${rows.length - active.length} paused`, money: false },
        { label: "Committed", value: active.reduce((s, f) => s + f.amount, 0), sub: "Active flows, per cycle", money: true },
        { label: "On autopay", value: onAutopay.length, sub: "Linked PayPal schedules", money: false },
        { label: "Autopay amount", value: autopayAmount, sub: "Active schedules, per run", money: true },
      ];

  const description = isAutopay
    ? "PayPal payouts on your schedule — run one now, pause it, edit the receiver, or review its history. Sandbox only."
    : `${hint}. Add an expense with its amount, optionally link autopay to send it from your PayPal sandbox, and pause or edit it any time.`;

  return (
    <div>
      <PageHeader
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1"><Layers /> Money flows</Badge>
            <Badge variant="outline">Sandbox payments</Badge>
          </div>
        }
        title={FLOW_TAB_LABEL[current]}
        description={description}
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-3.5 sm:p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground sm:text-xs">
              <Icon className="h-3.5 w-3.5" /> {stat.label}
            </p>
            <p className="mt-1 text-lg font-semibold tracking-tight tabular sm:text-xl">
              {stat.money ? <Money value={stat.value} currency={currency} /> : stat.value}
            </p>
            <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{stat.sub}</p>
          </Card>
        ))}
      </div>

      <div className="mb-4">
        {isAutopay ? <AutopayPanel /> : <FlowPanel tab={current} />}
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-12">
        <FlowCalendar tab={current} className="lg:col-span-7" />
        <FlowFlags tab={current} className="lg:col-span-5" />
      </div>

      <InfoNote className="mt-4" icon={<FlaskConical />}>
        {isAutopay
          ? "Runs are manual: press Run now and the server attempts a PayPal sandbox payout, falling back to a labelled simulation when payouts aren't enabled. Each run records an expense and debits the sandbox wallet."
          : "Autopay schedules send PayPal sandbox payouts from the server's sandbox app — no real money moves. Anything from onboarding can be edited, paused or deleted here without changing your budget split."}
      </InfoNote>
    </div>
  );
}
