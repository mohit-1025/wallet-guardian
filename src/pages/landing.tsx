import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight, ArrowUpRight, BarChart3, BellRing, Check, ChevronRight, CreditCard, FlaskConical,
  LockKeyhole, PieChart, ShieldCheck, Sparkles, TrendingUp, Wallet, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/app-context";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { Moon, Sun } from "lucide-react";

function HeroPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[520px]">
      <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-tr from-indigo-500/20 via-transparent to-emerald-400/20 blur-2xl" />
      <div className="relative overflow-hidden rounded-[1.75rem] border border-white/60 bg-white/90 p-4 shadow-[0_30px_80px_-30px_rgba(30,27,75,0.45)] backdrop-blur dark:border-white/10 dark:bg-[#121528]/95 sm:p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Good morning, Aarav</p>
            <p className="mt-1 text-[15px] font-semibold text-slate-800 dark:text-white">Your month at a glance</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            <ShieldCheck className="h-3 w-3" /> Protected
          </span>
        </div>

        <div className="mt-4 grid grid-cols-5 gap-3">
          <div className="col-span-3 rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-900 p-4 text-white">
            <p className="text-[10px] font-medium uppercase tracking-wider text-indigo-200">Net this month</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular">₹36,240</p>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-indigo-100">
              <span className="inline-flex items-center gap-0.5 rounded-full bg-white/15 px-1.5 py-0.5">
                <TrendingUp className="h-2.5 w-2.5" /> +12.4%
              </span>
              vs last month
            </div>
            <div className="mt-3 h-8 w-full">
              <svg viewBox="0 0 120 32" className="h-full w-full" preserveAspectRatio="none" aria-hidden>
                <defs>
                  <linearGradient id="hero-spark" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(167,243,208,0.55)" />
                    <stop offset="100%" stopColor="rgba(167,243,208,0)" />
                  </linearGradient>
                </defs>
                <path d="M0 26 C12 24 18 16 28 18 C38 20 44 8 56 12 C68 16 74 6 86 9 C98 12 106 4 120 5 L120 32 L0 32 Z" fill="url(#hero-spark)" />
                <path d="M0 26 C12 24 18 16 28 18 C38 20 44 8 56 12 C68 16 74 6 86 9 C98 12 106 4 120 5" fill="none" stroke="#6ee7b7" strokeWidth="1.6" />
              </svg>
            </div>
          </div>
          <div className="col-span-2 flex flex-col items-center justify-center rounded-2xl border border-slate-100 bg-slate-50/80 p-3 dark:border-white/5 dark:bg-white/5">
            <div className="relative h-20 w-20">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(148,163,184,0.22)" strokeWidth="9" />
                <circle cx="50" cy="50" r="42" fill="none" stroke="#4f46e5" strokeWidth="9" strokeLinecap="round" strokeDasharray="264" strokeDashoffset="58" />
                <circle cx="50" cy="50" r="42" fill="none" stroke="#10b981" strokeWidth="9" strokeLinecap="round" strokeDasharray="264" strokeDashoffset="238" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold text-slate-800 dark:text-white">86</span>
                <span className="text-[8px] font-medium uppercase tracking-wider text-slate-400">health</span>
              </div>
            </div>
            <p className="mt-1 text-[10px] font-semibold text-slate-600 dark:text-slate-300">Healthy</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-100 bg-white p-3 dark:border-white/5 dark:bg-white/5">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Safe to spend today</p>
            <p className="mt-1 text-lg font-semibold text-slate-800 tabular dark:text-white">₹650</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
              <div className="h-full w-[62%] rounded-full bg-emerald-500" />
            </div>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-3 dark:border-white/5 dark:bg-white/5">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Japan trip</p>
            <p className="mt-1 text-lg font-semibold text-slate-800 tabular dark:text-white">19%</p>
            <div className="mt-2 flex items-center gap-1 text-[9px] font-medium text-amber-600 dark:text-amber-300">
              <BellRing className="h-2.5 w-2.5" /> add ₹1,200/mo
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2.5 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3 dark:border-indigo-400/20 dark:bg-indigo-500/10">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold text-indigo-950 dark:text-indigo-100">Croma charge was 9.4× your average</p>
            <p className="truncate text-[9.5px] text-indigo-700/80 dark:text-indigo-200/70">Review it or move ₹4,200 from Wants.</p>
          </div>
          <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-indigo-400" />
        </div>
      </div>

      <div className="absolute -left-3 bottom-10 hidden rotate-[-3deg] rounded-2xl border border-white/70 bg-white/95 px-3 py-2 shadow-xl backdrop-blur dark:border-white/10 dark:bg-[#171b33] sm:block">
        <p className="text-[9px] font-medium text-slate-400">Netflix</p>
        <p className="text-[11px] font-semibold text-slate-800 dark:text-white">price ↑ ₹50/mo</p>
        <p className="text-[9px] text-rose-500">Draft cancellation?</p>
      </div>
      <div className="absolute -right-2 top-16 hidden rotate-[3deg] items-center gap-1.5 rounded-full border border-white/70 bg-white/95 px-3 py-1.5 shadow-xl backdrop-blur dark:border-white/10 dark:bg-[#171b33] sm:flex">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300">
          <Check className="h-2.5 w-2.5" />
        </span>
        <span className="text-[10px] font-semibold text-slate-700 dark:text-slate-200">Rent paid · autopay</span>
      </div>
    </div>
  );
}

