import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, FlaskConical, Loader2, Moon, ShieldCheck, Sparkles, Sun } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/app-context";
import { useIntegration } from "@/lib/integration-context";
import { startPayPalLogin } from "@/lib/auth";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";

export default function AuthPage() {
  const { signInGuest, authNotice, clearAuthNotice } = useApp();
  const { status } = useIntegration();
  const navigate = useNavigate();
  const { resolved, toggle } = useTheme();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState<"demo" | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const error = params.get("error") || authNotice || localError;
  const loginReady = status.loginConfigured && status.loginMode === "live";

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
              "Sign in with PayPal — no password stored here",
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
          <FlaskConical className="h-3.5 w-3.5" />
          Your budget ledger stays in this browser. PayPal confirms who you are — Wallet Guardian never sees your password.
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
          <h1 className="text-2xl font-semibold tracking-tight">Sign in with PayPal</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            Your PayPal account is the account. Real accounts use live PayPal — every payment needs your approval on PayPal.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {loginReady && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-soft px-2.5 py-1 text-[10.5px] font-semibold text-warning">
                <ShieldCheck className="h-3 w-3" /> Live PayPal — real money moves
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[10.5px] font-semibold text-muted-foreground">
              <FlaskConical className="h-3 w-3" /> Demo is sandbox only
            </span>
          </div>

          {error && (
            <div role="alert" className="mt-5 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-[12.5px] font-medium text-danger">
              {error}
            </div>
          )}

          <Button
            size="lg"
            className="mt-5 w-full bg-[#0070ba] text-white hover:bg-[#005ea6]"
            onClick={() => {
              setLocalError(null);
              clearAuthNotice();
              startPayPalLogin();
            }}
            disabled={!loginReady || busy !== null}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded bg-white text-[12px] font-black italic text-[#0070ba]">P</span>
            Continue with PayPal
          </Button>
          <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
            {loginReady ? (
              "You will approve the sign-in on PayPal, then come straight back here. Real payments use your live PayPal account and require your approval for each order."
            ) : (
              <>
                PayPal isn't connected on this server yet.{" "}
                <Link to="/setup" className="font-semibold text-primary hover:underline">
                  Connect your PayPal app
                </Link>{" "}
                to enable live sign-in — or explore the demo below.
              </>
            )}
          </p>

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
            Signs you in as Aarav with three months of sample data. The demo stays in the PayPal sandbox and is clearly labelled — it never moves real money.
          </p>

          <p className="mt-7 text-center text-[12px] leading-relaxed text-muted-foreground">
            No account is created on this device beyond your local budget ledger. Read how the{" "}
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
