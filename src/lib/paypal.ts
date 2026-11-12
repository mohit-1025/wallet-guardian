import type { Reminder, ScheduledPayment } from "./types";
import type { PayPalCapabilities } from "./auth";
import { getSession } from "./storage";

export interface ApiStatus {
  configured: boolean;
  clientId: string | null;
  mode: "live" | "sandbox" | "simulated" | "unconfigured";
  env: "live" | "sandbox";
  authenticated: boolean;
  payoutsEnabled: boolean;
  usdRate: number;
  loginMode: "sandbox" | "live" | "unconfigured";
  loginConfigured: boolean;
  capabilities: PayPalCapabilities;
}

export const DEFAULT_STATUS: ApiStatus = {
  configured: false,
  clientId: null,
  mode: "unconfigured",
  env: "live",
  authenticated: false,
  payoutsEnabled: false,
  usdRate: 83.2,
  loginMode: "unconfigured",
  loginConfigured: false,
  capabilities: {
    identity: true,
    payerPayments: true,
    personalBalance: false,
    personalTransactions: false,
    businessPayouts: false,
    businessInvoices: false,
    businessReporting: false,
  },
};

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string> | undefined) ?? {}),
  };
  // Tells the server which account sent the request: a demo header is pinned to
  // the sandbox, while a real PayPal session can never fall back to simulation.
  const account = getSession()?.provider;
  if (account === "demo" || account === "paypal") headers["x-wg-account"] = account;
  const res = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export async function getIntegrationStatus(): Promise<ApiStatus> {
  try {
    return await api<ApiStatus>("/paypal/status");
  } catch {
    return { ...DEFAULT_STATUS };
  }
}

export interface PayPalSetupStatus {
  configured: boolean;
  source: "env" | "database" | null;
  env: "live";
  clientIdHint: string | null;
  redirectUri: string;
  canEdit: boolean;
}

export async function getPayPalSetupStatus(): Promise<PayPalSetupStatus> {
  return api<PayPalSetupStatus>("/setup/paypal");
}

export async function connectPayPalApp(input: {
  clientId: string;
  clientSecret: string;
}): Promise<{ ok: boolean; configured: boolean; source: "database" }> {
  return api("/setup/paypal", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface PayPalOrderResult {
  id: string;
  status: string;
  simulated: boolean;
  approvalUrl?: string;
  captureId?: string;
  authorizationId?: string;
  message?: string;
}

export async function createPayPalOrder(input: {
  amountInr: number;
  intent: "CAPTURE" | "AUTHORIZE";
  description: string;
}): Promise<PayPalOrderResult> {
  return api<PayPalOrderResult>("/paypal/order", {
    method: "POST",
    body: JSON.stringify({
      amountInr: Math.round(input.amountInr),
      intent: input.intent,
      description: input.description,
    }),
  });
}

export async function capturePayPalOrder(orderId: string): Promise<PayPalOrderResult> {
  return api<PayPalOrderResult>(`/paypal/order/${encodeURIComponent(orderId)}/capture`, { method: "POST" });
}

export async function authorizePayPalOrder(orderId: string): Promise<PayPalOrderResult> {
  return api<PayPalOrderResult>(`/paypal/order/${encodeURIComponent(orderId)}/authorize`, { method: "POST" });
}

export async function captureAuthorization(authorizationId: string): Promise<PayPalOrderResult> {
  return api<PayPalOrderResult>(`/paypal/authorization/${encodeURIComponent(authorizationId)}/capture`, { method: "POST" });
}

export async function voidAuthorization(authorizationId: string) {
  return api<{ id: string; status: string; simulated: boolean }>(`/paypal/authorization/${encodeURIComponent(authorizationId)}/void`, { method: "POST" });
}

export interface InvoiceResult {
  invoiceId: string;
  status: string;
  simulated: boolean;
  invoiceUrl?: string;
  message?: string;
}

export async function createPayPalInvoice(input: {
  email: string;
  name: string;
  amountInr: number;
  description: string;
  reminder?: Reminder;
}): Promise<InvoiceResult> {
  return api<InvoiceResult>("/paypal/invoice", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      name: input.name,
      amountInr: Math.round(input.amountInr),
      description: input.description,
    }),
  });
}

export interface ReportBalance {
  currency: string;
  total: number;
  available: number;
  withheld: number;
}

export interface ReportTransaction {
  id: string;
  date: string;
  eventCode: string;
  status: string;
  amount: number;
  currency: string;
  fee: number;
  subject: string;
  payerName: string;
  payerEmail: string;
  outgoing: boolean;
}

export interface ReportingOverview {
  accountId: string | null;
  asOfTime: string | null;
  refreshedAt: string | null;
  balances: ReportBalance[];
  transactions: ReportTransaction[];
  totalTransactions: number;
  range: { start: string; end: string };
  env: "sandbox" | "live";
  note: string;
}

export async function fetchPayPalReporting(): Promise<ReportingOverview> {
  return api<ReportingOverview>("/paypal/reporting/overview");
}

export interface PayoutResult {
  batchId: string;
  status: string;
  simulated: boolean;
  message?: string;
}

export async function sendPayPalPayout(input: {
  email: string;
  name: string;
  amountInr: number;
  note: string;
  payment: ScheduledPayment;
}): Promise<PayoutResult> {
  return api<PayoutResult>("/paypal/payout", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      name: input.name,
      amountInr: Math.round(input.amountInr),
      note: input.note,
    }),
  });
}
