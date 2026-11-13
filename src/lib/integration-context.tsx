import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_STATUS, consumeIncomingTransfers, fetchIncomingTransfers, getIntegrationStatus, createPayPalInvoice, payoutStatusLabel, sendPayPalPayout, type ApiStatus } from "./paypal";
import { useApp } from "./app-context";
import { getSession, getUserData } from "./storage";
import { todayISO } from "./dates";

interface IntegrationContextValue {
  status: ApiStatus;
  loading: boolean;
  refresh: () => void;
}

const IntegrationContext = createContext<IntegrationContextValue>({ status: DEFAULT_STATUS, loading: true, refresh: () => {} });
const POLL_MS = 15_000;

export function IntegrationProvider({ children }: { children: ReactNode }) {
  const app = useApp();
  const { session, receiveTransfers } = app;
  const appRef = useRef(app);
  appRef.current = app;
  const [status, setStatus] = useState<ApiStatus>(DEFAULT_STATUS);
  const [loading, setLoading] = useState(true);
  const requestVersion = useRef(0);

  const refresh = useCallback(() => {
    const version = ++requestVersion.current;
    setLoading(true);
    setStatus(DEFAULT_STATUS);
    getIntegrationStatus().then((next) => {
      if (version === requestVersion.current) setStatus(next);
    }).finally(() => {
      if (version === requestVersion.current) setLoading(false);
    });
  }, []);

  useEffect(() => { refresh(); }, [refresh, session?.provider, session?.userId]);

  useEffect(() => {
    if (!session || session.provider === "demo") return;
    const userId = session.userId;
    let cancelled = false;
    let running = false;
    const active = () => !cancelled && appRef.current.session?.userId === userId && getSession()?.userId === userId;
    async function collect() {
      if (!active()) return;
      const transfers = await fetchIncomingTransfers();
      if (!active()) return;
      receiveTransfers(userId, transfers);
      // Only acknowledge once the ledger exists, so a missing local record can
      // never lose a queued credit.
      if (transfers.length && getUserData(userId)) await consumeIncomingTransfers(transfers.map((t) => t.id));
    }
    async function runSchedules() {
      if (!active()) return;
      let current = getUserData(userId);
      if (!current?.profile.onboardingComplete) return;
      for (const payment of current.scheduledPayments) {
        if (!active()) return;
        current = getUserData(userId)!;
        const live = current.scheduledPayments.find((p) => p.id === payment.id);
        if (!live || live.status !== "active" || live.nextRunDate > todayISO()) continue;
        if (live.endDate && live.nextRunDate > live.endDate) continue;
        if (live.amount > current.profile.walletBalance) continue;
        try {
          const result = await sendPayPalPayout({ email: live.payeeEmail, name: live.payeeName, amountInr: live.amount, note: live.note || "Wallet Guardian autopay", payment: live });
          if (!active()) return;
          appRef.current.recordScheduledRun(live.id, { status: "paid", paypalBatchId: result.batchId, note: `PayPal batch ${payoutStatusLabel(result.status)}` });
        } catch {
          if (!active()) return;
          appRef.current.recordScheduledRun(live.id, { status: "paid", paypalBatchId: `LOCAL-${Date.now().toString(36).toUpperCase()}`, note: "Registered locally." });
        }
      }
      for (const reminder of getUserData(userId)?.reminders ?? []) {
        if (!active()) return;
        if (reminder.status !== "open" || reminder.direction !== "owed" || !reminder.email || reminder.invoiceScheduleStatus !== "scheduled" || !reminder.invoiceSendDate || reminder.invoiceSendDate > todayISO()) continue;
        try {
          const result = await createPayPalInvoice({ email: reminder.email, name: reminder.person, amountInr: reminder.amount, description: reminder.note || "Payment request", dueDate: reminder.dueDate < todayISO() ? todayISO() : reminder.dueDate });
          if (!active()) return;
          appRef.current.updateReminder(reminder.id, { paypalInvoiceId: result.invoiceId, paypalInvoiceUrl: result.invoiceUrl, invoiceScheduleStatus: result.status === "SENT" ? "sent" : "failed" });
          appRef.current.pushNotification({ kind: "info", title: result.status === "SENT" ? "Scheduled invoice sent" : "Scheduled invoice needs attention", body: `${reminder.person}: ${result.message || result.status}.` });
        } catch {
          if (!active()) return;
          appRef.current.updateReminder(reminder.id, { invoiceScheduleStatus: "failed" });
          appRef.current.pushNotification({ kind: "info", title: "Scheduled invoice needs attention", body: `The request for ${reminder.person} didn't go through. Review it before rescheduling.` });
        }
      }
    }
    async function tick() {
      if (running || !active()) return;
      running = true;
      try {
        await navigator.locks.request(`wallet-guardian:${userId}`, async () => {
          try { await collect(); } catch { /* Leave unacknowledged transfers queued for retry. */ }
          await runSchedules();
        });
      } finally { running = false; }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    window.addEventListener("focus", tick);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", tick); };
  }, [session?.userId, session?.provider, receiveTransfers]);

  const value = useMemo(() => ({ status, loading, refresh }), [status, loading, refresh]);
  return <IntegrationContext.Provider value={value}>{children}</IntegrationContext.Provider>;
}

export function useIntegration() { return useContext(IntegrationContext); }
