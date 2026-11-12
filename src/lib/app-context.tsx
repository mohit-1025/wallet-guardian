import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  Account,

  Bill,
  Budget,
  BudgetEnvelope,
  FixedObligation,
  Goal,
  GuardianMessage,
  PatientCheckout,
  Profile,
  Reminder,
  ScheduledPayment,
  Session,
  Subscription,
  Transaction,
  UserData,
} from "./types";
import {
  clearStoredSession,
  ensureDemoAccount,
  getSession,
  getUserData,
  loadSampleWorkspace,
  resetDemoData,
  saveUserData,
  signInWithPayPal,
} from "./storage";
import { endPayPalSession, fetchPayPalSession } from "./auth";
import { generateBudget } from "./finance";
import { addDaysISO, addMonthsISO, monthKey, nextMonthKey } from "./dates";
import { uid } from "./utils";

type NewTransaction = Omit<Transaction, "id" | "createdAt" | "source"> & { source?: Transaction["source"] };

interface OnboardingInput {
  monthlyIncome: number;
  incomeType: "fixed" | "irregular";
  obligations: FixedObligation[];
  savingsTarget: number;
  goal?: { name: string; target: number; deadline: string } | null;
}

interface AppContextValue {
  session: Session | null;
  data: UserData | null;
  loading: boolean;
  bootError: string | null;
  authNotice: string | null;
  clearAuthNotice: () => void;
  signOut: () => Promise<void>;
  signInGuest: () => Promise<void>;
  resetDemo: () => void;
  loadSample: () => void;
  setProfile: (patch: Partial<Profile>) => void;
  completeOnboarding: (input: OnboardingInput) => void;
  addTransaction: (tx: NewTransaction) => Transaction;
  addTransactions: (txs: NewTransaction[]) => void;
  updateTransaction: (id: string, patch: Partial<Transaction>) => void;
  deleteTransaction: (id: string) => void;
  replaceMonthBudget: (month: string, plan: { budget: Budget; envelopes: BudgetEnvelope[] }) => void;
  ensureBudget: (month: string) => void;
  updateEnvelope: (id: string, allocated: number) => void;
  moveEnvelopeMoney: (fromId: string, toId: string, amount: number) => void;
  rolloverMonth: (month: string, goalId: string) => number;
  addGoal: (goal: Omit<Goal, "id" | "createdAt" | "saved"> & { saved?: number }) => Goal;
  updateGoal: (id: string, patch: Partial<Goal>) => void;
  deleteGoal: (id: string) => void;
  contributeToGoal: (id: string, amount: number, fromWallet?: boolean) => void;
  addSubscription: (sub: Omit<Subscription, "id" | "createdAt" | "priceHistory" | "lastUsedDaysAgo" | "status"> & Partial<Subscription>) => void;
  updateSubscription: (id: string, patch: Partial<Subscription>) => void;
  deleteSubscription: (id: string) => void;
  addBill: (bill: Omit<Bill, "id" | "createdAt"> & Partial<Bill>) => void;
  updateBill: (id: string, patch: Partial<Bill>) => void;
  deleteBill: (id: string) => void;
  markBillPaid: (id: string, recordExpense?: boolean) => void;
  addReminder: (rem: Omit<Reminder, "id" | "createdAt" | "status"> & Partial<Reminder>) => Reminder;
  updateReminder: (id: string, patch: Partial<Reminder>) => void;
  deleteReminder: (id: string) => void;
  settleReminder: (id: string) => void;
  addScheduledPayment: (p: Omit<ScheduledPayment, "id" | "createdAt" | "history" | "nextRunDate" | "status"> & Partial<ScheduledPayment>) => ScheduledPayment;
  updateScheduledPayment: (id: string, patch: Partial<ScheduledPayment>) => void;
  deleteScheduledPayment: (id: string) => void;
  recordScheduledRun: (id: string, run: { status: "paid" | "simulated" | "failed"; paypalBatchId?: string; note?: string }) => void;
  dismissInsight: (id: string) => void;
  addCheckout: (c: Omit<PatientCheckout, "id">) => PatientCheckout;
  updateCheckout: (id: string, patch: Partial<PatientCheckout>) => void;
  addMessage: (m: Omit<GuardianMessage, "id" | "createdAt">) => void;
  clearMessages: () => void;
  topUpWallet: (amountInr: number, orderId: string, captureId?: string) => void;
  payPerson: (input: { amountInr: number; name: string; email: string; note: string; orderId: string; captureId?: string }) => void;
  adjustWallet: (amountInr: number) => void;
  refresh: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function updateAccountBalance(accounts: Account[], type: Account["type"], delta: number): Account[] {
  const idx = accounts.findIndex((a) => a.type === type);
  if (idx === -1) return accounts;
  const next = [...accounts];
  next[idx] = { ...next[idx], balance: next[idx].balance + delta };
  return next;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const clearAuthNotice = useCallback(() => setAuthNotice(null), []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const stored = getSession();

        // Restore a demo session instantly; a real PayPal session is verified
        // with the server below and always replaces it when one exists.
        if (stored?.provider === "demo") {
          const demoData = getUserData(stored.userId);
          if (demoData) {
            setSession(stored);
            setData(demoData);
          } else {
            clearStoredSession();
          }
        }

        try {
          const live = await fetchPayPalSession();
          if (cancelled) return;
          if (!live) {
            if (stored?.provider === "paypal") {
              clearStoredSession();
              setAuthNotice("Your PayPal session ended. Sign in again to keep making real payments.");
            }
            return;
          }
          const res = signInWithPayPal(live.user, stored);
          setSession(res.session);
          setData(res.data);
        } catch {
          // Server unreachable: keep the local ledger; every PayPal call still fails closed.
          if (!cancelled && stored?.provider === "paypal") {
            const data = getUserData(stored.userId);
            if (data) {
              setSession(stored);
              setData(data);
            }
          }
        }
      } catch (err) {
        if (!cancelled) setBootError(err instanceof Error ? err.message : "Could not load local data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const update = useCallback((fn: (draft: UserData) => UserData) => {
    setData((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      saveUserData(next);
      return next;
    });
  }, []);

  const signOut = useCallback(async () => {
    clearStoredSession();
    setSession(null);
    setData(null);
    setAuthNotice(null);
    await endPayPalSession();
  }, []);

  const signInGuest = useCallback(async () => {
    // A leftover live cookie would make the server treat demo calls as a real
    // account. End it first so every demo request stays on the sandbox path.
    await endPayPalSession();
    const res = ensureDemoAccount();
    setSession(res.session);
    setData(res.data);
    setAuthNotice(null);
  }, []);

  const resetDemo = useCallback(() => {
    const res = resetDemoData();
    setSession(res.session);
    setData(res.data);
  }, []);

  const loadSample = useCallback(() => {
    if (!session) return;
    if (session.provider === "demo") {
      const res = resetDemoData();
      setSession(res.session);
      setData(res.data);
      return;
    }
    setData(loadSampleWorkspace(session));
  }, [session]);

  const setProfile = useCallback(
    (patch: Partial<Profile>) => update((d) => ({ ...d, profile: { ...d.profile, ...patch } })),
    [update],
  );

  const completeOnboarding = useCallback(
    (input: OnboardingInput) => {
      update((d) => {
        const profile: Profile = {
          ...d.profile,
          monthlyIncome: input.monthlyIncome,
          incomeType: input.incomeType,
          fixedObligations: input.obligations,
          savingsTarget: input.savingsTarget,
          onboardingComplete: true,
        };
        const plan = generateBudget(profile, d.transactions, d.categories);
        const goals = [...d.goals];
        if (input.goal && input.goal.name.trim() && input.goal.target > 0) {
          goals.push({
            id: uid("goal"),
            name: input.goal.name.trim(),
            target: input.goal.target,
            saved: 0,
            deadline: input.goal.deadline,
            icon: "target",
            color: "#059669",
            autoMonthly: Math.max(0, Math.round(input.savingsTarget)),
            createdAt: new Date().toISOString(),
          });
        }
        return {
          ...d,
          profile,
          goals,
          budgets: [...d.budgets.filter((b) => b.month !== plan.budget.month), plan.budget],
          envelopes: [...d.envelopes.filter((e) => e.budgetId !== plan.budget.id), ...plan.envelopes],
        };
      });
    },
    [update],
  );

  const addTransaction = useCallback(
    (tx: NewTransaction) => {
      const full: Transaction = {
        ...tx,
        id: uid("tx"),
        source: tx.source ?? "manual",
        createdAt: new Date().toISOString(),
      };
      update((d) => ({ ...d, transactions: [full, ...d.transactions] }));
      return full;
    },
    [update],
  );

  const addTransactions = useCallback(
    (txs: NewTransaction[]) => {
      const stamp = new Date().toISOString();
      const full = txs.map((tx) => ({ ...tx, id: uid("tx"), source: tx.source ?? "import" as const, createdAt: stamp }));
      update((d) => ({ ...d, transactions: [...full, ...d.transactions] }));
    },
    [update],
  );

  const updateTransaction = useCallback(
    (id: string, patch: Partial<Transaction>) =>
      update((d) => ({ ...d, transactions: d.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
    [update],
  );

  const deleteTransaction = useCallback(
    (id: string) => update((d) => ({ ...d, transactions: d.transactions.filter((t) => t.id !== id) })),
    [update],
  );

  const replaceMonthBudget = useCallback(
    (month: string, plan: { budget: Budget; envelopes: BudgetEnvelope[] }) =>
      update((d) => ({
        ...d,
        budgets: [...d.budgets.filter((b) => b.month !== month), plan.budget],
        envelopes: [...d.envelopes.filter((e) => e.budgetId !== plan.budget.id), ...plan.envelopes],
      })),
    [update],
  );

  const ensureBudget = useCallback(
    (month: string) => {
      setData((prev) => {
        if (!prev || prev.budgets.some((b) => b.month === month)) return prev;
        const plan = generateBudget(prev.profile, prev.transactions, prev.categories, month);
        const next = {
          ...prev,
          budgets: [...prev.budgets, plan.budget],
          envelopes: [...prev.envelopes, ...plan.envelopes],
        };
        saveUserData(next);
        return next;
      });
    },
    [],
  );

  const updateEnvelope = useCallback(
    (id: string, allocated: number) =>
      update((d) => ({ ...d, envelopes: d.envelopes.map((e) => (e.id === id ? { ...e, allocated: Math.max(0, Math.round(allocated)) } : e)) })),
    [update],
  );

  const moveEnvelopeMoney = useCallback(
    (fromId: string, toId: string, amount: number) =>
      update((d) => {
        const from = d.envelopes.find((e) => e.id === fromId);
        const to = d.envelopes.find((e) => e.id === toId);
        if (!from || !to) return d;
        const amt = Math.min(Math.max(0, Math.round(amount)), from.allocated);
        return {
          ...d,
          envelopes: d.envelopes.map((e) =>
            e.id === fromId ? { ...e, allocated: e.allocated - amt } : e.id === toId ? { ...e, allocated: e.allocated + amt } : e,
          ),
        };
      }),
    [update],
  );

  const rolloverMonth = useCallback(
    (month: string, goalId: string) => {
      let rolled = 0;
      update((d) => {
        const budget = d.budgets.find((b) => b.month === month);
        if (!budget || budget.rollover > 0) return d;
        const envs = d.envelopes.filter((e) => e.budgetId === budget.id && e.group !== "savings");
        const leftover = envs.reduce((sum, e) => {
          const spent = d.transactions
            .filter((t) => t.type === "expense" && !t.transfer && t.categoryId === e.categoryId && t.date.startsWith(month))
            .reduce((s, t) => s + t.amount, 0);
          return sum + Math.max(0, e.allocated - spent);
        }, 0);
        if (leftover <= 0) return d;
        rolled = leftover;
        return {
          ...d,
          budgets: d.budgets.map((b) => (b.month === month ? { ...b, rollover: Math.round(leftover) } : b)),
          goals: d.goals.map((g) => (g.id === goalId ? { ...g, saved: g.saved + Math.round(leftover) } : g)),
        };
      });
      return rolled;
    },
    [update],
  );

  const addGoal = useCallback(
    (goal: Omit<Goal, "id" | "createdAt" | "saved"> & { saved?: number }) => {
      const full: Goal = { ...goal, saved: goal.saved ?? 0, id: uid("goal"), createdAt: new Date().toISOString() };
      update((d) => ({ ...d, goals: [...d.goals, full] }));
      return full;
    },
    [update],
  );

  const updateGoal = useCallback(
    (id: string, patch: Partial<Goal>) =>
      update((d) => ({ ...d, goals: d.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) })),
    [update],
  );

  const deleteGoal = useCallback(
    (id: string) => update((d) => ({ ...d, goals: d.goals.filter((g) => g.id !== id) })),
    [update],
  );

  const contributeToGoal = useCallback(
    (id: string, amount: number, fromWallet = true) => {
      const amt = Math.max(0, Math.round(amount));
      update((d) => ({
        ...d,
        goals: d.goals.map((g) => (g.id === id ? { ...g, saved: Math.min(g.target, g.saved + amt) } : g)),
        profile: fromWallet ? { ...d.profile, walletBalance: d.profile.walletBalance - amt } : d.profile,
        accounts: fromWallet ? updateAccountBalance(d.accounts, "paypal", -amt) : d.accounts,
      }));
    },
    [update],
  );

  const addSubscription = useCallback(
    (sub: Omit<Subscription, "id" | "createdAt" | "priceHistory" | "lastUsedDaysAgo" | "status"> & Partial<Subscription>) => {
      const full: Subscription = {
        id: uid("sub"),
        name: sub.name,
        cost: sub.cost,
        cycle: sub.cycle,
        nextBillingDate: sub.nextBillingDate,
        category: sub.category,
        status: sub.status ?? "active",
        lastUsedDaysAgo: sub.lastUsedDaysAgo ?? 1,
        duplicateGroup: sub.duplicateGroup,
        priceHistory: sub.priceHistory ?? [{ date: new Date().toISOString().slice(0, 10), price: sub.cost }],
        createdAt: new Date().toISOString(),
      };
      update((d) => ({ ...d, subscriptions: [...d.subscriptions, full] }));
    },
    [update],
  );

  const updateSubscription = useCallback(
    (id: string, patch: Partial<Subscription>) =>
      update((d) => ({ ...d, subscriptions: d.subscriptions.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
    [update],
  );

  const deleteSubscription = useCallback(
    (id: string) => update((d) => ({ ...d, subscriptions: d.subscriptions.filter((s) => s.id !== id) })),
    [update],
  );

  const addBill = useCallback(
    (bill: Omit<Bill, "id" | "createdAt"> & Partial<Bill>) => {
      const full: Bill = { ...bill, id: uid("bill"), status: bill.status ?? "upcoming", createdAt: new Date().toISOString() };
      update((d) => ({ ...d, bills: [...d.bills, full] }));
    },
    [update],
  );

  const updateBill = useCallback(
    (id: string, patch: Partial<Bill>) =>
      update((d) => ({ ...d, bills: d.bills.map((b) => (b.id === id ? { ...b, ...patch } : b)) })),
    [update],
  );

  const deleteBill = useCallback(
    (id: string) => update((d) => ({ ...d, bills: d.bills.filter((b) => b.id !== id) })),
    [update],
  );

  const markBillPaid = useCallback(
    (id: string, recordExpense = false) => {
      update((d) => {
        const bill = d.bills.find((b) => b.id === id);
        const next: UserData = {
          ...d,
          bills: d.bills.map((b) => (b.id === id ? { ...b, status: "paid", paidAt: new Date().toISOString().slice(0, 10) } : b)),
        };
        if (recordExpense && bill) {
          next.transactions = [
            {
              id: uid("tx"),
              type: "expense",
              amount: bill.amount,
              categoryId: bill.kind === "emi" ? "cat_emi" : bill.kind === "ticket" ? "cat_travel" : "cat_utilities",
              merchant: bill.title,
              date: new Date().toISOString().slice(0, 10),
              paymentMethod: "Bill payment",
              source: "manual",
              notes: "Marked paid from Bills",
              createdAt: new Date().toISOString(),
            },
            ...next.transactions,
          ];
        }
        return next;
      });
    },
    [update],
  );

  const addReminder = useCallback(
    (rem: Omit<Reminder, "id" | "createdAt" | "status"> & Partial<Reminder>) => {
      const full: Reminder = { ...rem, id: uid("rem"), status: rem.status ?? "open", createdAt: new Date().toISOString() };
      update((d) => ({ ...d, reminders: [...d.reminders, full] }));
      return full;
    },
    [update],
  );

  const updateReminder = useCallback(
    (id: string, patch: Partial<Reminder>) =>
      update((d) => ({ ...d, reminders: d.reminders.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
    [update],
  );

  const deleteReminder = useCallback(
    (id: string) => update((d) => ({ ...d, reminders: d.reminders.filter((r) => r.id !== id) })),
    [update],
  );

  const settleReminder = useCallback(
    (id: string) => update((d) => ({ ...d, reminders: d.reminders.map((r) => (r.id === id ? { ...r, status: "settled" } : r)) })),
    [update],
  );

  const addScheduledPayment = useCallback(
    (p: Omit<ScheduledPayment, "id" | "createdAt" | "history" | "nextRunDate" | "status"> & Partial<ScheduledPayment>) => {
      const full: ScheduledPayment = {
        ...p,
        id: uid("sp"),
        status: p.status ?? "active",
        nextRunDate: p.nextRunDate ?? p.startDate,
        history: p.history ?? [],
        createdAt: new Date().toISOString(),
      };
      update((d) => ({ ...d, scheduledPayments: [...d.scheduledPayments, full] }));
      return full;
    },
    [update],
  );

  const updateScheduledPayment = useCallback(
    (id: string, patch: Partial<ScheduledPayment>) =>
      update((d) => ({ ...d, scheduledPayments: d.scheduledPayments.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
    [update],
  );

  const deleteScheduledPayment = useCallback(
    (id: string) => update((d) => ({ ...d, scheduledPayments: d.scheduledPayments.filter((p) => p.id !== id) })),
    [update],
  );

  const recordScheduledRun = useCallback(
    (id: string, run: { status: "paid" | "simulated" | "failed"; paypalBatchId?: string; note?: string }) => {
      update((d) => {
        const payment = d.scheduledPayments.find((p) => p.id === id);
        if (!payment) return d;
        const today = new Date().toISOString().slice(0, 10);
        const nextDate =
          payment.frequency === "once"
            ? payment.nextRunDate
            : payment.frequency === "weekly"
              ? addDaysISO(payment.nextRunDate, 7)
              : addMonthsISO(payment.nextRunDate, 1);
        const ended = payment.endDate ? nextDate > payment.endDate : false;
        let nextStatus = payment.status;
        if (payment.frequency === "once") nextStatus = "completed";
        else if (ended) nextStatus = "completed";
        return {
          ...d,
          scheduledPayments: d.scheduledPayments.map((p) =>
            p.id === id
              ? {
                  ...p,
                  status: nextStatus,
                  nextRunDate: nextDate,
                  history: [
                    { id: uid("run"), date: today, amount: p.amount, status: run.status, paypalBatchId: run.paypalBatchId, note: run.note },
                    ...p.history,
                  ],
                }
              : p,
          ),
          transactions:
            run.status === "failed"
              ? d.transactions
              : [
                  {
                    id: uid("tx"),
                    type: "expense",
                    amount: payment.amount,
                    categoryId: payment.category === "Housing" ? "cat_rent" : payment.category === "Education" ? "cat_education" : "cat_other",
                    merchant: payment.payeeName,
                    date: today,
                    paymentMethod: "PayPal",
                    notes: `Autopay to ${payment.payeeEmail}${run.status === "simulated" ? " (simulated)" : ""}`,
                    source: "autopay",
                    paypalOrderId: run.paypalBatchId,
                    createdAt: new Date().toISOString(),
                  },
                  ...d.transactions,
                ],
          profile: run.status === "failed" ? d.profile : { ...d.profile, walletBalance: d.profile.walletBalance - payment.amount },
          accounts:
            run.status === "failed" ? d.accounts : updateAccountBalance(d.accounts, "paypal", -payment.amount),
        };
      });
    },
    [update],
  );

  const dismissInsight = useCallback(
    (id: string) => update((d) => ({ ...d, dismissedInsights: [...new Set([...d.dismissedInsights, id])] })),
    [update],
  );

  const addCheckout = useCallback(
    (c: Omit<PatientCheckout, "id">) => {
      const full: PatientCheckout = { ...c, id: uid("pc") };
      update((d) => ({ ...d, patientCheckouts: [full, ...d.patientCheckouts] }));
      return full;
    },
    [update],
  );

  const updateCheckout = useCallback(
    (id: string, patch: Partial<PatientCheckout>) =>
      update((d) => ({ ...d, patientCheckouts: d.patientCheckouts.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
    [update],
  );

  const addMessage = useCallback(
    (m: Omit<GuardianMessage, "id" | "createdAt">) => {
      const full: GuardianMessage = { ...m, id: uid("msg"), createdAt: new Date().toISOString() };
      update((d) => ({ ...d, messages: [...d.messages, full] }));
    },
    [update],
  );

  const clearMessages = useCallback(() => update((d) => ({ ...d, messages: [] })), [update]);

  const topUpWallet = useCallback(
    (amountInr: number, orderId: string, captureId?: string) => {
      update((d) => ({
        ...d,
        profile: { ...d.profile, walletBalance: d.profile.walletBalance + amountInr },
        accounts: updateAccountBalance(d.accounts, "paypal", amountInr),
        transactions: [
          {
            id: uid("tx"),
            type: "income",
            amount: amountInr,
            categoryId: "cat_refunds",
            merchant: "PayPal wallet top-up",
            date: new Date().toISOString().slice(0, 10),
            paymentMethod: "PayPal",
            notes: "Wallet transfer — excluded from income analytics",
            source: "paypal",
            paypalOrderId: orderId,
            paypalCaptureId: captureId,
            transfer: true,
            createdAt: new Date().toISOString(),
          },
          ...d.transactions,
        ],
      }));
    },
    [update],
  );

  const payPerson = useCallback(
    (input: { amountInr: number; name: string; email: string; note: string; orderId: string; captureId?: string }) => {
      update((d) => ({
        ...d,
        profile: { ...d.profile, walletBalance: d.profile.walletBalance - input.amountInr },
        accounts: updateAccountBalance(d.accounts, "paypal", -input.amountInr),
        transactions: [
          {
            id: uid("tx"),
            type: "expense",
            amount: input.amountInr,
            categoryId: "cat_other",
            merchant: input.name || input.email,
            date: new Date().toISOString().slice(0, 10),
            paymentMethod: "PayPal",
            notes: input.note || `PayPal payment to ${input.email}`,
            source: "paypal",
            paypalOrderId: input.orderId,
            paypalCaptureId: input.captureId,
            createdAt: new Date().toISOString(),
          },
          ...d.transactions,
        ],
      }));
    },
    [update],
  );

  const adjustWallet = useCallback(
    (amountInr: number) =>
      update((d) => ({
        ...d,
        profile: { ...d.profile, walletBalance: Math.max(0, d.profile.walletBalance + amountInr) },
        accounts: updateAccountBalance(d.accounts, "paypal", amountInr),
      })),
    [update],
  );

  const refresh = useCallback(() => {
    if (!session) return;
    const stored = getUserData(session.userId);
    if (stored) setData(stored);
  }, [session]);

  const value = useMemo<AppContextValue>(
    () => ({
      session, data, loading, bootError, authNotice, clearAuthNotice,
      signOut, signInGuest, resetDemo, loadSample,
      setProfile, completeOnboarding,
      addTransaction, addTransactions, updateTransaction, deleteTransaction,
      replaceMonthBudget, ensureBudget, updateEnvelope, moveEnvelopeMoney, rolloverMonth,
      addGoal, updateGoal, deleteGoal, contributeToGoal,
      addSubscription, updateSubscription, deleteSubscription,
      addBill, updateBill, deleteBill, markBillPaid,
      addReminder, updateReminder, deleteReminder, settleReminder,
      addScheduledPayment, updateScheduledPayment, deleteScheduledPayment, recordScheduledRun,
      dismissInsight, addCheckout, updateCheckout, addMessage, clearMessages,
      topUpWallet, payPerson, adjustWallet, refresh,
    }),
    [
      session, data, loading, bootError, authNotice, clearAuthNotice, signOut, signInGuest, resetDemo, loadSample, setProfile, completeOnboarding,
      addTransaction, addTransactions, updateTransaction, deleteTransaction, replaceMonthBudget, ensureBudget,
      updateEnvelope, moveEnvelopeMoney, rolloverMonth, addGoal, updateGoal, deleteGoal, contributeToGoal,
      addSubscription, updateSubscription, deleteSubscription, addBill, updateBill, deleteBill, markBillPaid,
      addReminder, updateReminder, deleteReminder, settleReminder, addScheduledPayment, updateScheduledPayment,
      deleteScheduledPayment, recordScheduledRun, dismissInsight, addCheckout, updateCheckout, addMessage,
      clearMessages, topUpWallet, payPerson, adjustWallet, refresh,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

export function useAppData() {
  const { data } = useApp();
  if (!data) throw new Error("App data not loaded");
  return data;
}

export { monthKey, nextMonthKey };
