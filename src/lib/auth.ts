import { clearStoredSession } from "./storage";

export type PayPalEnv = "live" | "sandbox";

export interface PayPalIdentity {
  payerId: string;
  email: string;
  name: string;
  verified?: boolean;
  accountStatus?: string;
}

export interface PayPalCapabilities {
  identity: boolean;
  payerPayments: boolean;
  personalBalance: boolean;
  personalTransactions: boolean;
  businessPayouts: boolean;
  businessInvoices: boolean;
  businessReporting: boolean;
}

export interface PayPalSession {
  user: PayPalIdentity;
  env: PayPalEnv;
  expiresAt: number;
}

export interface PayPalAccount extends PayPalSession {
  capabilities: PayPalCapabilities;
  fresh: boolean;
  note: string;
}

function identityFrom(raw: Record<string, unknown>): PayPalIdentity {
  return {
    payerId: String(raw.payerId || ""),
    email: String(raw.email || ""),
    name: String(raw.name || raw.email || "PayPal member"),
    verified: typeof raw.verified === "boolean" ? raw.verified : undefined,
    accountStatus: raw.accountStatus ? String(raw.accountStatus) : undefined,
  };
}

export class AuthUnavailableError extends Error {
  constructor(message = "The Wallet Guardian server is unreachable.") {
    super(message);
    this.name = "AuthUnavailableError";
  }
}

export async function fetchPayPalSession(): Promise<PayPalSession | null> {
  let res: Response;
  try {
    res = await fetch("/api/auth/me", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new AuthUnavailableError();
  }
  if (res.status === 401) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.authenticated || !body?.user) {
    throw new AuthUnavailableError("Could not verify your PayPal session.");
  }
  const user = body.user;
  if (!user.payerId || !user.email) throw new AuthUnavailableError("PayPal returned an incomplete profile.");
  if (body.env !== "live") throw new AuthUnavailableError("This server is not running live PayPal.");
  return {
    user: identityFrom(user),
    env: "live",
    expiresAt: Number(body.expiresAt) || 0,
  };
}

export async function fetchPayPalAccount(): Promise<PayPalAccount | null> {
  let res: Response;
  try {
    res = await fetch("/api/paypal/account", {
      credentials: "same-origin",
      headers: { Accept: "application/json", "x-wg-account": "paypal" },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (!body?.linked || !body?.user) return null;
  if (body.env !== "live") return null;
  return {
    user: identityFrom(body.user),
    env: "live",
    expiresAt: 0,
    capabilities: body.capabilities,
    fresh: Boolean(body.fresh),
    note: String(body.note || ""),
  };
}

export function startPayPalLogin() {
  // Drop any local demo session so the PayPal identity returned by the callback wins.
  clearStoredSession();
  window.location.assign("/api/auth/paypal/start");
}

export async function endPayPalSession() {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    // Server unreachable: the local session is cleared anyway, and the httpOnly cookie expires on its own.
  }
}
