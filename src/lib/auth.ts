export interface AccountUser {
  id: string;
  email: string;
  name: string;
  createdAt?: string;
}

export interface PayPalCapabilities {
  identity: boolean;
  payerPayments: boolean;
  personalBalance: boolean;
  personalTransactions: boolean;
  businessPayouts: boolean;
  businessInvoices: boolean;
}

export interface AccountSession {
  user: AccountUser;
  env: "sandbox";
  expiresAt: number;
  capabilities?: PayPalCapabilities;
}

export class AuthUnavailableError extends Error {
  constructor(message = "The Wallet Guardian server is unreachable.") {
    super(message);
    this.name = "AuthUnavailableError";
  }
}

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`/api${path}`, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AuthUnavailableError();
  }
}

function toSession(body: Record<string, unknown> | null): AccountSession {
  const user = body?.user as AccountUser | undefined;
  if (!body?.authenticated || !user?.id || !user.email) {
    throw new AuthUnavailableError("Could not verify your account.");
  }
  if (body.env !== "sandbox") throw new AuthUnavailableError("This server is not running in sandbox mode.");
  return {
    user,
    env: "sandbox",
    expiresAt: Number(body.expiresAt) || 0,
    capabilities: body.capabilities as PayPalCapabilities | undefined,
  };
}

export async function loginAccount(email: string, password: string): Promise<AccountSession> {
  const res = await authFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "Email or password is incorrect.");
  return toSession(body);
}

export async function registerAccount(name: string, email: string, password: string): Promise<AccountSession> {
  const res = await authFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "Could not create the account.");
  return toSession(body);
}

export async function fetchAccountSession(): Promise<AccountSession | null> {
  const res = await authFetch("/auth/me");
  if (res.status === 401) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new AuthUnavailableError("Could not verify your account.");
  return toSession(body);
}

export async function endAccountSession(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    // Server unreachable: the local session is cleared anyway, and the httpOnly cookie expires on its own.
  }
}
