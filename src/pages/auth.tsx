import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Lock, Mail, Moon, ShieldCheck, Sparkles, Sun, User } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/app-context";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { useTheme } from "@/lib/theme";

type Mode = "signin" | "register";

export default function AuthPage() {
  const { signInAccount, createAccount, signInGuest, authNotice, clearAuthNotice } = useApp();
  const navigate = useNavigate();
  const { resolved, toggle } = useTheme();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"submit" | "demo" | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const error = localError || authNotice;
  const registering = mode === "register";

  function switchMode(next: Mode) {
    setMode(next);
    setLocalError(null);
    clearAuthNotice();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    clearAuthNotice();

    if (registering && name.trim().length < 2) {
      setLocalError("Enter your name (at least 2 characters).");
      return;
    }
    if (!email.trim()) {
      setLocalError("Enter your email address.");
      return;
    }
    if (password.length < 8) {
      setLocalError("Use a password with at least 8 characters.");
      return;
    }

    setBusy("submit");
    try {
      if (registering) {
        await createAccount(name.trim(), email.trim(), password);
        toast.success("Account created");
      } else {
        await signInAccount(email.trim(), password);
        toast.success("Welcome back");
      }
      navigate("/app");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function demo() {
    setBusy("demo");
    setLocalError(null);
    clearAuthNotice();
    try {
      await signInGuest();
      toast.success("Demo loaded", { description: "You're signed in as Aarav, with three months of data." });
      navigate("/app");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not start the demo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#171a3a] p-10 text-white lg:flex xl:p-14">
        <div className="pointer-events-none absolute -left-20 top-1/4 h-80 w-80 rounded-full bg-indigo-500/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-0 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="relative">
          <Link to="/" aria-label="Back to Wallet Guardian">
            <span className="inline-flex items-center gap-2.5">
              <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <span className="flex flex-col leading-none">
                <span className="text-[15px] font-bold">Wallet Guardian</span>
                <span className="mt-1 text-[10px] uppercase tracking-[0.16em] text-indigo-200/70">Calm money</span>
              </span>
            </span>
          </Link>
        </div>
        <div className="relative max-w-md">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10.5px] font-semibold text-indigo-100 ring-1 ring-white/10">
            <Sparkles className="h-3 w-3" /> A calmer money habit starts here
          </span>
          <h2 className="mt-5 text-balance text-[2.3rem] font-semibold leading-[1.15] tracking-tight">
            One number to know what you can safely spend today.
          </h2>
          <p className="mt-4 text-[13.5px] leading-relaxed text-indigo-100/75">
            Income, bills, subscriptions, goals and a guardian that answers from your real records — all in one quiet dashboard.
          </p>
          <div className="mt-8 space-y-3">
            {[
              "Adaptive budget that respects rent and EMIs",
              "Insights with a plain-language reason",
              "Email and password — salted and hashed on the server",
            ].map((line) => (
              <div key={line} className="flex items-center gap-2.5 text-[13px] text-indigo-50/90">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300">
                  <ShieldCheck className="h-3 w-3" />
                </span>
                {line}
              </div>
            ))}
          </div>
        </div>
        <div className="relative flex items-center gap-2 text-[11px] text-indigo-200/60">
          <ShieldCheck className="h-3.5 w-3.5" />
          Your budget ledger stays in this browser.
        </div>
      </div>

      <div className="relative flex flex-col">
        <div className="flex items-center justify-between p-5 lg:justify-end">
          <Link to="/" className="lg:hidden" aria-label="Wallet Guardian home">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
              {resolved === "dark" ? <Sun /> : <Moon />}
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/"><ArrowLeft /> Home</Link>
            </Button>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center px-5 pb-12">
          <h1 className="text-2xl font-semibold tracking-tight">
            {registering ? "Create your account" : "Sign in to Wallet Guardian"}
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            {registering
              ? "Use your email and a password you'll remember. The password is hashed on the server and never stored in plain text."
              : "Use the email and password you signed up with."}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/60 p-1">
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className={
                mode === "signin"
                  ? "rounded-lg bg-card px-3 py-1.5 text-[12.5px] font-semibold text-foreground shadow-sm"
                  : "rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              }
              aria-pressed={mode === "signin"}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode("register")}
              className={
                mode === "register"
                  ? "rounded-lg bg-card px-3 py-1.5 text-[12.5px] font-semibold text-foreground shadow-sm"
                  : "rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              }
              aria-pressed={mode === "register"}
            >
              Create account
            </button>
          </div>

          {error && (
            <div role="alert" className="mt-4 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-[12.5px] font-medium text-danger">
              {error}
            </div>
          )}

          <form className="mt-4 space-y-3.5" onSubmit={submit} noValidate>
            {registering && (
              <div className="space-y-1.5">
                <Label htmlFor="auth-name">Name</Label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="auth-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="pl-9"
                    placeholder="Aarav Sharma"
                    autoComplete="name"
                    disabled={busy !== null}
                  />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="auth-email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  placeholder="you@example.com"
                  autoComplete="email"
                  disabled={busy !== null}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auth-password">Password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                  placeholder={registering ? "At least 8 characters" : "Your password"}
                  autoComplete={registering ? "new-password" : "current-password"}
                  disabled={busy !== null}
                />
              </div>
            </div>

            <Button type="submit" size="lg" className="w-full" disabled={busy !== null}>
              {busy === "submit" ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
              {busy === "submit"
                ? registering ? "Creating account…" : "Signing in…"
                : registering ? "Create account" : "Sign in"}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" size="lg" className="w-full" onClick={demo} disabled={busy !== null}>
            {busy === "demo" ? <Loader2 className="animate-spin" /> : <Sparkles className="text-primary" />}
            {busy === "demo" ? "Loading demo…" : "Explore the demo instead"}
          </Button>
          <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
            Signs you in as Aarav with three months of sample data. Everything stays local to this browser.
          </p>

          <p className="mt-7 text-center text-[12px] leading-relaxed text-muted-foreground">
            Accounts are created on the Wallet Guardian server; your budget ledger stays in this browser. Read how the{" "}
            <Link to="/" className="font-semibold text-primary hover:underline">
              guardian works
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
