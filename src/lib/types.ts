export type Currency = "INR" | "USD" | "EUR";
export type TxType = "income" | "expense";
export type EnvelopeGroup = "necessities" | "wants" | "savings";

export interface Category {
  id: string;
  name: string;
  kind: TxType;
  group: EnvelopeGroup;
  color: string;
  icon: string;
}

export interface Account {
  id: string;
  name: string;
  type: "wallet" | "bank" | "card" | "paypal";
  balance: number; // INR base
}

export interface Transaction {
  id: string;
  type: TxType;
  amount: number; // INR base
  categoryId: string;
  merchant: string;
  date: string; // YYYY-MM-DD
  paymentMethod: string;
  notes?: string;
  receiptName?: string;
  receiptData?: string;
  source: "manual" | "import" | "paypal" | "seed" | "autopay";
  paypalOrderId?: string;
  paypalCaptureId?: string;
  transfer?: boolean;
  createdAt: string;
}

export interface FixedObligation {
  id: string;
  name: string;
  amount: number;
  categoryId: string;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  currency: Currency;
  monthlyIncome: number;
  incomeType: "fixed" | "irregular";
  onboardingComplete: boolean;
  savingsTarget: number;
  fixedObligations: FixedObligation[];
  walletBalance: number;
  createdAt: string;
  /** True only for the sandbox demo workspace. Real PayPal accounts never set it. */
  demo?: boolean;
}

export interface Budget {
  id: string;
  month: string; // YYYY-MM
  income: number;
  split: { necessities: number; wants: number; savings: number };
  rollover: number;
  note?: string;
  createdAt: string;
}

export interface BudgetEnvelope {
  id: string;
  budgetId: string;
  name: string;
  group: EnvelopeGroup;
  categoryId?: string;
  allocated: number;
  icon?: string;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  deadline: string;
  icon: string;
  color: string;
  createdAt: string;
  autoMonthly?: number;
}

export interface Subscription {
  id: string;
  name: string;
  cost: number;
  cycle: "monthly" | "yearly";
  nextBillingDate: string;
  category: string;
  status: "active" | "cancelled";
  lastUsedDaysAgo: number;
  duplicateGroup?: string;
  priceHistory: { date: string; price: number }[];
  createdAt: string;
}

export interface Bill {
  id: string;
  title: string;
  kind: "bill" | "emi" | "ticket";
  amount: number;
  dueDate: string;
  status: "upcoming" | "due" | "paid" | "overdue";
  paidAt?: string;
  autopay?: boolean;
  createdAt: string;
}

export interface Reminder {
  id: string;
  direction: "owe" | "owed";
  person: string;
  email?: string;
  amount: number;
  dueDate: string;
  status: "open" | "settled";
  note?: string;
  paypalInvoiceId?: string;
  paypalInvoiceUrl?: string;
  createdAt: string;
}

export interface PaymentRun {
  id: string;
  date: string;
  amount: number;
  status: "paid" | "pending" | "failed" | "simulated";
  paypalBatchId?: string;
  note?: string;
}

export interface ScheduledPayment {
  id: string;
  payeeName: string;
  payeeEmail: string;
  amount: number;
  frequency: "once" | "weekly" | "monthly";
  startDate: string;
  endDate?: string;
  status: "active" | "paused" | "cancelled" | "completed";
  nextRunDate: string;
  category: string;
  note?: string;
  history: PaymentRun[];
  createdAt: string;
}

export type InsightType =
  | "overspend"
  | "unusual"
  | "subscription"
  | "cashflow"
  | "savings"
  | "positive";

export interface AiInsight {
  id: string;
  type: InsightType;
  severity: "info" | "warning" | "critical" | "positive";
  title: string;
  body: string;
  reason: string;
  actionLabel: string;
  actionHref?: string;
  amount?: number;
  createdAt: string;
  dismissed?: boolean;
}

export interface PatientCheckout {
  id: string;
  merchant: string;
  item: string;
  amount: number;
  status: "authorized" | "captured" | "voided" | "expired";
  authorizedAt: string;
  captureBy: string;
  categoryId?: string;
  paypalOrderId?: string;
  authorizationId?: string;
  captureId?: string;
  simulated?: boolean;
}

export interface MockPrice {
  id: string;
  productId: string;
  retailer: string;
  price: number;
  shipping: number;
  deliveryDays: number;
  rating: number;
  returnDays: number;
  trustScore: number;
  inStock: boolean;
  history: number[];
}

export interface MockProduct {
  id: string;
  name: string;
  brand: string;
  category: string;
  emoji: string;
  description: string;
  tags: string[];
}

export interface MockOffer {
  id: string;
  merchant: string;
  title: string;
  description: string;
  category: string;
  discount: string;
  code?: string;
  expiresAt: string;
  minSpend?: number;
}

export interface GuardianMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  createdAt: string;
  suggestions?: string[];
}

export interface UserData {
  profile: Profile;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  envelopes: BudgetEnvelope[];
  goals: Goal[];
  subscriptions: Subscription[];
  bills: Bill[];
  reminders: Reminder[];
  scheduledPayments: ScheduledPayment[];
  insights: AiInsight[];
  dismissedInsights: string[];
  patientCheckouts: PatientCheckout[];
  messages: GuardianMessage[];
  products: MockProduct[];
  prices: MockPrice[];
  offers: MockOffer[];
  seeded: boolean;
}

export interface Session {
  userId: string;
  email: string;
  name: string;
  provider: "paypal" | "demo";
  payerId?: string;
  env: "live" | "sandbox";
  verified?: boolean;
  accountStatus?: string;
  signedInAt: string;
}
