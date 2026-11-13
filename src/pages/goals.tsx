import { useMemo, useState } from "react";
import {
  CalendarDays, Check, Pencil, PiggyBank, Plus, Sparkles, Target, Trash2, TrendingUp, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader, Badge, EmptyState, InfoNote } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CategoryIcon } from "@/components/ui/category-icon";
import { Money, MoneyInput } from "@/components/ui/money";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { useApp, useAppData } from "@/lib/app-context";
import { goalProgress, savingsForecast, savingsGoalTotals } from "@/lib/finance";
import { addMonthsISO, fmtDate, todayISO } from "@/lib/dates";
import { formatAmountInput, formatCompact, formatMoney, parseToInr } from "@/lib/money";
import type { Goal } from "@/lib/types";
import { cn } from "@/lib/utils";

const GOAL_ICONS = ["shield", "plane", "target", "piggy-bank", "home", "laptop", "graduation-cap", "sparkles", "book", "dumbbell", "music", "camera"];
const GOAL_ICON_LABEL: Record<string, string> = {
  shield: "Shield",
  plane: "Plane",
  target: "Target",
  "piggy-bank": "Piggy bank",
  home: "Home",
  laptop: "Laptop",
  "graduation-cap": "Education",
  sparkles: "Sparkles",
  book: "Book",
  dumbbell: "Fitness",
  music: "Music",
  camera: "Camera",
};
const GOAL_COLORS = ["#059669", "#4f46e5", "#d97706", "#e11d48", "#0d9488", "#7c3aed"];

