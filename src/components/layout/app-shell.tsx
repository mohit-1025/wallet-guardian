import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeftRight, BarChart3, BellRing, CalendarClock, CreditCard, FlaskConical, LayoutDashboard,
  LogOut, Menu, Moon, Plus, ReceiptText, Repeat, Search, Settings, ShieldCheck, ShoppingBag,
  Sparkles, Sun, Target, Wallet,
} from "lucide-react";
import { formatMoney } from "@/lib/money";
import { useApp, useAppData } from "@/lib/app-context";
import { useTheme } from "@/lib/theme";
import { useIntegration } from "@/lib/integration-context";
import { useUI } from "./ui-context";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, Progress } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { TransactionDialog } from "@/components/transactions/transaction-dialog";
import { CommandPalette } from "./command-palette";
import { upcomingBills, upcomingReminders, buildInsights, safeToSpend, goalProgress } from "@/lib/finance";
import type { Currency } from "@/lib/types";
import { cn } from "@/lib/utils";

type LucideNavIcon = typeof LayoutDashboard;
interface ShellNavItem { to: string; label: string; icon: LucideNavIcon; end?: boolean }

const NAV: { label: string; items: ShellNavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { to: "/app", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/app/transactions", label: "Transactions", icon: ArrowLeftRight },
      { to: "/app/budget", label: "Smart budget", icon: Wallet },
      { to: "/app/goals", label: "Savings goals", icon: Target },
      { to: "/app/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Money flows",
    items: [
      { to: "/app/subscriptions", label: "Subscriptions", icon: Repeat },
      { to: "/app/bills", label: "Bills & tickets", icon: ReceiptText },
      { to: "/app/reminders", label: "Reminders", icon: BellRing },
      { to: "/app/autopay", label: "Autopay", icon: CalendarClock },
    ],
  },
  {
    label: "Guardian",
    items: [
      { to: "/app/guardian", label: "AI Guardian", icon: Sparkles },
      { to: "/app/shopper", label: "Smart Shopper", icon: ShoppingBag },
      { to: "/app/wallet", label: "Wallet & PayPal", icon: CreditCard },
    ],
  },
];

const MOBILE_TABS: ShellNavItem[] = [
  { to: "/app", label: "Home", icon: LayoutDashboard, end: true },
  { to: "/app/transactions", label: "Activity", icon: ArrowLeftRight },
  { to: "/app/budget", label: "Budget", icon: Wallet },
  { to: "/app/guardian", label: "Guardian", icon: Sparkles },
];

export function AppShell() {
  const data = useAppData();
  const { session, signOut, setProfile, resetDemo } = useApp();
  const { resolved, toggle } = useTheme();
  const { status } = useIntegration();
  const { quickAddOpen, quickAddType, closeQuickAdd, openQuickAdd, paletteOpen, setPaletteOpen } = useUI();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const currency = data.profile.currency;
  const safe = safeToSpend(data);
  const insights = buildInsights(data, currency);
  const bills = upcomingBills(data, 10);
  const reminders = upcomingReminders(data).filter((r) => r.dueDate <= new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10));
  const nextGoal = [...data.goals].sort((a, b) => goalProgress(b).onTrack === goalProgress(a).onTrack ? 0 : goalProgress(a).onTrack ? 1 : -1)[0];
  const notifCount = bills.length + reminders.length + insights.filter((i) => i.severity === "critical").length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  useEffect(() => {
    setMoreOpen(false);
    setNotifOpen(false);
  }, [location.pathname]);

  const pageTitle =
    NAV.flatMap((g) => g.items).find((i) => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)))?.label ??
    (location.pathname.includes("settings") ? "Settings" : "Wallet Guardian");

  return (
    <div className="min-h-dvh bg-background">
      <a href="#app-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm">
        Skip to content
      </a>

      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-border/70 bg-card/60 backdrop-blur-xl lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link to="/app" aria-label="Wallet Guardian dashboard">
            <Logo />
          </Link>
        </div>
        <nav className="no-scrollbar flex-1 overflow-y-auto px-3 pb-4" aria-label="Primary">
          {NAV.map((group) => (
            <div key={group.label} className="mb-5">
              <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        "group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-all",
                        isActive
                          ? "bg-primary-soft text-accent-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.08)]"
                          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={cn("h-[17px] w-[17px] shrink-0", isActive ? "text-primary" : "text-muted-foreground/80")} />
                        <span className="flex-1">{item.label}</span>
                        {item.to === "/app/guardian" && insights.length > 0 && (
                          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">{insights.length}</span>
                        )}
                        {item.to === "/app/bills" && bills.length > 0 && (
                          <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-label={`${bills.length} upcoming`} />
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-border/70 p-3">
          <div className="rounded-xl border border-border/70 bg-muted/40 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Safe to spend</span>
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            </div>
            <p className="mt-1 text-lg font-semibold tabular">{formatMoney(safe.daily, currency)}<span className="text-[11px] font-normal text-muted-foreground"> / day</span></p>
            <div className="mt-2 flex items-center justify-between text-[10.5px] text-muted-foreground">
              <span>{safe.daysLeft} days left</span>
              {nextGoal && <span className="truncate pl-2">{nextGoal.name}</span>}
            </div>
            <Progress value={nextGoal ? goalProgress(nextGoal).progress : 0} className="mt-2 h-1" indicatorClassName="bg-emerald-500" />
          </div>
          <button
            type="button"
            onClick={() => navigate("/app/wallet")}
            className="mt-2 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-muted/70"
          >
            <span className={cn("flex h-6 w-6 items-center justify-center rounded-lg", status.configured || session?.env === "live" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300")}>
              {session?.env === "live" ? <ShieldCheck className="h-3 w-3" /> : <FlaskConical className="h-3 w-3" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold">
                {session?.env === "live" ? "PayPal live" : status.configured ? "PayPal sandbox" : "Simulated PayPal"}
              </span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {session?.env === "live" ? "Real payments, approved each time" : "No real money moves"}
              </span>
            </span>
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-xl">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <Link to="/app" className="lg:hidden" aria-label="Wallet Guardian dashboard">
              <Logo compact />
            </Link>
            <h2 className="hidden text-[13px] font-semibold text-foreground lg:block">{pageTitle}</h2>

            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="ml-auto flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-[12px] text-muted-foreground shadow-sm transition-colors hover:border-primary/30 hover:text-foreground lg:ml-4 lg:w-[260px]"
              aria-label="Search or jump to"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden flex-1 text-left sm:block">Search or jump to…</span>
              <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[9.5px] font-semibold sm:block">⌘K</kbd>
            </button>

            <div className="flex items-center gap-1 sm:gap-1.5">
              <Select value={currency} onValueChange={(v) => setProfile({ currency: v as Currency })}>
                <SelectTrigger className="h-9 w-[74px] border-border text-[11.5px] font-semibold" aria-label="Display currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INR">INR ₹</SelectItem>
                  <SelectItem value="USD">USD $</SelectItem>
                  <SelectItem value="EUR">EUR €</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" onClick={toggle} aria-label={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"} className="hidden sm:inline-flex">
                {resolved === "dark" ? <Sun /> : <Moon />}
              </Button>

              <Popover open={notifOpen} onOpenChange={setNotifOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${notifCount ? `, ${notifCount} items` : ""}`}>
                    <BellRing />
                    {notifCount > 0 && <span className="absolute right-2 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[8.5px] font-bold text-danger-foreground">{notifCount}</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(92vw,340px)] p-0">
                  <div className="border-b border-border/70 px-4 py-3">
                    <p className="text-[13px] font-semibold">What needs attention</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Bills, reminders and critical insights</p>
                  </div>
                  <div className="max-h-[340px] overflow-y-auto">
                    {notifCount === 0 ? (
                      <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">All clear. Nothing urgent in the next 10 days.</p>
                    ) : (
                      <div className="divide-y divide-border/60">
                        {bills.slice(0, 3).map((b) => (
                          <Link key={b.id} to="/app/bills" onClick={() => setNotifOpen(false)} className="flex items-start gap-2.5 px-4 py-3 hover:bg-muted/50">
                            <ReceiptText className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12px] font-medium">{b.title}</p>
                              <p className="text-[11px] text-muted-foreground">{formatMoney(b.amount, currency)} · {b.derivedStatus === "overdue" ? "overdue" : `due ${b.dueDate}`}</p>
                            </div>
                          </Link>
                        ))}
                        {reminders.slice(0, 2).map((r) => (
                          <Link key={r.id} to="/app/reminders" onClick={() => setNotifOpen(false)} className="flex items-start gap-2.5 px-4 py-3 hover:bg-muted/50">
                            <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12px] font-medium">{r.direction === "owe" ? `You owe ${r.person}` : `${r.person} owes you`}</p>
                              <p className="text-[11px] text-muted-foreground">{formatMoney(r.amount, currency)} · {r.dueDate}</p>
                            </div>
                          </Link>
                        ))}
                        {insights.filter((i) => i.severity === "critical").slice(0, 2).map((i) => (
                          <Link key={i.id} to="/app/guardian" onClick={() => setNotifOpen(false)} className="flex items-start gap-2.5 px-4 py-3 hover:bg-muted/50">
                            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12px] font-medium">{i.title}</p>
                              <p className="line-clamp-2 text-[11px] text-muted-foreground">{i.body}</p>
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="border-t border-border/70 p-2">
                    <Button variant="ghost" className="w-full justify-center text-[12px]" asChild onClick={() => setNotifOpen(false)}>
                      <Link to="/app/guardian">Open Guardian feed</Link>
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="ml-0.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
                    <Avatar name={data.profile.name} className="h-8 w-8" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel>
                    <span className="block truncate text-[12.5px] font-semibold text-foreground">{data.profile.name}</span>
                    <span className="mt-0.5 block truncate text-[10.5px] font-normal normal-case tracking-normal text-muted-foreground">{data.profile.email}</span>
                    {data.profile.demo && <Badge variant="default" className="mt-1.5">Demo guest</Badge>}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate("/app/settings")}><Settings /> Settings</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate("/app/wallet")}><CreditCard /> Wallet & PayPal</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    destructive
                    onSelect={() => {
                      signOut();
                      navigate("/");
                    }}
                  >
                    <LogOut /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button size="sm" className="hidden gap-1.5 sm:inline-flex" onClick={() => openQuickAdd("expense")}>
                <Plus /> Add
              </Button>
            </div>
          </div>

          {/* Payment environment banner */}
          {session?.env === "live" ? (
            <div className="flex items-center gap-2 border-t border-warning/30 bg-warning-soft px-4 py-1.5 text-[10.5px] text-warning sm:px-6 lg:px-8">
              <ShieldCheck className="h-3 w-3 shrink-0" />
              <span className="font-semibold">Live PayPal</span>
              <span className="hidden opacity-80 sm:inline">— real money moves, but only after you approve each order on PayPal.</span>
              <span className="ml-auto hidden items-center gap-1 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Signed in as {session.email}
              </span>
              <Link to="/app/wallet" className="ml-auto font-semibold underline underline-offset-2 sm:ml-3">
                Details
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-2 border-t border-indigo-100 bg-indigo-50/70 px-4 py-1.5 text-[10.5px] text-indigo-800 dark:border-indigo-400/10 dark:bg-indigo-500/10 dark:text-indigo-200 sm:px-6 lg:px-8">
              <FlaskConical className="h-3 w-3 shrink-0" />
              <span className="font-semibold">Sandbox mode</span>
              <span className="hidden text-indigo-700/80 dark:text-indigo-200/70 sm:inline">— no real money moves.</span>
              <span className="ml-auto hidden items-center gap-1 sm:flex">
                {status.configured ? (
                  <><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> PayPal sandbox keys connected</>
                ) : (
                  <><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Simulation — keys not configured</>
                )}
              </span>
              <Link to="/app/wallet" className="ml-auto font-semibold underline decoration-indigo-400/50 underline-offset-2 hover:decoration-indigo-500 sm:ml-3">
                Details
              </Link>
            </div>
          )}
        </header>

        <main id="app-main" className="mx-auto w-full max-w-[1360px] px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-7">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Mobile navigation">
        <div className="grid h-16 grid-cols-5">
          {MOBILE_TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn("flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors", isActive ? "text-primary" : "text-muted-foreground")
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn("flex h-7 w-10 items-center justify-center rounded-lg transition-colors", isActive && "bg-primary-soft")}>
                    <tab.icon className="h-[18px] w-[18px]" />
                  </span>
                  {tab.label}
                </>
              )}
            </NavLink>
          ))}
          <button type="button" onClick={() => setMoreOpen(true)} className="flex flex-col items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground">
            <span className="flex h-7 w-10 items-center justify-center rounded-lg"><Menu className="h-[18px] w-[18px]" /></span>
            More
          </button>
        </div>
      </nav>
      <button
        type="button"
        onClick={() => openQuickAdd("expense")}
        className="fixed bottom-[84px] right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-glow transition-transform active:scale-95 lg:hidden"
        aria-label="Quick add transaction"
      >
        <Plus className="h-5 w-5" />
      </button>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="sm:!w-[min(94vw,420px)]">
          <DialogHeader>
            <DialogTitle>More</DialogTitle>
            <DialogDescription>All of Wallet Guardian, plus account settings.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            {NAV.flatMap((g) => g.items).map((item) => (
              <button
                key={item.to}
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  navigate(item.to);
                }}
                className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-muted/20 px-2 py-3 text-[11px] font-medium transition-colors hover:border-primary/30 hover:bg-muted/50"
              >
                <item.icon className="h-4 w-4 text-primary" />
                <span className="text-center leading-tight">{item.label}</span>
              </button>
            ))}
            <button type="button" onClick={() => { setMoreOpen(false); navigate("/app/settings"); }} className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-muted/20 px-2 py-3 text-[11px] font-medium">
              <Settings className="h-4 w-4 text-primary" /> Settings
            </button>
            <button type="button" onClick={toggle} className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-muted/20 px-2 py-3 text-[11px] font-medium">
              {resolved === "dark" ? <Sun className="h-4 w-4 text-primary" /> : <Moon className="h-4 w-4 text-primary" />} {resolved === "dark" ? "Light" : "Dark"} mode
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2.5">
            <span className="text-[11.5px] text-muted-foreground">Display currency</span>
            <Select value={currency} onValueChange={(v) => setProfile({ currency: v as Currency })}>
              <SelectTrigger className="h-8 w-[92px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="INR">INR ₹</SelectItem>
                <SelectItem value="USD">USD $</SelectItem>
                <SelectItem value="EUR">EUR €</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {data.profile.demo && (
            <Button variant="outline" className="mt-2 w-full" onClick={() => { resetDemo(); setMoreOpen(false); }}>
              Reset demo data
            </Button>
          )}
          <Button variant="ghost" className="mt-1 w-full" onClick={() => { signOut(); navigate("/"); }}>
            <LogOut /> Sign out
          </Button>
        </DialogContent>
      </Dialog>

      <TransactionDialog open={quickAddOpen} onOpenChange={(o) => (o ? openQuickAdd(quickAddType) : closeQuickAdd())} defaultType={quickAddType} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
