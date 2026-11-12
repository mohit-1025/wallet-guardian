import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, CheckCircle2, Copy, ExternalLink, KeyRound, Loader2, LockKeyhole, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { connectPayPalApp, getPayPalSetupStatus, type PayPalSetupStatus } from "@/lib/paypal";
import { useIntegration } from "@/lib/integration-context";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form";
import { Spinner } from "@/components/ui/misc";

export default function SetupPage() {
  const { refresh } = useIntegration();
  const navigate = useNavigate();
  const [status, setStatus] = useState<PayPalSetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPayPalSetupStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not read the setup status.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function copyRedirect() {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(status.redirectUri);
      toast.success("Redirect URI copied");
    } catch {
      toast.error("Copy failed — select the URI and copy it manually.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const id = clientId.trim();
    const secret = clientSecret.trim();
    if (id.length < 20 || secret.length < 20) {
      setError("Paste the complete Live Client ID and Secret from your PayPal REST app.");
      return;
    }
    setBusy(true);
    try {
      await connectPayPalApp({ clientId: id, clientSecret: secret });
      setClientId("");
      setClientSecret("");
      refresh();
      toast.success("PayPal connected", {
        description: "Continue with PayPal to sign in and finish onboarding.",
      });
      navigate("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect PayPal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border/60 bg-card/40">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Link to="/" aria-label="Wallet Guardian home"><Logo /></Link>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/login"><ArrowLeft /> Sign in</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:py-12">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary-soft px-2.5 py-1 text-[10.5px] font-semibold text-primary">
          <KeyRound className="h-3 w-3" /> One-time app setup
        </span>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Connect your PayPal app</h1>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
          Wallet Guardian signs people in with PayPal, so the server needs one PayPal REST app to act as the
          OAuth client. This is a one-time step for the person running the server — not something each
          visitor does.
        </p>

        {loading ? (
          <Card className="mt-6 flex items-center gap-3 p-5 text-[13px] text-muted-foreground">
            <Spinner /> Reading server setup…
          </Card>
        ) : !status ? (
          <Card className="mt-6 p-5">
            <p className="text-[12.5px] font-semibold text-danger">
              {error || "Could not read the setup status."}
            </p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              Make sure the API is running on port 8787, then reload this page.
            </p>
          </Card>
        ) : status.configured ? (
          <Card className="mt-6 p-6">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold">PayPal is connected</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  {status.source === "env"
                    ? "The server is using live credentials from its environment."
                    : "The server is using live credentials saved in its encrypted settings database."}
                  {status.clientIdHint ? ` Client ID ${status.clientIdHint}.` : ""}
                </p>
                <Button className="mt-4" asChild>
                  <Link to="/login">Continue to sign in</Link>
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1.05fr]">
            <Card className="p-5 sm:p-6">
              <p className="text-[13px] font-semibold">Before you paste anything</p>
              <ol className="mt-3 space-y-3 text-[12px] leading-relaxed text-muted-foreground">
                {[
                  <>
                    Open the{" "}
                    <a
                      href="https://developer.paypal.com/dashboard/applications/live"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                    >
                      PayPal Developer Dashboard <ExternalLink className="h-3 w-3" />
                    </a>{" "}
                    and choose <span className="font-semibold text-foreground">Apps &amp; Credentials → Live</span>.
                  </>,
                  <>
                    Create or open a REST app and enable <span className="font-semibold text-foreground">Log in with PayPal</span>.
                  </>,
                  <>Copy its Live Client ID and Secret. They identify the app, not a person.</>,
                  <>In the app's settings, add the redirect URI below exactly.</>,
                ].map((line, index) => (
                  <li key={index} className="flex gap-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10.5px] font-bold text-foreground">
                      {index + 1}
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ol>

              <div className="mt-5 rounded-xl border border-border/70 bg-muted/40 p-3.5">
                <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Redirect URI</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-foreground">{status?.redirectUri}</code>
                  <Button type="button" variant="outline" size="icon-sm" onClick={copyRedirect} aria-label="Copy redirect URI">
                    <Copy />
                  </Button>
                </div>
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-[11px] leading-relaxed text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Never enter your PayPal password here. Wallet Guardian only needs the app credentials from
                developer.paypal.com; people sign in on PayPal's own page.
              </div>
            </Card>

            <Card className="p-5 sm:p-6">
              <p className="text-[13px] font-semibold">Live app credentials</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                Saved encrypted in the server's local database. The secret is never sent back to the browser,
                never written to the bundle, and only used by server-side PayPal calls.
              </p>

              {error && (
                <div role="alert" className="mt-4 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-[12px] font-medium text-danger">
                  {error}
                </div>
              )}

              {!status.canEdit ? (
                <div className="mt-4 rounded-xl border border-border bg-muted/40 p-3.5 text-[12px] leading-relaxed text-muted-foreground">
                  For safety, this setup can only be completed from the machine running the Wallet Guardian
                  server. Open the app locally to connect PayPal.
                </div>
              ) : (
                <form className="mt-4 space-y-3.5" onSubmit={submit}>
                  <div className="space-y-1.5">
                    <Label htmlFor="paypal-client-id">Live Client ID</Label>
                    <Input
                      id="paypal-client-id"
                      value={clientId}
                      onChange={(event) => setClientId(event.target.value)}
                      placeholder="AeA1QIZ…"
                      autoComplete="off"
                      spellCheck={false}
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="paypal-client-secret">Live Secret</Label>
                      <button
                        type="button"
                        onClick={() => setShowSecret((value) => !value)}
                        className="text-[11px] font-semibold text-primary hover:underline"
                      >
                        {showSecret ? "Hide" : "Show"}
                      </button>
                    </div>
                    <Input
                      id="paypal-client-secret"
                      type={showSecret ? "text" : "password"}
                      value={clientSecret}
                      onChange={(event) => setClientSecret(event.target.value)}
                      placeholder="EL…"
                      autoComplete="new-password"
                      spellCheck={false}
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                    {busy ? "Checking with PayPal…" : "Connect PayPal"}
                  </Button>
                  <p className="text-center text-[10.5px] leading-relaxed text-muted-foreground">
                    The server verifies the credentials with PayPal before saving them.
                  </p>
                </form>
              )}
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