export default function GoalsPage() {
  const data = useAppData();
  const { addGoal, updateGoal, deleteGoal, contributeToGoal, withdrawFromGoal } = useApp();
  const currency = data.profile.currency;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [savedStart, setSavedStart] = useState("");
  const [deadline, setDeadline] = useState(() => addMonthsISO(todayISO(), 6));
  const [autoMonthly, setAutoMonthly] = useState("");
  const [icon, setIcon] = useState("target");
  const [color, setColor] = useState(GOAL_COLORS[0]);

  const [contributeFor, setContributeFor] = useState<Goal | null>(null);
  const [contribution, setContribution] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Goal | null>(null);

  const totals = savingsGoalTotals(data.goals);
  const autoTotal = data.goals.reduce((s, g) => s + Math.max(0, g.autoMonthly ?? 0), 0);
  const onTrackCount = data.goals.filter((g) => goalProgress(g).onTrack).length;
  const forecast = useMemo(() => savingsForecast(data, autoTotal), [data, autoTotal]);
  const projected = forecast[forecast.length - 1]?.saved ?? totals.saved;

  function openAdd() {
    setEditing(null);
    setName("");
    setTarget("");
    setSavedStart("");
    setDeadline(addMonthsISO(todayISO(), 6));
    setAutoMonthly("");
    setIcon("target");
    setColor(GOAL_COLORS[0]);
    setFormOpen(true);
  }

  function openEdit(goal: Goal) {
    setEditing(goal);
    setName(goal.name);
    setTarget(formatAmountInput(goal.target, currency));
    setSavedStart(formatAmountInput(goal.saved, currency));
    setDeadline(goal.deadline);
    setAutoMonthly(goal.autoMonthly ? formatAmountInput(goal.autoMonthly, currency) : "");
    setIcon(goal.icon);
    setColor(goal.color);
    setFormOpen(true);
  }

  function save() {
    const targetInr = parseToInr(target, currency);
    const autoInr = parseToInr(autoMonthly || "0", currency);
    if (!name.trim()) {
      toast.error("Give your goal a name.");
      return;
    }
    if (targetInr <= 0) {
      toast.error("Set a target above zero.");
      return;
    }
    if (!deadline) {
      toast.error("Choose a deadline.");
      return;
    }
    if (deadline < todayISO()) {
      toast.error("Pick a deadline in the future.");
      return;
    }
    const startInr = Math.min(parseToInr(savedStart || "0", currency), targetInr);
    if (startInr - (editing?.saved ?? 0) > data.profile.walletBalance) {
      toast.error("Not enough in your wallet. Add money first.");
      return;
    }
    if (editing) {
      const prevSaved = editing.saved;
      updateGoal(editing.id, {
        name: name.trim(),
        target: targetInr,
        deadline,
        autoMonthly: autoInr,
        icon,
        color,
      });
      const delta = startInr - prevSaved;
      if (delta > 0) contributeToGoal(editing.id, delta);
      else if (delta < 0) withdrawFromGoal(editing.id, -delta);
      toast.success("Goal updated");
    } else {
      const goal = addGoal({
        name: name.trim(),
        target: targetInr,
        saved: 0,
        deadline,
        autoMonthly: autoInr,
        icon,
        color,
      });
      if (startInr > 0) contributeToGoal(goal.id, startInr);
      toast.success("Goal created", { description: autoInr > 0 ? `${formatMoney(autoInr, currency)} will be tracked monthly.` : "Add a monthly contribution to stay on track." });
    }
    setFormOpen(false);
  }

  function openContribute(goal: Goal) {
    setContributeFor(goal);
    setContribution(goal.autoMonthly ? formatAmountInput(goal.autoMonthly, currency) : "");
  }

  function addContribution() {
    if (!contributeFor) return;
    const amt = parseToInr(contribution, currency);
    if (amt <= 0) {
      toast.error("Enter an amount above zero.");
      return;
    }
    const room = Math.max(0, contributeFor.target - contributeFor.saved);
    const applied = Math.min(amt, room);
    if (applied > data.profile.walletBalance) {
      toast.error("Not enough in your wallet", {
        description: `Wallet balance is ${formatMoney(data.profile.walletBalance, currency)}. Add money first.`,
      });
      return;
    }
    contributeToGoal(contributeFor.id, applied);
    toast.success(`${formatMoney(applied, currency)} added to ${contributeFor.name}`, {
      description: "Moved from your wallet and recorded as a savings transfer.",
    });
    setContributeFor(null);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteGoal(deleteTarget.id);
    toast.success("Goal deleted", {
      description: deleteTarget.saved > 0
        ? `${formatMoney(deleteTarget.saved, currency)} was refunded to your PayPal wallet.`
        : "Nothing was saved in this vault.",
    });
    setDeleteTarget(null);
  }

  return (
    <div>
      <PageHeader
        title="Savings goals"
        description="Named vaults with a target, deadline and monthly plan. The guardian tells you if you're on track or falling behind."
        actions={<Button size="sm" onClick={openAdd}><Plus /> Add goal</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {[
          { label: "Saved so far", value: totals.saved, sub: `Across ${data.goals.length} goal${data.goals.length === 1 ? "" : "s"}`, tone: "text-success" },
          { label: "Total targets", value: totals.target, sub: `${Math.round((totals.saved / Math.max(1, totals.target)) * 100)}% funded`, tone: "text-foreground" },
          { label: "Monthly auto-plan", value: autoTotal, sub: "Tracked contributions", tone: "text-foreground" },
          { label: "On track", value: null, sub: `${onTrackCount} of ${data.goals.length}`, tone: onTrackCount === data.goals.length ? "text-success" : "text-warning" },
        ].map((stat) => (
          <Card key={stat.label} className="p-3.5 sm:p-4">
            <p className="text-[11px] font-medium text-muted-foreground sm:text-xs">{stat.label}</p>
            <p className={cn("mt-1 text-lg font-semibold tracking-tight tabular sm:text-xl", stat.tone)}>
              {stat.value === null ? <span className="tabular">{onTrackCount}</span> : <Money value={stat.value} currency={currency} />}
            </p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">{stat.sub}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          {data.goals.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Target />}
                title="No savings goals yet"
                description="Create a named vault for an emergency fund, a trip or a new laptop. Add a deadline and the guardian works out the monthly amount."
                action={<Button size="sm" onClick={openAdd}><Plus /> Create your first goal</Button>}
              />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {data.goals.map((goal) => {
                const p = goalProgress(goal);
                const funded = p.remaining === 0;
                return (
                  <Card key={goal.id} className="relative overflow-hidden p-4 sm:p-5">
                    <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full blur-2xl" style={{ backgroundColor: `${goal.color}22` }} aria-hidden />
                    <div className="relative">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${goal.color}18`, color: goal.color }}>
                            <CategoryIcon name={goal.icon} className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[14px] font-semibold">{goal.name}</p>
                            <p className="mt-0.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
                              <CalendarDays className="h-2.5 w-2.5" /> {fmtDate(goal.deadline, "d MMM yyyy")} · {p.daysLeft} days left
                            </p>
                          </div>
                        </div>
                        <Badge variant={funded ? "success" : p.onTrack ? "success" : "warning"}>
                          {funded ? "Funded" : p.onTrack ? "On track" : "Behind"}
                        </Badge>
                      </div>

                      <div className="mt-4">
                        <div className="flex items-end justify-between gap-2">
                          <p className="text-[20px] font-semibold leading-none tracking-tight tabular">
                            <Money value={goal.saved} currency={currency} />
                          </p>
                          <p className="text-[11px] text-muted-foreground">of {formatMoney(goal.target, currency)}</p>
                        </div>
                        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.progress)} aria-label={`${goal.name} progress`}>
                          <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${p.progress}%`, backgroundColor: goal.color }} />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[10.5px] text-muted-foreground">
                          <span className="font-semibold text-foreground">{Math.round(p.progress)}%</span>
                          <span>{formatMoney(p.remaining, currency)} to go</span>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
                          <p className="text-[9.5px] uppercase tracking-wide text-muted-foreground">Needed monthly</p>
                          <p className="mt-0.5 font-semibold tabular">{formatMoney(p.requiredMonthly, currency)}</p>
                        </div>
                        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
                          <p className="text-[9.5px] uppercase tracking-wide text-muted-foreground">Auto each month</p>
                          <p className={cn("mt-0.5 font-semibold tabular", p.gap > 0 && !funded ? "text-warning" : "")}>{formatMoney(goal.autoMonthly ?? 0, currency)}</p>
                        </div>
                      </div>

                      {!funded && p.gap > 0 && (
                        <p className="mt-2 rounded-lg bg-warning-soft px-2.5 py-2 text-[10.5px] leading-relaxed text-warning">
                          Add {formatMoney(p.gap, currency)}/mo to reach this goal by {fmtDate(goal.deadline, "MMM yyyy")}.
                        </p>
                      )}

                      <div className="mt-3 flex items-center gap-1.5">
                        <Button size="sm" className="flex-1" onClick={() => openContribute(goal)} disabled={funded}>
                          <PiggyBank /> {funded ? "Goal funded" : "Add money"}
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${goal.name}`} onClick={() => openEdit(goal)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${goal.name}`} onClick={() => setDeleteTarget(goal)}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-4 lg:col-span-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>12-month forecast</CardTitle>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">At {formatMoney(autoTotal, currency)}/mo across all goals</p>
              </div>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-success-soft text-success"><TrendingUp className="h-3.5 w-3.5" /></span>
            </CardHeader>
            <CardContent>
              {autoTotal === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-8 text-center">
                  <Wallet className="h-5 w-5 text-muted-foreground" />
                  <p className="mt-2 text-[12px] font-medium">No monthly plan yet</p>
                  <p className="max-w-[220px] text-[10.5px] text-muted-foreground">Edit a goal and add an auto monthly amount to see the forecast.</p>
                </div>
              ) : (
                <>
                  <div className="h-[170px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={forecast} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                        <defs>
                          <linearGradient id="goalForecast" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#059669" stopOpacity={0.28} />
                            <stop offset="100%" stopColor="#059669" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} dy={6} interval={1} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} tickFormatter={(v) => formatCompact(Number(v), currency)} width={52} />
                        <Tooltip content={<ChartTooltip currency={currency} />} />
                        <Area type="monotone" dataKey="saved" name="Projected saved" stroke="#059669" strokeWidth={2.2} fill="url(#goalForecast)" dot={false} activeDot={{ r: 4 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 rounded-xl border border-success/20 bg-success-soft/50 p-3">
                    <p className="text-[10.5px] uppercase tracking-wide text-success">Projected in 12 months</p>
                    <p className="mt-1 text-lg font-semibold tabular text-success"><Money value={projected} currency={currency} /></p>
                    <p className="mt-0.5 text-[10.5px] text-success/80">{formatMoney(Math.max(0, projected - totals.saved), currency)} of new contributions · {Math.min(100, Math.round((projected / Math.max(1, totals.target)) * 100))}% of all targets</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How progress is judged</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-[11.5px] leading-relaxed text-muted-foreground">
              <p className="flex items-start gap-2"><Check className="mt-0.5 h-3 w-3 shrink-0 text-success" /> On track when your saved amount plus remaining auto contributions covers the target.</p>
              <p className="flex items-start gap-2"><Check className="mt-0.5 h-3 w-3 shrink-0 text-success" /> Needed monthly divides the gap by months left before the deadline.</p>
              <p className="flex items-start gap-2"><Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" /> Forecast assumes the auto plan stays unchanged and adds no interest.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <InfoNote className="mt-4" icon={<PiggyBank />}>
        Contributions move money out of your wallet into savings. Deleting a goal returns its saved amount to your wallet. Both movements are recorded as transfers, not spending or income.
      </InfoNote>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit goal" : "Create a savings goal"}</DialogTitle>
            <DialogDescription>A named vault makes it easier to protect money for what matters.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="goal-name">Goal name</Label>
              <Input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Emergency fund" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="goal-target">Target amount</Label>
                <MoneyInput id="goal-target" value={target} currency={currency} onChange={setTarget} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="goal-saved">{editing ? "Saved so far" : "Already saved (optional)"}</Label>
                <MoneyInput id="goal-saved" value={savedStart} currency={currency} onChange={setSavedStart} placeholder="0" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="goal-deadline">Deadline</Label>
                <Input id="goal-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="goal-auto">Auto each month</Label>
                <MoneyInput id="goal-auto" value={autoMonthly} currency={currency} onChange={setAutoMonthly} placeholder="0" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-icon">Icon</Label>
              <Select value={icon} onValueChange={setIcon}>
                <SelectTrigger id="goal-icon" aria-label="Goal icon">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GOAL_ICONS.map((key) => (
                    <SelectItem key={key} value={key}>
                      <span className="flex items-center gap-2"><CategoryIcon name={key} className="h-4 w-4" /> {GOAL_ICON_LABEL[key] ?? key}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Colour</Label>
              <div className="flex gap-2">
                {GOAL_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Use colour ${c}`}
                    aria-pressed={color === c}
                    className={cn("h-8 w-8 rounded-full ring-offset-2 ring-offset-background transition-all", color === c ? "ring-2 ring-foreground" : "hover:scale-105")}
                    style={{ backgroundColor: c }}
                  >
                    {color === c && <Check className="mx-auto h-4 w-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? "Save changes" : "Create goal"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!contributeFor} onOpenChange={(open) => !open && setContributeFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add money to {contributeFor?.name}</DialogTitle>
            <DialogDescription>
              {contributeFor ? `${formatMoney(Math.max(0, contributeFor.target - contributeFor.saved), currency)} still needed before ${fmtDate(contributeFor.deadline, "d MMM yyyy")}.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="goal-contribution">Contribution</Label>
              <MoneyInput id="goal-contribution" value={contribution} currency={currency} onChange={setContribution} />
            </div>
            <InfoNote>Moved from your wallet. Available: {formatMoney(data.profile.walletBalance, currency)}.</InfoNote>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContributeFor(null)}>Cancel</Button>
            <Button onClick={addContribution}><PiggyBank /> Add contribution</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              This removes the vault. Everything saved in it — {formatMoney(deleteTarget?.saved ?? 0, currency)} — is refunded to your
              PayPal wallet and registered as a transaction, so the balance always matches the ledger.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Keep it</Button>
            <Button variant="destructive" onClick={confirmDelete}><Trash2 /> Delete goal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
