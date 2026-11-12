import type { Reminder, ScheduledPayment } from "./types";
import type { PayPalCapabilities } from "./auth";
import { getSession } from "./storage";

export interface ApiStatus {
  configured: boolean;
  mode: "sandbox" | "simulated";
  env: "sandbox";
  source?: "env" | "stored" | "user" | "none";
  authenticated: boolean;
  payoutsEnabled: boolean;
  usdRate: number;
  loginMode: "email";
  capabilities: PayPalCapabilities;
}

export const DEFAULT_STATUS: ApiStatus = {
  configured: false,
  mode: "simulated",
  env: "sandbox",
  source: "none",
  authenticated: false,
  payoutsEnabled: false,
  usdRate: 83.2,
  loginMode: "email",
  capabilities: {
    identity: false,
    payerPayments: true,
    personalBalance: false,
    personalTransactions: false,
    businessPayouts: false,
    businessInvoices: false,
  },
};

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string> | undefined) ?? {}),
  };
  // Demo requests are pinned to the sandbox server path.
  if (getSession()?.provider === "demo") headers["x-wg-account"] = "demo";
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

export interface SandboxConnectResult {
  connected: boolean;
  mode: "sandbox" | "simulated";
  source: "env" | "stored" | "user" | "none";
  payoutsEnabled: boolean;
}

// Credentials attach once per account, at onboarding, and cannot be changed or
// removed afterwards (the server enforces this with 409s).
export async function connectPayPalSandbox(clientId: string, clientSecret: string): Promise<SandboxConnectResult> {
  return api<SandboxConnectResult>("/paypal/sandbox/connect", {
    method: "POST",
    body: JSON.stringify({ clientId, clientSecret }),
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
  error?: string;
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
  dueDate?: string;
  reminder?: Reminder;
}): Promise<InvoiceResult> {
  return api<InvoiceResult>("/paypal/invoice", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      name: input.name,
      amountInr: Math.round(input.amountInr),
      description: input.description,
      dueDate: input.dueDate,
    }),
  });
}

// ---- Internal transfers between Wallet Guardian accounts ----
// When a signed-in payer sends money to an email that belongs to another
// account, the server queues a credit here. The receiver's client polls,
// registers the incoming transaction, bumps the wallet balance and consumes.
export interface IncomingTransfer {
  id: string;
  fromEmail: string;
  fromName: string;
  amountInr: number;
  note: string;
  createdAt: string;
}

export async function fetchIncomingTransfers(): Promise<IncomingTransfer[]> {
  const body = await api<{ transfers: IncomingTransfer[] }>("/paypal/transfers");
  return body.transfers;
}

export async function consumeIncomingTransfers(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await api("/paypal/transfers/consume", { method: "POST", body: JSON.stringify({ ids }) });
}

export interface PayoutResult {
  batchId: string;
  status: string;
  simulated: boolean;
  message?: string;
  /** Present when the receiver's email belongs to another Wallet Guardian account. */
  internalTransfer?: { toName: string };
}

export async function sendPayPalPayout(input: {
  email: string;
  name: string;
  amountInr: number;
  note: string;
  payment?: ScheduledPayment;
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
