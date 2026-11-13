import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  Account,
  AppNotification,
  Bill,
  Budget,
  BudgetEnvelope,
  FixedObligation,
  FlowExpense,
  Goal,
  GuardianMessage,
  NewTransaction,
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
  signInWithAccount,
} from "./storage";
import { endAccountSession, fetchAccountSession, loginAccount, registerAccount } from "./auth";
import { generateBudget } from "./finance";
import { enrichTransaction, flowsFromObligations, guessFlowTab } from "./flows";
import { guessCategory } from "./categories";
import { addDaysISO, addMonthsISO, monthKey, nextMonthKey } from "./dates";
import { uid } from "./utils";
import type { IncomingTransfer } from "./paypal";
import { formatMoney } from "./money";

interface OnboardingInput {
  monthlyIncome: number;
  incomeType: "fixed" | "irregular";
  obligations: FixedObligation[];
  goals: { name: string; target: number; deadline: string }[];
  /** Sandbox opening credit for a new account (₹4,16,000 for $5,000 at 83.2). */
  openingCreditInr?: number;
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
  signInAccount: (email: string, password: string) => Promise<void>;
  createAccount: (name: string, email: string, password: string) => Promise<void>;
  resetDemo: () => void;
  loadSample: () => void;
  setProfile: (patch: Partial<Profile>) => void;
  completeOnboarding: (input: OnboardingInput) => void;
  addTransaction: (tx: NewTransaction) => Transaction;
  receiveTransfers: (userId: string, transfers: IncomingTransfer[]) => void;
  updateTransaction: (id: string, patch: Partial<Transaction>) => void;
  replaceMonthBudget: (month: string, plan: { budget: Budget; envelopes: BudgetEnvelope[] }) => void;
  ensureBudget: (month: string) => void;
  updateEnvelope: (id: string, allocated: number) => void;
  moveEnvelopeMoney: (fromId: string, toId: string, amount: number) => void;
  rolloverMonth: (month: string, goalId: string) => number;
  addGoal: (goal: Omit<Goal, "id" | "createdAt" | "saved"> & { saved?: number }) => Goal;
  updateGoal: (id: string, patch: Partial<Goal>) => void;
  deleteGoal: (id: string) => void;
  contributeToGoal: (id: string, amount: number) => void;
  /** Pulls money back out of a goal vault into the wallet, with a matching ledger row. */
  withdrawFromGoal: (id: string, amount: number) => void;
  addSubscription: (sub: Omit<Subscription, "id" | "createdAt" | "priceHistory" | "lastUsedDaysAgo" | "status"> & Partial<Subscription>) => void;
  updateSubscription: (id: string, patch: Partial<Subscription>) => void;
  deleteSubscription: (id: string) => void;
  addBill: (bill: Omit<Bill, "id" | "createdAt"> & Partial<Bill>) => void;
  updateBill: (id: string, patch: Partial<Bill>) => void;
  deleteBill: (id: string) => void;
  markBillPaid: (id: string, recordExpense?: boolean) => void;
  addFlowExpense: (flow: Omit<FlowExpense, "id" | "createdAt" | "status" | "source"> & Partial<FlowExpense>) => FlowExpense;
  updateFlowExpense: (id: string, patch: Partial<FlowExpense>) => void;
  deleteFlowExpense: (id: string) => void;
  initializeFlowExpenses: () => void;
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
  payPerson: (input: { amountInr: number; name: string; email: string; note: string; batchId?: string }) => void;
  /** Balance tweak used by incoming-transfer processing. */
  adjustWallet: (amountInr: number) => void;
  pushNotification: (n: Omit<AppNotification, "id" | "createdAt" | "read">) => void;
  markAllNotificationsRead: () => void;
  refresh: () => void;
}

