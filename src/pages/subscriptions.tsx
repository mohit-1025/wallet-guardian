import { useMemo, useState } from "react";
import {
  CalendarClock, Clock, Copy, Mail, Pencil, Plus, Repeat, RotateCcw, ShieldCheck,
  Sparkles, TrendingUp, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Badge, EmptyState, InfoNote } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CategoryIcon } from "@/components/ui/category-icon";
import { Money, MoneyInput } from "@/components/ui/money";
import { useApp, useAppData } from "@/lib/app-context";
import { subscriptionMonthly, subscriptionStats } from "@/lib/finance";
import { addMonthsISO, daysUntil, fmtDate, relativeDue, todayISO } from "@/lib/dates";
import { formatAmountInput, formatMoney, parseToInr } from "@/lib/money";
import type { Subscription } from "@/lib/types";
import { cn } from "@/lib/utils";

const COMMON_CATEGORIES = ["Entertainment", "Productivity", "Fitness", "Education", "Music", "Cloud storage", "News", "Other"];

const SUB_ICONS: Record<string, string> = {
  Entertainment: "clapperboard",
  Productivity: "laptop",
  Fitness: "dumbbell",
  Education: "graduation-cap",
  Music: "music",
  "Cloud storage": "laptop",
  News: "book",
};

const FLAG_BADGE = { duplicate: "warning", unused: "secondary", price: "danger" } as const;

interface SubFlag {
  kind: keyof typeof FLAG_BADGE;
  label: string;
}

function flagsFor(sub: Subscription, all: Subscription[], currency: "INR" | "USD" | "EUR"): SubFlag[] {
  if (sub.status !== "active") return [];
  const out: SubFlag[] = [];
  if (sub.duplicateGroup) {
    const group = all.filter((s) => s.status === "active" && s.duplicateGroup === sub.duplicateGroup);
    if (group.length > 1) out.push({ kind: "duplicate", label: "Duplicate" });
  }
  if (sub.lastUsedDaysAgo > 60) out.push({ kind: "unused", label: "Unused" });
  const first = sub.priceHistory[0]?.price;
  const last = sub.priceHistory[sub.priceHistory.length - 1]?.price;
  if (first && last && last > first) {
    out.push({ kind: "price", label: `Up from ${formatMoney(first, currency)}` });
  }
  return out;
}

interface FlagRow {
  id: string;
  kind: keyof typeof FLAG_BADGE;
  title: string;
  body: string;
  amount?: number;
  sub?: Subscription;
  canKeep?: boolean;
}

