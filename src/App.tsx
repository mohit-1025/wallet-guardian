import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { ShieldCheck } from "lucide-react";
import { AppProvider, useApp } from "@/lib/app-context";
import { ThemeProvider } from "@/lib/theme";
import { IntegrationProvider } from "@/lib/integration-context";
import { UIProvider } from "@/components/layout/ui-context";
import { TooltipProvider } from "@/components/ui/menu";
import { AppShell } from "@/components/layout/app-shell";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import LandingPage from "@/pages/landing";
import AuthPage from "@/pages/auth";

const OnboardingPage = lazy(() => import("@/pages/onboarding"));
const SetupPage = lazy(() => import("@/pages/setup"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const TransactionsPage = lazy(() => import("@/pages/transactions"));
const BudgetPage = lazy(() => import("@/pages/budget"));
const AnalyticsPage = lazy(() => import("@/pages/analytics"));
const SubscriptionsPage = lazy(() => import("@/pages/subscriptions"));
const BillsPage = lazy(() => import("@/pages/bills"));
const RemindersPage = lazy(() => import("@/pages/reminders"));
const GoalsPage = lazy(() => import("@/pages/goals"));
const WalletPage = lazy(() => import("@/pages/wallet"));
const AutopayPage = lazy(() => import("@/pages/autopay"));
const GuardianPage = lazy(() => import("@/pages/guardian"));
const ShopperPage = lazy(() => import("@/pages/shopper"));
const SettingsPage = lazy(() => import("@/pages/settings"));

function BootSkeleton() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center"><Logo /></div>
        <Card className="space-y-3 p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-24 w-full" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
          <Skeleton className="h-2 w-2/3" />
        </Card>
        <p className="mt-4 text-center text-[11.5px] text-muted-foreground">Opening your guardian…</p>
      </div>
    </div>
  );
}

function RequireSession({ children }: { children: ReactNode }) {
  const { session, loading, data } = useApp();
  const location = useLocation();
  if (loading) return <BootSkeleton />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (data && !data.profile.onboardingComplete) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function OnboardingGuard({ children }: { children: ReactNode }) {
  const { session, loading, data } = useApp();
  if (loading) return <BootSkeleton />;
  if (!session) return <Navigate to="/login" replace />;
  if (data?.profile.onboardingComplete) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useApp();
  if (loading) return <BootSkeleton />;
  if (session) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  return null;
}

function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <ShieldCheck className="h-6 w-6" />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Nothing here</h1>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
        That page doesn't exist or moved. Your money is safe — let's get you back.
      </p>
      <div className="mt-5 flex gap-2">
        <Button asChild><Link to="/app">Open dashboard</Link></Button>
        <Button variant="outline" asChild><Link to="/">Home</Link></Button>
      </div>
    </div>
  );
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Wallet Guardian crashed", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">
            Your locally stored data is untouched. Reload the app to continue.
          </p>
          <Button className="mt-5" onClick={() => window.location.reload()}>Reload app</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppRoutes() {
  return (
    <Suspense fallback={<BootSkeleton />}>
      <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<GuestOnly><AuthPage /></GuestOnly>} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/signup" element={<Navigate to="/login" replace />} />
      <Route path="/onboarding" element={<OnboardingGuard><OnboardingPage /></OnboardingGuard>} />
      <Route path="/app" element={<RequireSession><AppShell /></RequireSession>}>
        <Route index element={<DashboardPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="budget" element={<BudgetPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="subscriptions" element={<SubscriptionsPage />} />
        <Route path="bills" element={<BillsPage />} />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="goals" element={<GoalsPage />} />
        <Route path="wallet" element={<WalletPage />} />
        <Route path="autopay" element={<AutopayPage />} />
        <Route path="guardian" element={<GuardianPage />} />
        <Route path="shopper" element={<ShopperPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppProvider>
          <IntegrationProvider>
            <UIProvider>
              <TooltipProvider delayDuration={200}>
                <AppErrorBoundary>
                  <ScrollToTop />
                  <AppRoutes />
                </AppErrorBoundary>
                <Toaster
                  position="top-right"
                  closeButton
                  richColors
                  toastOptions={{ className: "text-[13px]" }}
                />
              </TooltipProvider>
            </UIProvider>
          </IntegrationProvider>
        </AppProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
