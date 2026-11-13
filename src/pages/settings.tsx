import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, CheckCircle2, CreditCard, Database, Download, LogOut, Monitor, Moon, Palette,
  RefreshCw, ShieldCheck, Sun, User,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Badge, InfoNote, Spinner } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MoneyInput } from "@/components/ui/money";
import { useApp, useAppData } from "@/lib/app-context";
import { useIntegration } from "@/lib/integration-context";
import { useTheme } from "@/lib/theme";
import { todayISO } from "@/lib/dates";
import { formatAmountInput, formatMoney, parseToInr } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Currency, Profile } from "@/lib/types";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export default function SettingsPage() {
  const data = useAppData();
  const { session, setProfile, resetDemo, loadSample, signOut } = useApp();
  const { status: integration, loading: integrationLoading, refresh } = useIntegration();
  const { theme, setTheme } = useTheme();
  const currency = data.profile.currency;

  const [name, setName] = useState(data.profile.name);
  const [income, setIncome] = useState(() => formatAmountInput(data.profile.monthlyIncome, currency));
  const [savingsTarget, setSavingsTarget] = useState(() => formatAmountInput(data.profile.savingsTarget, currency));
  const [incomeType, setIncomeType] = useState<Profile["incomeType"]>(data.profile.incomeType);
  const [confirm, setConfirm] = useState<"reset" | "sample" | null>(null);

  useEffect(() => {
    setName(data.profile.name);
    setIncome(formatAmountInput(data.profile.monthlyIncome, currency));
    setSavingsTarget(formatAmountInput(data.profile.savingsTarget, currency));
    setIncomeType(data.profile.incomeType);
  }, [currency, data.profile.name, data.profile.monthlyIncome, data.profile.savingsTarget, data.profile.incomeType]);

  function saveProfile() {
    const incomeInr = parseToInr(income, currency);
    const targetInr = parseToInr(savingsTarget, currency);
    if (!name.trim()) {
      toast.error("Add a name for your profile.");
      return;
    }
    if (incomeInr <= 0) {
      toast.error("Monthly income must be above zero.");
      return;
    }
    if (targetInr >= incomeInr) {
      toast.error("Savings target should be below your monthly income.");
      return;
    }
    setProfile({ name: name.trim(), monthlyIncome: incomeInr, savingsTarget: targetInr, incomeType });
    toast.success("Profile updated", { description: "Insights and safe-to-spend now use these figures." });
  }

  function exportData() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wallet-guardian-${todayISO()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success("Export ready", { description: "Your transactions, budgets, goals and settings were downloaded as JSON." });
  }

  function runConfirmed() {
    if (confirm === "reset") {
      resetDemo();
      toast.success("Demo data reset", { description: "Seed transactions, budgets, bills and goals are back." });
    } else if (confirm === "sample") {
      loadSample();
      toast.success("Sample workspace loaded", { description: "Your profile and login are unchanged." });
    }
    setConfirm(null);
  }

  const counts = [
    { label: "Transactions", value: data.transactions.length },
    { label: "Goals", value: data.goals.length },
    { label: "Subscriptions", value: data.subscriptions.length },
    { label: "Bills", value: data.bills.length },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Your profile, how money is displayed, and the PayPal connection behind Wallet Guardian."
        eyebrow={<Badge variant="outline"><ShieldCheck /> Local-first workspace</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><User className="h-4 w-4 text-primary" />Profile & money defaults</CardTitle>
            <p className="text-[11.5px] text-muted-foreground">
              Income and savings target feed the safe-to-spend maths, insights and purchase advice.
            </p>
          </CardHeader>
          <CardContent className="space-y-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="settings-name">Name</Label>
                <Input id="settings-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="settings-email">Email</Label>
                <Input id="settings-email" value={data.profile.email} readOnly className="bg-muted/40 text-muted-foreground" />
                <p className="text-[10.5px] text-muted-foreground">
                  {session?.provider === "demo" ? "Demo account — create an email account for a private workspace." : "Email you signed up with."}
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="settings-income">Monthly income</Label>
                <MoneyInput id="settings-income" value={income} currency={currency} onChange={setIncome} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="settings-savings">Monthly savings target</Label>
                <MoneyInput id="settings-savings" value={savingsTarget} currency={currency} onChange={setSavingsTarget} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Income pattern</Label>
                <Select value={incomeType} onValueChange={(v) => setIncomeType(v as Profile["incomeType"])}>
                  <SelectTrigger aria-label="Income pattern"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed monthly salary</SelectItem>
                    <SelectItem value="irregular">Irregular / freelance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Display currency</Label>
                <Select
                  value={currency}
                  onValueChange={(v) => {
                    setProfile({ currency: v as Currency });
                    toast.info(`Showing amounts in ${v}`, { description: "Rate is indicative and display-only; records stay stored in INR." });
                  }}
                >
                  <SelectTrigger aria-label="Display currency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INR">Indian Rupee (₹)</SelectItem>
                    <SelectItem value="USD">US Dollar ($)</SelectItem>
                    <SelectItem value="EUR">Euro (€)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-[10.5px] text-muted-foreground">
                Current target: {formatMoney(data.profile.savingsTarget, currency)}/month
              </p>
              <Button onClick={saveProfile}>Save changes</Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Palette className="h-4 w-4 text-primary" />Appearance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Theme">
                {THEME_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTheme(opt.value)}
                      aria-pressed={active}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-[11.5px] font-medium transition-colors",
                        active
                          ? "border-primary/40 bg-primary-soft text-accent-foreground"
                          : "border-border text-muted-foreground hover:bg-muted/50",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">
                System follows your device setting. Motion respects your reduced-motion preference.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-primary" />PayPal connection</CardTitle>
              <Button size="icon-sm" variant="ghost" onClick={refresh} disabled={integrationLoading} aria-label="Refresh integration status">
                {integrationLoading ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
              </Button>
            </CardHeader>
            <CardContent className="space-y-2.5 text-[12px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={integration.configured ? "success" : "warning"}>
                  <CheckCircle2 />{integration.configured ? "Configured" : "Not configured"}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Environment</span>
                <span className="font-mono text-[10.5px]">api-m.sandbox.paypal.com</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Payouts</span>
                <span className="font-medium">{integration.payoutsEnabled ? "Enabled" : "Unavailable"}</span>
              </div>
              <InfoNote icon={<ShieldCheck />} className="mt-1">
                Credentials and session tokens live only in the server-side API process. The browser never receives your PayPal secret, and no request ever reaches the live PayPal API.
              </InfoNote>
              <Button variant="outline" size="sm" asChild className="w-full justify-center">
                <Link to="/app/wallet">Open Wallet & PayPal</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Database className="h-4 w-4 text-primary" />Data & privacy</CardTitle>
            <p className="text-[11.5px] text-muted-foreground">
              This build stores your workspace in this browser's local storage. Nothing is sent to a third party except the PayPal calls you trigger.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {counts.map((c) => (
                <div key={c.label} className="rounded-xl border border-border/70 bg-muted/30 px-2.5 py-2">
                  <p className="tabular text-[15px] font-semibold">{c.value}</p>
                  <p className="text-[10.5px] text-muted-foreground">{c.label}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={exportData}><Download /> Export my data</Button>
              <Button variant="outline" size="sm" onClick={() => setConfirm("sample")}>Load sample workspace</Button>
              {session?.provider === "demo" && <Button variant="outline" size="sm" onClick={() => setConfirm("reset")}>Reset demo data</Button>}
            </div>
            <p className="text-[10.5px] leading-relaxed text-muted-foreground">
              Loading the sample workspace replaces transactions, budgets, goals, bills and subscriptions. Your name, email and display currency stay as they are.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold">{data.profile.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{data.profile.email}</p>
                </div>
                {session?.provider !== "demo" && (
                  <Badge variant="success"><CheckCircle2 />Email account</Badge>
                )}
              </div>
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                {session?.provider === "demo"
                  ? "Guest demo session"
                  : "Email account"}{" "}
                · joined {new Date(data.profile.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
            {session?.provider !== "demo" && (
              <div className="space-y-1.5 rounded-xl border border-border/70 px-3 py-2.5 text-[11px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Sign-in</span>
                  <span className="font-medium">Email and password</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Payments</span>
                  <span className="text-right font-medium">PayPal</span>
                </div>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  Your password is salted and hashed on the server. PayPal handles every payment.
                </p>
              </div>
            )}
            <Button variant="destructive" size="sm" onClick={signOut}><LogOut /> Sign out</Button>
            <InfoNote icon={<AlertTriangle />}>
              Signing out ends the session on this server and keeps this workspace in the browser. Use Export first if you want a copy.
            </InfoNote>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "reset" ? "Reset demo data?" : "Load the sample workspace?"}</DialogTitle>
            <DialogDescription>
              {confirm === "reset"
                ? "Every transaction, budget, goal, bill and hold in this demo workspace will be replaced with the original seeded data. This cannot be undone."
                : "Your current transactions, budgets, goals, bills and subscriptions will be replaced with the sample dataset. Your profile and login stay the same. This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={runConfirmed}>
              {confirm === "reset" ? "Reset demo data" : "Load sample workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