const features = [
  {
    icon: PieChart,
    eyebrow: "One calm place",
    title: "Your whole money life, in one view",
    body: "Salary, spending, bills, subscriptions and goals together — with a single “safe to spend today” number you can trust.",
    points: ["Live net balance & budget health", "Upcoming bills and reminders", "Light and dark, made to feel quiet"],
  },
  {
    icon: Wallet,
    eyebrow: "Adaptive budgeting",
    title: "A budget that bends with real life",
    body: "Set your savings goals first and the plan funds them, then sizes rent, EMIs, wants and savings to what you actually earn — no fixed 50/30/20 rule.",
    points: ["Envelopes for needs, wants, savings", "80% and 100% nudges", "Roll unspent money into goals"],
  },
  {
    icon: Sparkles,
    eyebrow: "Guardian AI",
    title: "Answers grounded in your numbers",
    body: "Ask “can I afford ₹15,000?” and get a real answer from your records — with the maths shown, never invented.",
    points: ["Overspend & unusual-charge alerts", "Purchase advisor with trade-offs", "Patient Checkout cooling-off"],
  },
];

const float = { animation: "fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both" };

export default function LandingPage() {
  const { signInGuest, session } = useApp();
  const navigate = useNavigate();
  const { resolved, toggle } = useTheme();
  const [busy, setBusy] = useState(false);

  async function tryDemo() {
    if (session) {
      navigate("/app");
      return;
    }
    setBusy(true);
    try {
      await signInGuest();
      toast.success("Demo loaded", { description: "Three months of realistic data, no sign-up needed." });
      navigate("/app");
    } catch (err) {
      toast.error("Could not start the demo", { description: err instanceof Error ? err.message : "Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm">
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/" aria-label="Wallet Guardian home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-7 text-[13px] font-medium text-muted-foreground md:flex" aria-label="Main">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#guardian" className="transition-colors hover:text-foreground">Guardian AI</a>
            <a href="#sandbox" className="transition-colors hover:text-foreground">Sandbox</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
              {resolved === "dark" ? <Sun /> : <Moon />}
            </Button>
            <Button variant="ghost" asChild className="hidden sm:inline-flex">
              <Link to="/login">Sign in</Link>
            </Button>
            <Button onClick={tryDemo} disabled={busy} className="gap-2">
              {busy ? "Loading demo…" : "Try demo"}
              {!busy && <ArrowRight />}
            </Button>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="relative">
          <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute left-1/2 top-[-18rem] h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-indigo-500/10 blur-3xl dark:bg-indigo-500/15" />
            <div className="absolute -right-40 top-40 h-[26rem] w-[26rem] rounded-full bg-emerald-400/10 blur-3xl" />
            <div className="absolute inset-0 bg-[radial-gradient(hsl(var(--border))_0.7px,transparent_0.7px)] [background-size:26px_26px] opacity-40 mask-fade-b" />
          </div>

          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-12 sm:pt-20 lg:grid-cols-[1.02fr_0.98fr] lg:gap-8 lg:pb-24">
            <div style={float}>
              <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200/70 bg-indigo-50/80 px-3 py-1.5 text-[11px] font-semibold text-indigo-700 dark:border-indigo-400/20 dark:bg-indigo-500/10 dark:text-indigo-200">
                <Sparkles className="h-3.5 w-3.5" />
                AI money guardian for real life
              </span>
              <h1 className="mt-5 text-balance text-[2.6rem] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[3.4rem] lg:text-[3.6rem]">
                Spend with confidence.
                <span className="block bg-gradient-to-r from-indigo-600 via-indigo-500 to-emerald-500 bg-clip-text text-transparent">
                  Save without thinking.
                </span>
              </h1>
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-base">
                Wallet Guardian brings income, spending, bills and goals into one calm place — then watches your back with
                an AI that answers from your real numbers, not guesses.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Button size="lg" onClick={tryDemo} disabled={busy} className="gap-2 shadow-glow">
                  {busy ? "Loading your demo…" : "Explore the demo"}
                  {!busy && <ArrowRight />}
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link to="/login">Sign in with email</Link>
                </Button>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11.5px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-500" /> No sign-up for the demo</span>
                <span className="inline-flex items-center gap-1.5"><FlaskConical className="h-3.5 w-3.5 text-indigo-500" /> Email sign-in, sandbox payments</span>
                <span className="inline-flex items-center gap-1.5"><LockKeyhole className="h-3.5 w-3.5 text-emerald-500" /> Data stays on this device</span>
              </div>
            </div>
            <div className="lg:pl-4" style={{ ...float, animationDelay: "120ms" }}>
              <HeroPreview />
            </div>
          </div>
        </section>

        <section className="border-y border-border/60 bg-card/50">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-6 px-5 py-7 sm:grid-cols-4">
            {[
              { icon: ShieldCheck, label: "Row-level security ready", sub: "Supabase schema included" },
              { icon: Zap, label: "80% & 100% alerts", sub: "Before the overspend" },
              { icon: BarChart3, label: "3 months of insight", sub: "Seeded demo data" },
              { icon: CreditCard, label: "PayPal Orders, Invoicing, Payouts", sub: "Secrets stay server-side" },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-accent-foreground">
                  <item.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-[12px] font-semibold leading-snug">{item.label}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{item.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Built for students, freelancers & young professionals</p>
            <h2 className="mt-3 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              Less spreadsheet. More clarity about what you can actually do next.
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
              No jargon, no guilt. Just the numbers that matter, explained in plain language at the moment you need them.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="group rounded-3xl border border-border bg-card p-6 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:shadow-lift">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <f.icon className="h-5 w-5" />
                </span>
                <p className="mt-5 text-[10.5px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{f.eyebrow}</p>
                <h3 className="mt-1.5 text-[17px] font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{f.body}</p>
                <ul className="mt-5 space-y-2">
                  {f.points.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section id="guardian" className="border-y border-border/60 bg-gradient-to-b from-card/60 to-background">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 sm:py-24 lg:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Guardian AI</p>
              <h2 className="mt-3 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">The friend who’s good with money. Without the lecture.</h2>
              <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-muted-foreground">
                Every answer cites your own transactions and month. The advisor shows the maths, and Patient Checkout gives you a cooling-off period before a want becomes a purchase.
              </p>
              <div className="mt-6 space-y-3">
                {[
                  { q: "Can I afford a ₹15,000 purchase?", a: "Possible, but tight. You have ₹16,800 flexible after bills — it would pause your Japan trip by ~4 months." },
                  { q: "How much did I spend on food last month?", a: "₹3,490 across 4 transactions. Swiggy was your biggest at ₹1,150." },
                  { q: "Anything I should cancel?", a: "Adobe Express overlaps with Creative Cloud, and Cult.fit hasn't been used in 78 days. That's ₹25,188 a year." },
                ].map((row, i) => (
                  <div key={row.q} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
                    <p className="flex items-start gap-2 text-[12.5px] font-semibold">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px]">You</span>
                      {row.q}
                    </p>
                    <p className="mt-2 flex items-start gap-2 pl-7 text-[12.5px] leading-relaxed text-muted-foreground">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
                        <Sparkles className="h-2.5 w-2.5" />
                      </span>
                      {row.a}
                    </p>
                    {i === 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5 pl-7">
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9.5px] font-medium text-muted-foreground">42 transactions · November</span>
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9.5px] font-medium text-muted-foreground">Not financial advice</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="relative">
              <div className="absolute -inset-6 -z-10 rounded-full bg-gradient-to-br from-indigo-500/15 to-emerald-400/10 blur-2xl" />
              <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-lift">
                <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white"><Sparkles className="h-4 w-4" /></span>
                    <div>
                      <p className="text-[12.5px] font-semibold">Guardian insights</p>
                      <p className="text-[10.5px] text-muted-foreground">Grounded in 3 months of records</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">3 to review</span>
                </div>
                <div className="divide-y divide-border/60">
                  {[
                    { tone: "rose", title: "Health envelope is over budget", body: "₹7,500 dental charge against ₹360 allocated.", label: "Critical" },
                    { tone: "amber", title: "Unusual charge at Croma", body: "₹24,990 was 9.4× your average transaction.", label: "Warning" },
                    { tone: "emerald", title: "Two subscriptions overlap", body: "Adobe Express + Creative Cloud — ₹25,188/year.", label: "Save" },
                  ].map((row) => (
                    <div key={row.title} className="flex items-start gap-3 px-5 py-4">
                      <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${row.tone === "rose" ? "bg-rose-500" : row.tone === "amber" ? "bg-amber-500" : "bg-emerald-500"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[12.5px] font-semibold">{row.title}</p>
                          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{row.label}</span>
                        </div>
                        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{row.body}</p>
                      </div>
                      <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </div>
                  ))}
                </div>
                <div className="border-t border-border/70 bg-muted/30 px-5 py-3 text-[10.5px] text-muted-foreground">
                  AI suggestions are not financial advice.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="sandbox" className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-3xl border border-indigo-200/60 bg-gradient-to-br from-indigo-50 to-card p-7 shadow-soft dark:border-indigo-400/15 dark:from-indigo-500/10 dark:to-card sm:p-9">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-[10.5px] font-semibold text-indigo-700 dark:bg-white/10 dark:text-indigo-200">
                <FlaskConical className="h-3 w-3" /> Sandbox for every account
              </span>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight">Create an account with email. Every payment stays in the sandbox.</h2>
              <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">
                Both the demo and email accounts run Orders, Invoicing, Payouts and Patient Checkout against the PayPal sandbox — no live API, no real money. Passwords are salted and hashed on the server, and client secrets never leave it.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {["Orders", "Invoicing", "Payouts", "Authorize → Capture", "Sandbox only"].map((p) => (
                  <span key={p} className="rounded-lg border border-indigo-200/70 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-indigo-700 dark:border-indigo-400/20 dark:bg-white/5 dark:text-indigo-200">{p}</span>
                ))}
              </div>
            </div>
            <div className="flex flex-col justify-between rounded-3xl border border-border bg-card p-7 shadow-soft">
              <div>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <LockKeyhole className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-[16px] font-semibold">Private by default</h3>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  Demo data never leaves your browser. Production ships with a Postgres schema and row-level security policies so every row is yours alone.
                </p>
              </div>
              <div className="mt-6 flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2.5">
                <span className="text-[11.5px] font-medium">Client bundle secrets</span>
                <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700 dark:text-emerald-300">NONE</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-20">
          <div className="relative overflow-hidden rounded-[2rem] bg-[#1b1b4b] px-6 py-12 text-center shadow-lift sm:px-12 sm:py-16">
            <div className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-indigo-500/40 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-28 -right-16 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />
            <p className="relative text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-300">Your money, on your side</p>
            <h2 className="relative mx-auto mt-3 max-w-2xl text-balance text-2xl font-semibold text-white sm:text-4xl">
              Meet the calmest way to understand your money.
            </h2>
            <p className="relative mx-auto mt-3 max-w-lg text-[13.5px] leading-relaxed text-indigo-100/80">
              The demo opens instantly with a student-friendly storyline, three months of records and a guardian that already has opinions.
            </p>
            <div className="relative mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" onClick={tryDemo} disabled={busy} className="bg-white text-indigo-900 hover:bg-indigo-50">
                {busy ? "Loading demo…" : "Try the demo now"} <ArrowRight />
              </Button>
              <Button size="lg" variant="ghost" asChild className="text-indigo-100 hover:bg-white/10 hover:text-white">
                <Link to="/login">Sign in with email</Link>
              </Button>
            </div>
            <p className="relative mt-5 text-[10.5px] text-indigo-200/60">Demo: no real money and no card required. Not financial advice.</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
          <Logo />
          <p className="text-[11.5px] text-muted-foreground">Built with React, Tailwind, Recharts and PayPal Orders, Invoicing and Payouts APIs.</p>
          <div className="flex items-center gap-4 text-[11.5px] text-muted-foreground">
            <Link to="/login" className="hover:text-foreground">Sign in with email</Link>
            <span className="inline-flex items-center gap-1"><FlaskConical className="h-3 w-3" /> Demo sandbox</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
