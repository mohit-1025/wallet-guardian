import type { Profile, Session, UserData } from "./types";
import { backfillLegacyDueDates, dedupeLegacyFlows, enrichTransactions, flowsFromLegacy, flowsFromObligations } from "./flows";
import { buildDemoUser, createEmptyUser } from "./seed";

const PREFIX = "walletGuardian.v1";
const USERS_KEY = `${PREFIX}.users`;
const SESSION_KEY = `${PREFIX}.session`;
const dataKey = (id: string) => `${PREFIX}.data.${id}`;
const THEME_KEY = `${PREFIX}.theme`;
const PREFS_KEY = `${PREFIX}.prefs`;

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn("Wallet Guardian: could not persist", err);
  }
}

export function getUsers(): StoredUser[] {
  return read<StoredUser[]>(USERS_KEY, []);
}

function saveUsers(users: StoredUser[]) {
  write(USERS_KEY, users);
}

export function getSession(): Session | null {
  return read<Session | null>(SESSION_KEY, null);
}

export function saveSession(session: Session | null) {
  if (session) write(SESSION_KEY, session);
  else localStorage.removeItem(SESSION_KEY);
}

export function getUserData(userId: string): UserData | null {
  const data = read<UserData | null>(dataKey(userId), null);
  if (!data) return null;
  const migrated = withFlowMigration(data);
  if (migrated !== data) saveUserData(migrated);
  return migrated;
}

function cleanLabel(value?: string) {
  if (!value) return value;
  let out = value
    .replace(/PayPal batch\s+SIMULATED/gi, "PayPal batch Recorded")
    .replace(/\s*\(sandbox simulation\)/gi, "")
    .replace(/\s*\(simulated\)/gi, "")
    .replace(/\s+via PayPal sandbox/gi, "");
  if (/^(simulated sandbox payout|sandbox payout simulated)$/i.test(out.trim())) out = "Payout recorded";
  return out;
}

// Earlier builds labelled records as sandbox or simulated. Keep stored history
// consistent with the current, uniform wording.
function withLabelCleanup(data: UserData): UserData {
  let changed = false;
  const clean = (value?: string) => {
    const next = cleanLabel(value);
    if (next !== value) changed = true;
    return next;
  };
  const cleanText = (value: string) => clean(value) ?? value;
  const transactions = (Array.isArray(data.transactions) ? data.transactions : []).map((t) => {
    const notes = clean(t.notes);
    const merchant = cleanText(t.merchant);
    return notes === t.notes && merchant === t.merchant ? t : { ...t, notes, merchant };
  });
  const scheduledPayments = (Array.isArray(data.scheduledPayments) ? data.scheduledPayments : []).map((p) => {
    const note = clean(p.note);
    const history = p.history.map((run) => {
      const runNote = clean(run.note);
      return runNote === run.note ? run : { ...run, note: runNote };
    });
    return note === p.note && history.every((run, i) => run === p.history[i]) ? p : { ...p, note, history };
  });
  const patientCheckouts = (Array.isArray(data.patientCheckouts) ? data.patientCheckouts : []).map((c) => {
    const merchant = cleanText(c.merchant);
    return merchant === c.merchant ? c : { ...c, merchant };
  });
  const notifications = (Array.isArray(data.notifications) ? data.notifications : []).map((n) => {
    const title = cleanText(n.title);
    const body = cleanText(n.body);
    return title === n.title && body === n.body ? n : { ...n, title, body };
  });
  if (!changed) return data;
  return { ...data, transactions, scheduledPayments, patientCheckouts, notifications };
}

function withFlowMigration(data: UserData): UserData {
  data = withLabelCleanup(data);
  if (!Array.isArray(data.notifications)) data = { ...data, notifications: [] };
  const raw = Array.isArray(data.flowExpenses) ? data.flowExpenses : [];
  const existing = dedupeLegacyFlows(raw);
  const migrated = flowsFromObligations(data.profile.fixedObligations ?? [], existing);
  const legacy = data.legacyFlowsMerged ? [] : flowsFromLegacy(data.subscriptions ?? [], data.bills ?? [], [...existing, ...migrated]);
  const combined = [...existing, ...migrated, ...legacy];
  const backfilled = backfillLegacyDueDates(combined, data.subscriptions ?? [], data.bills ?? []);
  const transactions = enrichTransactions(Array.isArray(data.transactions) ? data.transactions : []);
  if (
    existing.length === raw.length && migrated.length === 0 && legacy.length === 0 &&
    backfilled === combined && transactions === data.transactions &&
    data.flowsInitialized && data.legacyFlowsMerged
  ) return data;
  return {
    ...data,
    flowExpenses: backfilled,
    transactions,
    flowsInitialized: true,
    legacyFlowsMerged: true,
  };
}