export const AUTOPAY_CATEGORY: Record<string, string> = {
  Housing: "cat_rent",
  Utilities: "cat_utilities",
  Subscriptions: "cat_subscriptions",
  "Food & Dining": "cat_groceries",
  Education: "cat_education",
  Health: "cat_health",
  Loans: "cat_emi",
  Family: "cat_other",
  Other: "cat_other",
};

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

        // Restore a demo session instantly; a real account session is verified
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
          const account = await fetchAccountSession();
          if (cancelled) return;
          if (!account) {
            if (stored?.provider === "email") {
              clearStoredSession();
              setAuthNotice("Your session ended. Sign in again.");
            }
            return;
          }
          const res = signInWithAccount(account.user, stored);
          setSession(res.session);
          setData(res.data);
        } catch {
          // Server unreachable: keep the local ledger; every PayPal call still fails closed.
          if (!cancelled && stored?.provider === "email") {
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
    await endAccountSession();
  }, []);

  const signInGuest = useCallback(async () => {
    // A leftover account cookie would make the server treat demo calls as a
    // signed-in account. End it first so every demo request stays on the demo path.
    await endAccountSession();
    const res = ensureDemoAccount();
    setSession(res.session);
    setData(res.data);
    setAuthNotice(null);
  }, []);

  const signInAccount = useCallback(async (email: string, password: string) => {
    const account = await loginAccount(email, password);
    const res = signInWithAccount(account.user);
    setSession(res.session);
    setData(res.data);
    setAuthNotice(null);
  }, []);

  const createAccount = useCallback(async (name: string, email: string, password: string) => {
    const account = await registerAccount(name, email, password);
    const res = signInWithAccount(account.user);
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
        const now = new Date().toISOString();
        const colors = ["#059669", "#0891b2", "#7c3aed", "#d97706", "#db2777", "#4f46e5"];
        const pendingGoals: Goal[] = input.goals
          .filter((g) => g.name.trim() && g.target > 0)
          .map((g, i) => ({
            id: uid("goal"),
            name: g.name.trim(),
            target: g.target,
            saved: 0,
            deadline: g.deadline,
            icon: "target",
            color: colors[i % colors.length],
            createdAt: now,
          }));
        const profile: Profile = {
          ...d.profile,
          monthlyIncome: input.monthlyIncome,
          incomeType: input.incomeType,
          fixedObligations: input.obligations,
          savingsTarget: 0,
          onboardingComplete: true,
        };
        const plan = generateBudget(profile, d.transactions, d.categories, monthKey(), pendingGoals);
        const goals = pendingGoals.map((g, i) => ({
          ...g,
          autoMonthly: Math.max(0, Math.round(plan.adaptive.goalRequests[i]?.monthly ?? 0)),
        }));
        const onboardingFlows = flowsFromObligations(input.obligations, d.flowExpenses, now);
        const credit = Math.max(0, Math.round(input.openingCreditInr ?? 0));
        const openingRow: NewTransaction | null = credit
          ? {
              type: "income",
              amount: credit,
              categoryId: "cat_refunds",
              merchant: "Opening balance",
              date: new Date().toISOString().slice(0, 10),
              paymentMethod: "PayPal",
              notes: "Opening credit of $5,000 — excluded from income analytics",
              source: "paypal",
              transfer: true,
              channel: "paypal",
            }
          : null;
        return {
          ...d,
          profile: { ...profile, savingsTarget: plan.savingsAllocated, walletBalance: d.profile.walletBalance + credit },
          accounts: openingRow ? updateAccountBalance(d.accounts, "paypal", credit) : d.accounts,
          transactions: openingRow ? [enrichTransaction({ ...openingRow, id: uid("tx"), createdAt: now, source: openingRow.source ?? "manual" }), ...d.transactions] : d.transactions,
          notifications: credit
            ? [{ id: uid("ntf"), kind: "credit", title: "Wallet credited", body: "Your account was credited with the $5,000 opening balance.", createdAt: now }, ...d.notifications]
            : d.notifications,
          goals: [...d.goals, ...goals],
          flowExpenses: [...d.flowExpenses, ...onboardingFlows],
          flowsInitialized: true,
          budgets: [...d.budgets.filter((b) => b.month !== plan.budget.month), plan.budget],
          envelopes: [...d.envelopes.filter((e) => e.budgetId !== plan.budget.id), ...plan.envelopes],
        };
      });
    },
    [update],
  );

  const addTransaction = useCallback(
    (tx: NewTransaction) => {
      const full: Transaction = enrichTransaction({
        ...tx,
        id: uid("tx"),
        source: tx.source ?? "manual",
        createdAt: new Date().toISOString(),
      });
      update((d) => ({ ...d, transactions: [full, ...d.transactions] }));
      return full;
    },
    [update],
  );

  const receiveTransfers = useCallback((userId: string, transfers: IncomingTransfer[]) => {
    const d = getUserData(userId);
    if (!d) return;
    const ids = new Set(d.transactions.map((t) => t.id));
    const fresh = transfers.filter((t) => {
      if (ids.has(`incoming_${t.id}`)) return false;
      ids.add(`incoming_${t.id}`);
      return true;
    });
    if (!fresh.length) return;
    const rows = fresh.map((t): Transaction => {
      const guess = guessCategory(`${t.note} ${t.fromName}`, "income");
      return enrichTransaction({
        id: `incoming_${t.id}`, type: "income", amount: Math.round(t.amountInr),
        categoryId: guess.confidence >= 0.5 ? guess.categoryId : "cat_other",
        merchant: t.fromName || t.fromEmail, date: t.createdAt.slice(0, 10),
        paymentMethod: "PayPal", notes: t.note || `Payment from ${t.fromEmail}`,
        source: "paypal", channel: "paypal", needsInfo: guess.confidence < 0.5, createdAt: t.createdAt,
      });
    });
    const credit = rows.reduce((sum, t) => sum + t.amount, 0);
    const notifications = fresh.map((t): AppNotification => ({
      id: `incoming_${t.id}`, kind: "transfer_received", title: "Money received", createdAt: t.createdAt,
      body: `${t.fromName || t.fromEmail} sent you ${formatMoney(t.amountInr, d.profile.currency)}${t.note ? ` — ${t.note}` : "."}`,
    }));
    const next: UserData = {
      ...d, transactions: [...rows, ...d.transactions],
      profile: { ...d.profile, walletBalance: d.profile.walletBalance + credit },
      accounts: updateAccountBalance(d.accounts, "paypal", credit),
      notifications: [...notifications, ...d.notifications].slice(0, 50),
    };
    saveUserData(next);
    setData((prev) => prev?.profile.id === userId ? next : prev);
  }, []);

  const updateTransaction = useCallback(
    (id: string, patch: Partial<Transaction>) =>
      update((d) => ({ ...d, transactions: d.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
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
        const plan = generateBudget(prev.profile, prev.transactions, prev.categories, month, prev.goals);
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

  // Deleting a goal refunds everything saved back to the wallet, with a
  // matching ledger row so balance and transactions stay in sync.
  const deleteGoal = useCallback(
    (id: string) =>
      update((d) => {
        const goal = d.goals.find((g) => g.id === id);
        if (!goal) return d;
        const refund = Math.max(0, Math.round(goal.saved));
        const now = new Date().toISOString();
        const refundRow = refund
          ? {
              id: uid("tx"),
              type: "income" as const,
              amount: refund,
              categoryId: "cat_refunds",
              merchant: `Goal refund — ${goal.name}`,
              date: now.slice(0, 10),
              paymentMethod: "PayPal",
              notes: "Savings goal deleted — saved amount returned to wallet",
              source: "paypal" as const,
              transfer: true,
              channel: "paypal" as const,
              createdAt: now,
            }
          : null;
        return {
          ...d,
          goals: d.goals.filter((g) => g.id !== id),
          transactions: refundRow ? [refundRow, ...d.transactions] : d.transactions,
          profile: { ...d.profile, walletBalance: d.profile.walletBalance + refund },
          accounts: refund ? updateAccountBalance(d.accounts, "paypal", refund) : d.accounts,
        };
      }),
    [update],
  );

  const contributeToGoal = useCallback(
    (id: string, amount: number) => {
      update((d) => {
        const goal = d.goals.find((g) => g.id === id);
        if (!goal) return d;
        const amt = Math.min(Math.max(0, Math.round(amount)), Math.max(0, goal.target - goal.saved));
        if (amt <= 0 || amt > d.profile.walletBalance) return d;
        const now = new Date().toISOString();
        const row: Transaction = {
          id: uid("tx"), type: "expense", amount: amt, categoryId: "cat_refunds",
          merchant: `Savings — ${goal.name}`, date: now.slice(0, 10), paymentMethod: "PayPal",
          notes: "Moved to savings goal — excluded from expense analytics",
          source: "paypal", transfer: true, channel: "paypal", createdAt: now,
        };
        return {
          ...d,
          goals: d.goals.map((g) => (g.id === id ? { ...g, saved: g.saved + amt } : g)),
          transactions: [row, ...d.transactions],
          profile: { ...d.profile, walletBalance: d.profile.walletBalance - amt },
          accounts: updateAccountBalance(d.accounts, "paypal", -amt),
        };
      });
    },
    [update],
  );

  // Mirror of contributeToGoal for pulling money back out of a vault.
  const withdrawFromGoal = useCallback(
    (id: string, amount: number) => {
      update((d) => {
        const goal = d.goals.find((g) => g.id === id);
        if (!goal) return d;
        const amt = Math.min(goal.saved, Math.max(0, Math.round(amount)));
        if (amt <= 0) return d;
        const now = new Date().toISOString();
        return {
          ...d,
          goals: d.goals.map((g) => (g.id === id ? { ...g, saved: Math.max(0, g.saved - amt) } : g)),
          transactions: [
            {
              id: uid("tx"),
              type: "income" as const,
              amount: amt,
              categoryId: "cat_refunds",
              merchant: `Savings withdrawal — ${goal.name}`,
              date: now.slice(0, 10),
              paymentMethod: "PayPal",
              notes: "Moved back from savings goal — excluded from income analytics",
              source: "paypal" as const,
              transfer: true,
              channel: "paypal" as const,
              createdAt: now,
            },
            ...d.transactions,
          ],
          profile: { ...d.profile, walletBalance: d.profile.walletBalance + amt },
          accounts: updateAccountBalance(d.accounts, "paypal", amt),
        };
      });
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
              flowTab: bill.kind === "emi" ? "emis" : bill.kind === "ticket" ? "others" : "bills",
              flowTabSource: "auto",
              channel: "wallet_guardian",
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

  const addFlowExpense = useCallback(
    (flow: Omit<FlowExpense, "id" | "createdAt" | "status" | "source"> & Partial<FlowExpense>) => {
      const full: FlowExpense = {
        ...flow,
        id: uid("flow"),
        status: flow.status ?? "active",
        source: flow.source ?? "manual",
        createdAt: new Date().toISOString(),
      };
      update((d) => ({ ...d, flowExpenses: [...d.flowExpenses, full] }));
      return full;
    },
    [update],
  );

  const updateFlowExpense = useCallback(
    (id: string, patch: Partial<FlowExpense>) =>
      update((d) => ({ ...d, flowExpenses: d.flowExpenses.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
    [update],
  );

  const deleteFlowExpense = useCallback(
    (id: string) => update((d) => ({ ...d, flowExpenses: d.flowExpenses.filter((f) => f.id !== id) })),
    [update],
  );

  const initializeFlowExpenses = useCallback(() => {
    setData((prev) => {
      if (!prev) return prev;
      const fromObligations = flowsFromObligations(prev.profile.fixedObligations, prev.flowExpenses);
      if (fromObligations.length === 0 && prev.flowsInitialized) return prev;
      const next = {
        ...prev,
        flowExpenses: [...fromObligations, ...prev.flowExpenses],
        flowsInitialized: true,
      };
      saveUserData(next);
      return next;
    });
  }, []);

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

  // Every run that moved (or would move) money registers its row and debits
  // the wallet immediately, whatever PayPal answered. Only failed runs leave
  // the ledger untouched.
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
        const categoryId = AUTOPAY_CATEGORY[payment.category] ?? "cat_other";
        const linkedFlow = d.flowExpenses.find((f) => f.autopayId === payment.id);
        const guessed = guessFlowTab(payment.payeeName, categoryId, "expense");
        const moved = run.status !== "failed";
        const row = {
          id: uid("tx"),
          type: "expense" as const,
          amount: payment.amount,
          categoryId,
          merchant: payment.payeeName,
          date: today,
          paymentMethod: "PayPal",
          notes: `Autopay to ${payment.payeeEmail}${run.note ? ` — ${run.note}` : ""}`,
          source: "autopay" as const,
          paypalOrderId: run.paypalBatchId,
          flowTab: linkedFlow?.tab ?? guessed?.tab,
          flowTabSource: linkedFlow ? ("auto" as const) : guessed?.source,
          channel: "autopay" as const,
          createdAt: new Date().toISOString(),
        };
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
          transactions: moved ? [row, ...d.transactions] : d.transactions,
          profile: moved ? { ...d.profile, walletBalance: Math.max(0, d.profile.walletBalance - payment.amount) } : d.profile,
          accounts: moved ? updateAccountBalance(d.accounts, "paypal", -payment.amount) : d.accounts,
          notifications: moved
            ? [
                {
                  id: uid("ntf"),
                  kind: "payment_sent" as const,
                  title: "Autopay sent",
                  body: `₹${payment.amount.toLocaleString("en-IN")} sent to ${payment.payeeName}.`,
                  createdAt: new Date().toISOString(),
                },
                ...d.notifications,
              ]
            : d.notifications,
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

  // A top-up registers its row and credits the wallet immediately, whatever
  // the sandbox answered.
  const topUpWallet = useCallback(
    (amountInr: number, orderId: string, captureId?: string) => {
      update((d) => ({
        ...d,
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
            channel: "paypal",
            createdAt: new Date().toISOString(),
          },
          ...d.transactions,
        ],
        profile: { ...d.profile, walletBalance: d.profile.walletBalance + amountInr },
        accounts: updateAccountBalance(d.accounts, "paypal", amountInr),
      }));
    },
    [update],
  );

  // Paying someone registers the expense and debits the wallet no matter what
  // the sandbox answered. When the receiver's email belongs to another account
  // the server queues an internal transfer for their client to collect.
  const payPerson = useCallback(
    (input: { amountInr: number; name: string; email: string; note: string; batchId?: string }) => {
      update((d) => {
        const merchant = input.name || input.email;
        const categoryId = guessCategory(merchant, "expense").categoryId;
        const flow = guessFlowTab(merchant, categoryId, "expense");
        return {
          ...d,
          transactions: [
            {
              id: uid("tx"),
              type: "expense",
              amount: input.amountInr,
              categoryId,
              merchant,
              date: new Date().toISOString().slice(0, 10),
              paymentMethod: "PayPal",
              notes: input.note || `PayPal payment to ${input.email}`,
              source: "paypal",
              paypalOrderId: input.batchId,
              flowTab: flow?.tab,
              flowTabSource: flow?.source,
              channel: "paypal",
              createdAt: new Date().toISOString(),
            },
            ...d.transactions,
          ],
          profile: { ...d.profile, walletBalance: Math.max(0, d.profile.walletBalance - input.amountInr) },
          accounts: updateAccountBalance(d.accounts, "paypal", -input.amountInr),
        };
      });
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

  const pushNotification = useCallback(
    (n: Omit<AppNotification, "id" | "createdAt" | "read">) =>
      update((d) => ({
        ...d,
        notifications: [{ ...n, id: uid("ntf"), createdAt: new Date().toISOString(), read: false }, ...d.notifications].slice(0, 50),
      })),
    [update],
  );

  const markAllNotificationsRead = useCallback(
    () => update((d) => ({ ...d, notifications: d.notifications.map((n) => ({ ...n, read: true })) })),
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
      signOut, signInGuest, signInAccount, createAccount, resetDemo, loadSample,
      setProfile, completeOnboarding,
      addTransaction, receiveTransfers, updateTransaction,
      replaceMonthBudget, ensureBudget, updateEnvelope, moveEnvelopeMoney, rolloverMonth,
      addGoal, updateGoal, deleteGoal, contributeToGoal, withdrawFromGoal,
      addSubscription, updateSubscription, deleteSubscription,
      addBill, updateBill, deleteBill, markBillPaid,
      addFlowExpense, updateFlowExpense, deleteFlowExpense, initializeFlowExpenses,
      addReminder, updateReminder, deleteReminder, settleReminder,
      addScheduledPayment, updateScheduledPayment, deleteScheduledPayment, recordScheduledRun,
      dismissInsight, addCheckout, updateCheckout, addMessage, clearMessages,
      topUpWallet, payPerson, adjustWallet, pushNotification, markAllNotificationsRead, refresh,
    }),
    [
      session, data, loading, bootError, authNotice, clearAuthNotice, signOut, signInGuest, signInAccount, createAccount,
      resetDemo, loadSample, setProfile, completeOnboarding,
      addTransaction, receiveTransfers, updateTransaction, replaceMonthBudget, ensureBudget,
      updateEnvelope, moveEnvelopeMoney, rolloverMonth, addGoal, updateGoal, deleteGoal, contributeToGoal, withdrawFromGoal,
      addSubscription, updateSubscription, deleteSubscription, addBill, updateBill, deleteBill, markBillPaid,
      addFlowExpense, updateFlowExpense, deleteFlowExpense, initializeFlowExpenses,
      addReminder, updateReminder, deleteReminder, settleReminder, addScheduledPayment, updateScheduledPayment,
      deleteScheduledPayment, recordScheduledRun, dismissInsight, addCheckout, updateCheckout, addMessage,
      clearMessages, topUpWallet, payPerson, adjustWallet, pushNotification, markAllNotificationsRead, refresh,
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
