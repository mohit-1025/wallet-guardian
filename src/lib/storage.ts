import type { Profile, Session, UserData } from "./types";
import { buildDemoUser, createEmptyUser } from "./seed";
import type { PayPalIdentity } from "./auth";

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
  payerId?: string;
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
  return read<UserData | null>(dataKey(userId), null);
}

export function saveUserData(data: UserData) {
  write(dataKey(data.profile.id), data);
}

function paypalUserId(payerId: string) {
  return `paypal_${payerId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48)}`;
}

/**
 * Local ledger for a PayPal login. The server owns the real PayPal identity and
 * session; this only remembers which budget belongs to that payer in this browser.
 */
export function signInWithPayPal(
  identity: PayPalIdentity,
  previous: Session | null = null,
): { session: Session; data: UserData } {
  const id = paypalUserId(identity.payerId);
  const users = getUsers();
  const existing = users.find((u) => u.id === id);
  const user: StoredUser = {
    id,
    name: identity.name,
    email: identity.email,
    payerId: identity.payerId,
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
    provider: "paypal",
    payerId: identity.payerId,
    env: "live",
    verified: identity.verified,
    accountStatus: identity.accountStatus,
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
    data = buildDemoUser();
    saveUserData(data);
  }
  const session = demoSession(user);
  saveSession(session);
  return { session, data };
}

export function resetDemoData(): { session: Session; data: UserData } {
  const user = saveDemoUser();
  const data = buildDemoUser();
  saveUserData(data);
  const session = demoSession(user);
  saveSession(session);
  return { session, data };
}

/** Replaces a real user's ledger with the sample workspace, keeping their identity. */
export function loadSampleWorkspace(session: Session): UserData {
  const base = buildDemoUser();
  const data: UserData = {
    ...base,
    profile: { ...base.profile, id: session.userId, name: session.name, email: session.email, demo: false },
  };
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
  return read<Theme>(THEME_KEY, "system");
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