export default function SubscriptionsPage() {
  const data = useAppData();
  const { addSubscription, updateSubscription, deleteSubscription } = useApp();
  const currency = data.profile.currency;
  const stats = subscriptionStats(data.subscriptions);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [nextDate, setNextDate] = useState(() => addMonthsISO(todayISO(), 1));
  const [category, setCategory] = useState("Entertainment");
  const [usage, setUsage] = useState("1");

  const [draftFor, setDraftFor] = useState<Subscription | null>(null);
  const [draftText, setDraftText] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Subscription | null>(null);

  const active = useMemo(
    () => [...stats.active].sort((a, b) => a.nextBillingDate.localeCompare(b.nextBillingDate)),
    [stats.active],
  );
  const cancelled = data.subscriptions.filter((s) => s.status === "cancelled");

  const categoryOptions = useMemo(
    () => [...new Set([...COMMON_CATEGORIES, ...data.subscriptions.map((s) => s.category)])].sort((a, b) => a.localeCompare(b)),
    [data.subscriptions],
  );

  const flaggedCount = active.filter((s) => flagsFor(s, data.subscriptions, currency).length > 0).length;

  const potential = useMemo(() => {
    let monthly = 0;
    const counted = new Set<string>();
    const groups = new Map<string, Subscription[]>();
    for (const s of stats.active) {
      if (!s.duplicateGroup) continue;
      const arr = groups.get(s.duplicateGroup) ?? [];
      arr.push(s);
      groups.set(s.duplicateGroup, arr);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => subscriptionMonthly(a) - subscriptionMonthly(b));
      for (const extra of sorted.slice(1)) {
        monthly += subscriptionMonthly(extra);
        counted.add(extra.id);
      }
    }
    for (const s of stats.active) {
      if (s.lastUsedDaysAgo > 60 && !counted.has(s.id)) {
        monthly += subscriptionMonthly(s);
        counted.add(s.id);
      }
    }
    return Math.round(monthly * 12);
  }, [stats.active]);

  const flagRows = useMemo<FlagRow[]>(() => {
    const rows: FlagRow[] = [];
    const groups = new Map<string, Subscription[]>();
    for (const s of stats.active) {
      if (!s.duplicateGroup) continue;
      const arr = groups.get(s.duplicateGroup) ?? [];
      arr.push(s);
      groups.set(s.duplicateGroup, arr);
    }
    for (const [key, group] of groups) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => subscriptionMonthly(a) - subscriptionMonthly(b));
      const waste = sorted.slice(1).reduce((sum, s) => sum + subscriptionMonthly(s), 0);
      rows.push({
        id: `dupe_${key}`,
        kind: "duplicate",
        title: "Overlapping subscriptions",
        body: `${group.map((s) => s.name).join(" and ")} serve the same purpose. Keeping one saves about ${formatMoney(Math.round(waste * 12), currency)} a year.`,
        amount: Math.round(waste * 12),
        sub: sorted[sorted.length - 1],
      });
    }
    for (const s of stats.active) {
      if (s.lastUsedDaysAgo > 60) {
        rows.push({
          id: `unused_${s.id}`,
          kind: "unused",
          title: `${s.name} looks forgotten`,
          body: `No logged use in ${s.lastUsedDaysAgo} days, but it still bills ${formatMoney(s.cost, currency)}/${s.cycle === "monthly" ? "mo" : "yr"}.`,
          amount: Math.round(subscriptionMonthly(s) * 12),
          sub: s,
          canKeep: true,
        });
      }
    }
    for (const s of stats.active) {
      const first = s.priceHistory[0]?.price;
      const last = s.priceHistory[s.priceHistory.length - 1]?.price;
      if (!first || !last || last <= first) continue;
      rows.push({
        id: `price_${s.id}`,
        kind: "price",
        title: `${s.name} raised its price`,
        body: `Now ${formatMoney(s.cost, currency)}/${s.cycle === "monthly" ? "mo" : "yr"}, up from ${formatMoney(first, currency)} since ${fmtDate(s.priceHistory[0].date, "MMM yyyy")}. That's ${formatMoney((last - first) * (s.cycle === "monthly" ? 12 : 1), currency)} more a year.`,
        amount: (last - first) * (s.cycle === "monthly" ? 12 : 1),
        sub: s,
      });
    }
    return rows;
  }, [stats.active, currency]);

  function openAdd() {
    setEditing(null);
    setName("");
    setCost("");
    setCycle("monthly");
    setNextDate(addMonthsISO(todayISO(), 1));
    setCategory("Entertainment");
    setUsage("1");
    setFormOpen(true);
  }

  function openEdit(sub: Subscription) {
    setEditing(sub);
    setName(sub.name);
    setCost(formatAmountInput(sub.cost, currency));
    setCycle(sub.cycle);
    setNextDate(sub.nextBillingDate);
    setCategory(sub.category);
    setUsage(String(sub.lastUsedDaysAgo));
    setFormOpen(true);
  }

  function save() {
    const amount = parseToInr(cost, currency);
    if (!name.trim()) {
      toast.error("Give the subscription a name.");
      return;
    }
    if (amount <= 0) {
      toast.error("Enter a cost above zero.");
      return;
    }
    if (!nextDate) {
      toast.error("Set the next billing date.");
      return;
    }
    const days = Math.max(0, Math.round(Number(usage) || 0));
    if (editing) {
      const priceChanged = amount !== editing.cost;
      updateSubscription(editing.id, {
        name: name.trim(),
        cost: amount,
        cycle,
        nextBillingDate: nextDate,
        category: category.trim() || "Other",
        lastUsedDaysAgo: days,
        priceHistory: priceChanged
          ? [...editing.priceHistory.filter((p) => p.date !== todayISO()), { date: todayISO(), price: amount }]
          : editing.priceHistory,
      });
      toast.success("Subscription updated");
    } else {
      addSubscription({
        name: name.trim(),
        cost: amount,
        cycle,
        nextBillingDate: nextDate,
        category: category.trim() || "Other",
        lastUsedDaysAgo: days,
      });
      toast.success("Subscription added");
    }
    setFormOpen(false);
  }

  function openDraft(sub: Subscription) {
    setDraftFor(sub);
    setDraftText(
      `Hi ${sub.name} support team,\n\nI'd like to cancel my ${sub.name} subscription (${formatMoney(sub.cost, currency)} per ${sub.cycle === "monthly" ? "month" : "year"}) effective immediately, before the next billing on ${fmtDate(sub.nextBillingDate, "d MMMM yyyy")}.\n\nPlease confirm the cancellation in writing and refund any charges made after this request. My account email is ${data.profile.email}.\n\nThanks,\n${data.profile.name}`,
    );
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draftText);
      toast.success("Cancellation message copied");
    } catch {
      toast.error("Copy failed — select the text and copy manually.");
    }
  }

  function markCancelled() {
    if (!draftFor) return;
    updateSubscription(draftFor.id, { status: "cancelled" });
    toast.success(`${draftFor.name} marked cancelled`, { description: "Send the drafted message to the provider to finish the cancellation." });
    setDraftFor(null);
  }

  function markUsed(sub: Subscription) {
    updateSubscription(sub.id, { lastUsedDaysAgo: 0 });
    toast.success(`Marked ${sub.name} as used today`);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteSubscription(deleteTarget.id);
    toast.success("Subscription deleted");
    setDeleteTarget(null);
  }

  const flagIcon = { duplicate: Repeat, unused: Clock, price: TrendingUp };

  return (
    <div>
      <PageHeader
        title="Subscriptions"
        description="Every recurring charge, its next billing date and what the guardian thinks you can stop paying for."
        actions={<Button size="sm" onClick={openAdd}><Plus /> Add subscription</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {[
          { label: "Monthly cost", value: <Money value={stats.monthly} currency={currency} />, sub: `${stats.count} active` },
          { label: "Yearly commitment", value: <Money value={stats.yearly} currency={currency} />, sub: "At today's run-rate" },
          { label: "Need review", value: <span className="tabular">{flaggedCount}</span>, sub: "Duplicates, unused, price jumps" },
          { label: "Possible savings", value: <Money value={potential} currency={currency} />, sub: "Per year if you act" },
        ].map((stat) => (
          <Card key={stat.label} className="p-3.5 sm:p-4">
            <p className="text-[11px] font-medium text-muted-foreground sm:text-xs">{stat.label}</p>
            <p className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">{stat.value}</p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">{stat.sub}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5">
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary"><Sparkles className="h-3.5 w-3.5" /></span>
              <CardTitle>Guardian flags</CardTitle>
            </div>
            <Badge variant={flagRows.length ? "warning" : "success"}>{flagRows.length ? `${flagRows.length} flag${flagRows.length === 1 ? "" : "s"}` : "All clear"}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {flagRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-8 text-center">
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
                <p className="mt-2 text-[12.5px] font-medium">Nothing looks wasteful</p>
                <p className="max-w-[240px] text-[11px] text-muted-foreground">No duplicates, long-unused plans or price increases in your active subscriptions.</p>
              </div>
            ) : (
              flagRows.map((row) => {
                const Icon = flagIcon[row.kind];
                return (
                  <div key={row.id} className="rounded-xl border border-border/70 p-3">
                    <div className="flex items-start gap-2.5">
                      <span className={cn(
                        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                        row.kind === "price" ? "bg-danger-soft text-danger" : row.kind === "unused" ? "bg-muted text-muted-foreground" : "bg-warning-soft text-warning",
                      )}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-semibold">{row.title}</p>
                        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{row.body}</p>
                        {row.amount ? <p className="mt-1 text-[11px] font-semibold tabular text-foreground">{formatMoney(row.amount, currency)}/yr at stake</p> : null}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => row.sub && openDraft(row.sub)}><Mail /> Draft cancellation</Button>
                          {row.canKeep && row.sub && <Button size="sm" variant="ghost" onClick={() => markUsed(row.sub!)}>Still using it</Button>}
                          {row.kind === "price" && row.sub && <Button size="sm" variant="ghost" onClick={() => openEdit(row.sub!)}><Pencil /> Review price</Button>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Active subscriptions</CardTitle>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">Sorted by next billing date</p>
            </div>
          </CardHeader>
          <CardContent>
            {active.length === 0 ? (
              <EmptyState
                icon={<Repeat />}
                title="No active subscriptions"
                description="Add Netflix, your gym pass or that design tool — the guardian will track renewals and spot waste."
                action={<Button size="sm" onClick={openAdd}><Plus /> Add subscription</Button>}
                className="py-8"
              />
            ) : (
              <div className="space-y-2">
                {active.map((sub) => {
                  const flags = flagsFor(sub, data.subscriptions, currency);
                  const days = relativeDue(sub.nextBillingDate);
                  const urgent = daysUntil(sub.nextBillingDate) <= 3;
                  return (
                    <div key={sub.id} className="flex flex-col gap-3 rounded-2xl border border-border/70 p-3.5 transition-colors hover:border-primary/25 sm:flex-row sm:items-center">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                        <CategoryIcon name={SUB_ICONS[sub.category] ?? "repeat"} className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-[13px] font-semibold">{sub.name}</p>
                          {flags.map((flag) => <Badge key={flag.kind} variant={FLAG_BADGE[flag.kind]}>{flag.label}</Badge>)}
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{sub.category} · billed {sub.cycle}</p>
                        <p className={cn("mt-1 flex items-center gap-1 text-[11px]", urgent ? "text-warning" : "text-muted-foreground")}>
                          <CalendarClock className="h-3 w-3" /> Next on {fmtDate(sub.nextBillingDate, "d MMM yyyy")} · {days}
                        </p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="tabular text-[15px] font-semibold">{formatMoney(sub.cost, currency)}</p>
                        <p className="text-[10.5px] text-muted-foreground">
                          /{sub.cycle === "monthly" ? "month" : "year"}
                          {sub.cycle === "yearly" ? ` · ${formatMoney(Math.round(sub.cost / 12), currency)}/mo` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-0.5 sm:ml-1">
                        <Button variant="ghost" size="icon-sm" aria-label={`Draft cancellation for ${sub.name}`} onClick={() => openDraft(sub)}><Mail className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${sub.name}`} onClick={() => openEdit(sub)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${sub.name}`} onClick={() => setDeleteTarget(sub)}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {cancelled.length > 0 && (
        <Card className="mt-4">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Cancelled</CardTitle>
            <Badge variant="secondary">{cancelled.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {cancelled.map((sub) => (
              <div key={sub.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <CategoryIcon name={SUB_ICONS[sub.category] ?? "repeat"} className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium">{sub.name}</p>
                  <p className="text-[10.5px] text-muted-foreground">Was {formatMoney(sub.cost, currency)}/{sub.cycle === "monthly" ? "mo" : "yr"}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { updateSubscription(sub.id, { status: "active" }); toast.success(`${sub.name} restored`); }}><RotateCcw /> Restore</Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${sub.name}`} onClick={() => setDeleteTarget(sub)}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <InfoNote className="mt-4" icon={<Sparkles />}>
        Flags are rule-based on your recorded data: duplicates share a tracking group, unused means no logged use in 60+ days,
        and price increases compare the first and latest recorded price. Suggestions are not financial advice.
      </InfoNote>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit subscription" : "Add subscription"}</DialogTitle>
            <DialogDescription>Track the recurring charge so renewals, duplicates and price jumps surface automatically.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="sub-name">Name</Label>
              <Input id="sub-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Netflix" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sub-cost">Cost</Label>
                <MoneyInput id="sub-cost" value={cost} currency={currency} onChange={setCost} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub-cycle">Billing cycle</Label>
                <Select value={cycle} onValueChange={(v) => setCycle(v as typeof cycle)}>
                  <SelectTrigger id="sub-cycle" aria-label="Billing cycle"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sub-date">Next billing date</Label>
                <Input id="sub-date" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub-cat">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="sub-cat" aria-label="Subscription category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-usage">Days since you last used it</Label>
              <Input id="sub-usage" type="number" min={0} inputMode="numeric" value={usage} onChange={(e) => setUsage(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Used today? Enter 0. Over 60 days triggers an “unused” flag.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? "Save changes" : "Add subscription"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!draftFor} onOpenChange={(open) => !open && setDraftFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Draft cancellation</DialogTitle>
            <DialogDescription>
              Copy this message into {draftFor?.name}'s support chat or email. Wallet Guardian doesn't send it for you.
            </DialogDescription>
          </DialogHeader>
          <textarea
            aria-label="Draft cancellation message"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={10}
            className="w-full resize-y rounded-xl border border-input bg-card px-3.5 py-3 text-[12.5px] leading-relaxed text-foreground shadow-sm focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          />
          <DialogFooter>
            <Button variant="outline" onClick={copyDraft}><Copy /> Copy message</Button>
            <Button variant="outline" onClick={markCancelled}>Mark as cancelled</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>This removes the subscription and its price history from Wallet Guardian. It won't cancel the actual plan — use the cancellation draft first.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Keep it</Button>
            <Button variant="destructive" onClick={confirmDelete}><Trash2 /> Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