export function saveUserData(data: UserData) {
  localStorage.setItem(dataKey(data.profile.id), JSON.stringify(data));
}

/**
 * Local ledger for an email account. The server owns the account and its
 * session cookie; this only remembers which budget belongs to that account in
 * this browser.
 */
export function signInWithAccount(
  identity: { id: string; name: string; email: string },
  previous: Session | null = null,
): { session: Session; data: UserData } {
  const id = identity.id;
  const users = getUsers();
  const existing = users.find((u) => u.id === id);
  const user: StoredUser = {
    id,
    name: identity.name,
    email: identity.email,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  saveUsers([...users.filter((u) => u.id !== id), user]);

  let data = getUserData(id);
  if (!data) {
    const profile: Profile = {
      id,
      name: identity.name,
      email: identity.email,
      currency: "INR",
      monthlyIncome: 0,
      incomeType: "fixed",
      onboardingComplete: false,
      savingsTarget: 0,
      fixedObligations: [],
      walletBalance: 0,
      createdAt: new Date().toISOString(),
    };
    data = createEmptyUser(profile);
  } else {
    data = { ...data, profile: { ...data.profile, name: identity.name, email: identity.email } };
  }
  saveUserData(data);

  const session: Session = {
    userId: id,
    email: identity.email,
    name: identity.name,
    provider: "email",
    env: "sandbox",
    signedInAt: previous?.userId === id ? previous.signedInAt : new Date().toISOString(),
  };
  saveSession(session);
  return { session, data };
}

const DEMO_ID = "demo_guest";

function saveDemoUser(): StoredUser {
  const users = getUsers();
  const existing = users.find((u) => u.id === DEMO_ID);
  const user: StoredUser = {
    id: DEMO_ID,
    name: "Aarav Mehta",
    email: "aarav@walletguardian.demo",
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  saveUsers([...users.filter((u) => u.id !== DEMO_ID), user]);
  return user;
}

function demoSession(user: StoredUser): Session {
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    provider: "demo",
    env: "sandbox",
    signedInAt: new Date().toISOString(),
  };
}

/**
 * Sandbox demo workspace. It is unauthenticated by design and every payment
 * call is pinned to the sandbox (or labelled simulation) by the server.
 */
export function ensureDemoAccount(): { session: Session; data: UserData } {
  const user = saveDemoUser();
  let data = getUserData(DEMO_ID);
  if (!data || !data.profile.demo) {
    data = withFlowMigration(buildDemoUser());
    saveUserData(data);
  }
  const session = demoSession(user);
  saveSession(session);
  return { session, data };
}

export function resetDemoData(): { session: Session; data: UserData } {
  const user = saveDemoUser();
  const data = withFlowMigration(buildDemoUser());
  saveUserData(data);
  const session = demoSession(user);
  saveSession(session);
  return { session, data };
}

/** Replaces a real user's ledger with the sample workspace, keeping their identity. */
export function loadSampleWorkspace(session: Session): UserData {
  const base = buildDemoUser();
  const data: UserData = withFlowMigration({
    ...base,
    profile: { ...base.profile, id: session.userId, name: session.name, email: session.email, demo: false },
  });
  saveUserData(data);
  return data;
}

export function clearStoredSession() {
  saveSession(null);
}

export function clearAllData() {
  const users = getUsers();
  for (const u of users) localStorage.removeItem(dataKey(u.id));
  localStorage.removeItem(USERS_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export type Theme = "light" | "dark" | "system";

export function getTheme(): Theme {
  return read<Theme>(THEME_KEY, "light");
}
export function saveTheme(theme: Theme) {
  write(THEME_KEY, theme);
}

export function getPrefs(): { reducedMotion?: boolean; hideBalances?: boolean } {
  return read(PREFS_KEY, {});
}
export function savePrefs(prefs: { reducedMotion?: boolean; hideBalances?: boolean }) {
  write(PREFS_KEY, { ...getPrefs(), ...prefs });
}
