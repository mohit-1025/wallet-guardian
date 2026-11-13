import type {
  Account,
  Bill,
  Goal,
  MockOffer,
  MockPrice,
  MockProduct,
  Profile,
  Reminder,
  ScheduledPayment,
  Subscription,
  Transaction,
  UserData,
} from "./types";
import { DEFAULT_CATEGORIES } from "./categories";
import { addDaysISO, addMonthsISO, lastNMonths, nextOccurrence, format, todayISO } from "./dates";
import { generateBudget } from "./finance";
import { uid } from "./utils";

const pad = (n: number) => String(n).padStart(2, "0");
const dayISO = (key: string, day: number) => `${key}-${pad(Math.min(day, 28))}`;

interface TxSeed {
  type: "income" | "expense";
  amount: number;
  categoryId: string;
  merchant: string;
  day: number;
  method?: string;
  notes?: string;
}

const MONTHLY_FIXED: TxSeed[] = [
  { type: "income", amount: 85000, categoryId: "cat_salary", merchant: "Nimbus Labs — Salary", day: 1, method: "Bank transfer", notes: "Monthly salary credit" },
  { type: "expense", amount: 22000, categoryId: "cat_rent", merchant: "Rakesh Sharma (Rent)", day: 2, method: "UPI", notes: "2BHK, Koramangala" },
  { type: "expense", amount: 8500, categoryId: "cat_emi", merchant: "Bajaj Finance EMI", day: 5, method: "Auto-debit" },
  { type: "expense", amount: 799, categoryId: "cat_utilities", merchant: "Airtel Fibre", day: 3, method: "Auto-pay" },
];

const MONTHLY_VARIABLE: TxSeed[] = [
  { type: "expense", amount: 3250, categoryId: "cat_groceries", merchant: "BigBasket", day: 3, method: "Card" },
  { type: "expense", amount: 1480, categoryId: "cat_groceries", merchant: "Zepto", day: 9, method: "UPI" },
  { type: "expense", amount: 2450, categoryId: "cat_groceries", merchant: "DMart", day: 11, method: "Card" },
  { type: "expense", amount: 480, categoryId: "cat_food", merchant: "Swiggy", day: 2, method: "UPI" },
  { type: "expense", amount: 720, categoryId: "cat_food", merchant: "Zomato", day: 6, method: "UPI" },
  { type: "expense", amount: 1850, categoryId: "cat_food", merchant: "Swiggy", day: 11, method: "Card", notes: "Late-night group order" },
  { type: "expense", amount: 310, categoryId: "cat_transport", merchant: "Uber", day: 4, method: "UPI" },
  { type: "expense", amount: 600, categoryId: "cat_transport", merchant: "Namma Metro", day: 8, method: "Card" },
  { type: "expense", amount: 649, categoryId: "cat_subscriptions", merchant: "Netflix", day: 5, method: "Card" },
  { type: "expense", amount: 119, categoryId: "cat_subscriptions", merchant: "Spotify", day: 8, method: "UPI" },
  { type: "expense", amount: 1675, categoryId: "cat_subscriptions", merchant: "Adobe Creative Cloud", day: 10, method: "Card" },
  { type: "expense", amount: 599, categoryId: "cat_subscriptions", merchant: "Adobe Express", day: 11, method: "Card" },
  { type: "expense", amount: 760, categoryId: "cat_entertainment", merchant: "PVR Cinemas", day: 7, method: "Card" },
  { type: "expense", amount: 7500, categoryId: "cat_health", merchant: "Dental Care Clinic", day: 9, method: "Card", notes: "Root canal — one-off" },
  { type: "expense", amount: 450, categoryId: "cat_personal", merchant: "Nykaa", day: 10, method: "UPI" },
];

const PREV_VARIABLE: TxSeed[] = [
  { type: "expense", amount: 4100, categoryId: "cat_groceries", merchant: "BigBasket", day: 4 },
  { type: "expense", amount: 1620, categoryId: "cat_groceries", merchant: "Zepto", day: 11 },
  { type: "expense", amount: 3450, categoryId: "cat_groceries", merchant: "DMart", day: 18 },
  { type: "expense", amount: 1150, categoryId: "cat_groceries", merchant: "Blinkit", day: 25 },
  { type: "expense", amount: 510, categoryId: "cat_food", merchant: "Swiggy", day: 2 },
  { type: "expense", amount: 890, categoryId: "cat_food", merchant: "Zomato", day: 8 },
  { type: "expense", amount: 1450, categoryId: "cat_food", merchant: "Social", day: 17, notes: "Dinner with friends" },
  { type: "expense", amount: 640, categoryId: "cat_food", merchant: "Swiggy", day: 26 },
  { type: "expense", amount: 390, categoryId: "cat_transport", merchant: "Uber", day: 5 },
  { type: "expense", amount: 600, categoryId: "cat_transport", merchant: "Namma Metro", day: 14 },
  { type: "expense", amount: 180, categoryId: "cat_transport", merchant: "Rapido", day: 23 },
  { type: "expense", amount: 649, categoryId: "cat_subscriptions", merchant: "Netflix", day: 5 },
  { type: "expense", amount: 119, categoryId: "cat_subscriptions", merchant: "Spotify", day: 8 },
  { type: "expense", amount: 1675, categoryId: "cat_subscriptions", merchant: "Adobe Creative Cloud", day: 10 },
  { type: "expense", amount: 599, categoryId: "cat_subscriptions", merchant: "Adobe Express", day: 12 },
  { type: "expense", amount: 1499, categoryId: "cat_subscriptions", merchant: "Cult.fit", day: 20 },
  { type: "expense", amount: 299, categoryId: "cat_subscriptions", merchant: "Prime Video", day: 26 },
  { type: "expense", amount: 1780, categoryId: "cat_utilities", merchant: "Tata Power", day: 12 },
  { type: "expense", amount: 24990, categoryId: "cat_shopping", merchant: "Croma", day: 21, notes: "Phone upgrade" },
  { type: "expense", amount: 900, categoryId: "cat_entertainment", merchant: "PVR Cinemas", day: 12 },
  { type: "expense", amount: 480, categoryId: "cat_health", merchant: "Apollo Pharmacy", day: 9 },
  { type: "expense", amount: 1299, categoryId: "cat_education", merchant: "Udemy", day: 16 },
  { type: "expense", amount: 3800, categoryId: "cat_travel", merchant: "Goibibo", day: 3, notes: "Weekend trip to Coorg" },
  { type: "expense", amount: 1240, categoryId: "cat_personal", merchant: "Nykaa", day: 20 },
];

const OLD_VARIABLE: TxSeed[] = [
  { type: "expense", amount: 4850, categoryId: "cat_groceries", merchant: "BigBasket", day: 4 },
  { type: "expense", amount: 1340, categoryId: "cat_groceries", merchant: "Zepto", day: 12 },
  { type: "expense", amount: 3120, categoryId: "cat_groceries", merchant: "DMart", day: 19 },
  { type: "expense", amount: 980, categoryId: "cat_groceries", merchant: "Blinkit", day: 26 },
  { type: "expense", amount: 420, categoryId: "cat_food", merchant: "Swiggy", day: 3 },
  { type: "expense", amount: 650, categoryId: "cat_food", merchant: "Zomato", day: 9 },
  { type: "expense", amount: 380, categoryId: "cat_food", merchant: "Third Wave Coffee", day: 18 },
  { type: "expense", amount: 720, categoryId: "cat_food", merchant: "Domino's", day: 24 },
  { type: "expense", amount: 340, categoryId: "cat_transport", merchant: "Uber", day: 6 },
  { type: "expense", amount: 600, categoryId: "cat_transport", merchant: "Namma Metro", day: 15 },
  { type: "expense", amount: 280, categoryId: "cat_transport", merchant: "Ola", day: 22 },
  { type: "expense", amount: 649, categoryId: "cat_subscriptions", merchant: "Netflix", day: 6 },
  { type: "expense", amount: 119, categoryId: "cat_subscriptions", merchant: "Spotify", day: 10 },
  { type: "expense", amount: 1675, categoryId: "cat_subscriptions", merchant: "Adobe Creative Cloud", day: 12 },
  { type: "expense", amount: 599, categoryId: "cat_subscriptions", merchant: "Adobe Express", day: 15 },
  { type: "expense", amount: 1499, categoryId: "cat_subscriptions", merchant: "Cult.fit", day: 20 },
  { type: "expense", amount: 179, categoryId: "cat_subscriptions", merchant: "Prime Video", day: 26 },
  { type: "expense", amount: 1950, categoryId: "cat_utilities", merchant: "Tata Power", day: 12 },
  { type: "expense", amount: 1899, categoryId: "cat_shopping", merchant: "Myntra", day: 21 },
  { type: "expense", amount: 700, categoryId: "cat_entertainment", merchant: "BookMyShow", day: 28 },
  { type: "expense", amount: 2900, categoryId: "cat_education", merchant: "Coursera", day: 11 },
  { type: "expense", amount: 600, categoryId: "cat_personal", merchant: "Truefitt & Hill", day: 25 },
];

const EXTRA_INCOME = [
  { amount: 12000, merchant: "Freelance — Brightline Studio", day: 14, notes: "Brand identity project" },
  { amount: 320, merchant: "Savings account interest", day: 28 },
  { amount: 18000, merchant: "Freelance — Kite Labs", day: 18, notes: "Landing page build" },
  { amount: 340, merchant: "Savings account interest", day: 31 },
  { amount: 9500, merchant: "Freelance — Brightline Studio", day: 6, notes: "Retainer" },
];

const CATEGORY_METHODS: Record<string, string> = {
  cat_rent: "UPI",
  cat_groceries: "Card",
  cat_food: "UPI",
  cat_transport: "UPI",
  cat_utilities: "Auto-pay",
  cat_education: "Card",
  cat_emi: "Auto-debit",
  cat_shopping: "Card",
  cat_entertainment: "Card",
  cat_subscriptions: "Card",
  cat_health: "Card",
  cat_travel: "Card",
  cat_personal: "UPI",
};

export function buildDemoUser(): UserData {
  const months = lastNMonths(3);
  const [old, prev, cur] = months;
  const todayDay = new Date().getDate();

  const transactions: Transaction[] = [];
  const addTx = (tx: TxSeed, key: string, opts: Partial<Transaction> = {}) => {
    if (key === cur && tx.day > todayDay) return;
    transactions.push({
      id: uid("tx"),
      type: tx.type,
      amount: tx.amount,
      categoryId: tx.categoryId,
      merchant: tx.merchant,
      date: dayISO(key, tx.day),
      paymentMethod: tx.method ?? CATEGORY_METHODS[tx.categoryId] ?? "UPI",
      notes: tx.notes,
      source: "seed",
      createdAt: new Date().toISOString(),
      ...opts,
    });
  };

  for (const key of months) {
    for (const tx of MONTHLY_FIXED) addTx(tx, key);
    const variable = key === cur ? MONTHLY_VARIABLE : key === prev ? PREV_VARIABLE : OLD_VARIABLE;
    for (const tx of variable) addTx(tx, key);
  }

  addTx({ type: "income", amount: 12000, categoryId: "cat_freelance", merchant: EXTRA_INCOME[0].merchant, day: 14, notes: EXTRA_INCOME[0].notes }, old);
  addTx({ type: "income", amount: 320, categoryId: "cat_refunds", merchant: "Savings account interest", day: 28 }, old);
  addTx({ type: "income", amount: 18000, categoryId: "cat_freelance", merchant: EXTRA_INCOME[2].merchant, day: 18, notes: EXTRA_INCOME[2].notes }, prev);
  addTx({ type: "income", amount: 340, categoryId: "cat_refunds", merchant: "Savings account interest", day: 28 }, prev);
  addTx({ type: "income", amount: 2499, categoryId: "cat_refunds", merchant: "Amazon refund", day: 29, notes: "Returned headphones" }, prev);
  addTx({ type: "income", amount: 9500, categoryId: "cat_freelance", merchant: EXTRA_INCOME[4].merchant, day: 6, notes: EXTRA_INCOME[4].notes }, cur);

  transactions.push(
    {
      id: uid("tx"), type: "income", amount: 5000, categoryId: "cat_refunds", merchant: "PayPal wallet top-up",
      date: addDaysISO(todayISO(), -11), paymentMethod: "PayPal", notes: "Wallet transfer — excluded from income analytics",
      source: "paypal", paypalOrderId: "SIM-ORDER-SEED01", paypalCaptureId: "SIM-CAPTURE-SEED01", transfer: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: uid("tx"), type: "expense", amount: 1200, categoryId: "cat_other", merchant: "Rohan Kapoor",
      date: addDaysISO(todayISO(), -9), paymentMethod: "PayPal", notes: "Concert ticket split",
      source: "paypal", paypalOrderId: "SIM-ORDER-SEED02", paypalCaptureId: "SIM-CAPTURE-SEED02",
      createdAt: new Date().toISOString(),
    },
  );

  transactions.sort((a, b) => b.date.localeCompare(a.date));

  const profile: Profile = {
    id: "demo_guest",
    name: "Aarav Mehta",
    email: "aarav@walletguardian.demo",
    currency: "INR",
    monthlyIncome: 85000,
    incomeType: "fixed",
    onboardingComplete: true,
    savingsTarget: 15000,
    fixedObligations: [
      { id: "ob_rent", name: "Rent", amount: 22000, categoryId: "cat_rent" },
      { id: "ob_emi", name: "Student loan EMI", amount: 8500, categoryId: "cat_emi" },
      { id: "ob_internet", name: "Internet", amount: 799, categoryId: "cat_utilities" },
    ],
    walletBalance: 14500,
    createdAt: new Date().toISOString(),
    demo: true,
  };

  const budgets = [];
  const envelopes = [];
  for (const key of months) {
    const plan = generateBudget(profile, transactions.filter((t) => t.date < `${key}-01`), DEFAULT_CATEGORIES, key);
    budgets.push(plan.budget);
    envelopes.push(...plan.envelopes);
  }

  const subs: Subscription[] = [
    {
      id: "sub_netflix", name: "Netflix", cost: 649, cycle: "monthly",
      nextBillingDate: addDaysISO(todayISO(), 5), category: "Entertainment", status: "active", lastUsedDaysAgo: 2,
      priceHistory: [{ date: addMonthsISO(dayISO(cur, 1), -4), price: 599 }, { date: addMonthsISO(dayISO(cur, 1), -2), price: 649 }],
      createdAt: addMonthsISO(dayISO(cur, 1), -18),
    },
    {
      id: "sub_spotify", name: "Spotify Premium", cost: 119, cycle: "monthly",
      nextBillingDate: addDaysISO(todayISO(), 8), category: "Entertainment", status: "active", lastUsedDaysAgo: 1,
      priceHistory: [{ date: addMonthsISO(dayISO(cur, 1), -12), price: 119 }],
      createdAt: addMonthsISO(dayISO(cur, 1), -24),
    },
    {
      id: "sub_adobe_cc", name: "Adobe Creative Cloud", cost: 1675, cycle: "monthly",
      nextBillingDate: addDaysISO(todayISO(), 10), category: "Productivity", status: "active", lastUsedDaysAgo: 13,
      duplicateGroup: "adobe",
      priceHistory: [{ date: addMonthsISO(dayISO(cur, 1), -15), price: 1675 }],
      createdAt: addMonthsISO(dayISO(cur, 1), -15),
    },
    {
      id: "sub_adobe_express", name: "Adobe Express", cost: 599, cycle: "monthly",
      nextBillingDate: addDaysISO(todayISO(), 12), category: "Productivity", status: "active", lastUsedDaysAgo: 44,
      duplicateGroup: "adobe",
      priceHistory: [{ date: addMonthsISO(dayISO(cur, 1), -6), price: 599 }],
      createdAt: addMonthsISO(dayISO(cur, 1), -6),
    },
    {
      id: "sub_cultfit", name: "Cult.fit Pass", cost: 1499, cycle: "monthly",
      nextBillingDate: addDaysISO(todayISO(), 14), category: "Fitness", status: "active", lastUsedDaysAgo: 78,
      priceHistory: [{ date: addMonthsISO(dayISO(cur, 1), -9), price: 1499 }],
      createdAt: addMonthsISO(dayISO(cur, 1), -9),
    },
    {
      id: "sub_prime", name: "Prime Video", cost: 299, cycle: "monthly",
      nextBillingDate: addDaysISO(todayISO(), 16), category: "Entertainment", status: "active", lastUsedDaysAgo: 9,
      priceHistory: [{ date: addMonthsISO(dayISO(cur, 1), -8), price: 179 }, { date: addMonthsISO(dayISO(cur, 1), -1), price: 299 }],
      createdAt: addMonthsISO(dayISO(cur, 1), -8),
    },
  ];

  const bills: Bill[] = [
    { id: "bill_electricity", title: "Electricity — Tata Power", kind: "bill", amount: 1850, dueDate: addDaysISO(todayISO(), 6), status: "upcoming", createdAt: dayISO(cur, 1) },
    { id: "bill_broadband", title: "Airtel broadband", kind: "bill", amount: 999, dueDate: addDaysISO(todayISO(), -4), status: "overdue", createdAt: dayISO(cur, 1) },
    { id: "bill_irctc", title: "Train ticket — IRCTC", kind: "ticket", amount: 2400, dueDate: addDaysISO(todayISO(), 16), status: "upcoming", createdAt: dayISO(cur, 2) },
    { id: "bill_emi_next", title: "Student loan EMI", kind: "emi", amount: 8500, dueDate: addMonthsISO(`${cur}-05`, 1), status: "upcoming", autopay: true, createdAt: dayISO(cur, 1) },
    { id: "bill_power_prev", title: "Electricity — Tata Power", kind: "bill", amount: 1780, dueDate: `${prev}-18`, status: "paid", paidAt: `${prev}-17`, createdAt: `${prev}-01` },
  ];

  const reminders: Reminder[] = [
    { id: "rem_rohan", direction: "owe", person: "Rohan Kapoor", email: "rohan.k@example.com", amount: 1200, dueDate: addDaysISO(todayISO(), 3), status: "open", note: "Concert ticket split", createdAt: dayISO(cur, 1) },
    { id: "rem_priya", direction: "owed", person: "Priya Nair", email: "priya.n@example.com", amount: 3500, dueDate: addDaysISO(todayISO(), 8), status: "open", note: "Freelance design work", createdAt: dayISO(cur, 2) },
    { id: "rem_neha", direction: "owe", person: "Neha Gupta", email: "neha.g@example.com", amount: 800, dueDate: addDaysISO(todayISO(), -3), status: "open", note: "Dinner split", createdAt: dayISO(cur, 1) },
  ];

  const today = new Date();
  const rentStart = addMonthsISO(`${cur}-02`, -3);
  const scheduledPayments: ScheduledPayment[] = [
    {
      id: "sp_rent", payeeName: "Rakesh Sharma", payeeEmail: "rakesh.sharma@example.com", amount: 22000,
      frequency: "monthly", startDate: rentStart, status: "active", nextRunDate: format(nextOccurrence(2, today), "yyyy-MM-dd"),
      category: "Housing", note: "Monthly rent — Koramangala",
      history: [
        { id: uid("run"), date: `${prev}-02`, amount: 22000, status: "paid", note: "Payout recorded" },
        { id: uid("run"), date: `${old}-02`, amount: 22000, status: "paid", note: "Payout recorded" },
      ],
      createdAt: rentStart,
    },
    {
      id: "sp_music", payeeName: "Meera Iyer", payeeEmail: "meera.iyer@example.com", amount: 2500,
      frequency: "monthly", startDate: addMonthsISO(`${cur}-10`, -2), status: "paused", nextRunDate: addDaysISO(`${cur}-10`, 30),
      category: "Education", note: "Guitar lessons",
      history: [{ id: uid("run"), date: `${prev}-10`, amount: 2500, status: "paid", note: "Paused by you" }],
      createdAt: addMonthsISO(`${cur}-10`, -2),
    },
  ];

  const goals: Goal[] = [
    { id: "goal_emergency", name: "Emergency fund", target: 150000, saved: 96000, deadline: addMonthsISO(todayISO(), 7), icon: "shield", color: "#059669", autoMonthly: 9000, createdAt: addMonthsISO(`${cur}-01`, -8) },
    { id: "goal_japan", name: "Japan trip", target: 200000, saved: 38500, deadline: addMonthsISO(todayISO(), 4), icon: "plane", color: "#4f46e5", autoMonthly: 4000, createdAt: addMonthsISO(`${cur}-01`, -3) },
  ];

  const accounts: Account[] = [
    { id: "acc_paypal", name: "PayPal Wallet", type: "paypal", balance: 14500 },
    { id: "acc_bank", name: "HDFC Savings", type: "bank", balance: 48300 },
    { id: "acc_card", name: "HDFC Credit Card", type: "card", balance: -3200 },
  ];

  const { products, prices } = buildCatalog();

  return {
    profile,
    accounts,
    categories: DEFAULT_CATEGORIES,
    transactions,
    budgets,
    envelopes,
    goals,
    subscriptions: subs,
    bills,
    flowExpenses: [],
    reminders,
    scheduledPayments,
    insights: [],
    dismissedInsights: [],
    patientCheckouts: [],
    messages: [],
    products,
    prices,
    offers: OFFERS,
    notifications: [],
    seeded: true,
  };
}

export function createEmptyUser(profile: Profile): UserData {
  const { products, prices } = buildCatalog();
  return {
    profile,
    accounts: [
      { id: uid("acc"), name: "PayPal Wallet", type: "paypal", balance: 0 },
      { id: uid("acc"), name: "Bank account", type: "bank", balance: 0 },
    ],
    categories: DEFAULT_CATEGORIES,
    transactions: [],
    budgets: [],
    envelopes: [],
    goals: [],
    subscriptions: [],
    bills: [],
    flowExpenses: [],
    reminders: [],
    scheduledPayments: [],
    insights: [],
    dismissedInsights: [],
    patientCheckouts: [],
    messages: [],
    products,
    prices,
    offers: OFFERS,
    notifications: [],
    seeded: false,
  };
}

const PRODUCT_SEED: Omit<MockProduct, "id">[] = [
  { name: "Sony WH-1000XM5 Headphones", brand: "Sony", category: "Audio", emoji: "🎧", description: "Industry-leading noise cancelling over-ear headphones with 30-hour battery.", tags: ["noise cancelling", "headphones", "wireless"] },
  { name: "Apple iPhone 16 (128GB)", brand: "Apple", category: "Mobiles", emoji: "📱", description: "6.1-inch Super Retina XDR display, A18 chip, 48MP Fusion camera.", tags: ["phone", "iphone", "smartphone"] },
  { name: "Nike Air Zoom Pegasus 41", brand: "Nike", category: "Footwear", emoji: "👟", description: "Responsive daily running shoe with ReactX foam and breathable mesh.", tags: ["shoes", "running", "sneakers"] },
  { name: "Kindle Paperwhite (2024)", brand: "Amazon", category: "Electronics", emoji: "📖", description: "7-inch glare-free display, adjustable warm light, up to 10 weeks battery.", tags: ["ereader", "kindle", "books"] },
  { name: "Instant Pot Duo 5.7L", brand: "Instant Pot", category: "Kitchen", emoji: "🍲", description: "7-in-1 electric pressure cooker, slow cooker, rice cooker and steamer.", tags: ["cooker", "kitchen", "appliance"] },
  { name: "Noise Buds VS104 Pro", brand: "Noise", category: "Audio", emoji: "🎵", description: "TWS earbuds with 45-hour playtime, ENC calling and low-latency gaming mode.", tags: ["earbuds", "tws", "budget"] },
];

interface RetailerSeed {
  retailer: string;
  price: number;
  shipping: number;
  deliveryDays: number;
  rating: number;
  returnDays: number;
  trustScore: number;
  inStock?: boolean;
}

const RETAILER_QUOTES: Record<string, RetailerSeed[]> = {
  "Sony WH-1000XM5 Headphones": [
    { retailer: "Amazon India", price: 26990, shipping: 0, deliveryDays: 2, rating: 4.5, returnDays: 10, trustScore: 93 },
    { retailer: "Flipkart", price: 25499, shipping: 49, deliveryDays: 4, rating: 4.3, returnDays: 7, trustScore: 86 },
    { retailer: "Croma", price: 28490, shipping: 0, deliveryDays: 1, rating: 4.6, returnDays: 7, trustScore: 91 },
    { retailer: "Reliance Digital", price: 27999, shipping: 0, deliveryDays: 3, rating: 4.2, returnDays: 7, trustScore: 84 },
    { retailer: "Vijay Sales", price: 26499, shipping: 199, deliveryDays: 5, rating: 4.1, returnDays: 5, trustScore: 78 },
  ],
  "Apple iPhone 16 (128GB)": [
    { retailer: "Amazon India", price: 69900, shipping: 0, deliveryDays: 2, rating: 4.4, returnDays: 7, trustScore: 93 },
    { retailer: "Flipkart", price: 68499, shipping: 0, deliveryDays: 3, rating: 4.2, returnDays: 7, trustScore: 86 },
    { retailer: "Croma", price: 71500, shipping: 0, deliveryDays: 1, rating: 4.5, returnDays: 7, trustScore: 91 },
    { retailer: "Vijay Sales", price: 70200, shipping: 0, deliveryDays: 4, rating: 4.0, returnDays: 5, trustScore: 78 },
    { retailer: "Reliance Digital", price: 69999, shipping: 0, deliveryDays: 2, rating: 4.3, returnDays: 7, trustScore: 84 },
  ],
  "Nike Air Zoom Pegasus 41": [
    { retailer: "Myntra", price: 8995, shipping: 0, deliveryDays: 3, rating: 4.3, returnDays: 14, trustScore: 88 },
    { retailer: "Amazon India", price: 9299, shipping: 0, deliveryDays: 2, rating: 4.4, returnDays: 10, trustScore: 93 },
    { retailer: "Flipkart", price: 8799, shipping: 79, deliveryDays: 4, rating: 4.1, returnDays: 7, trustScore: 86 },
    { retailer: "Ajio", price: 8499, shipping: 99, deliveryDays: 5, rating: 3.9, returnDays: 7, trustScore: 79 },
    { retailer: "Nike Official", price: 10995, shipping: 0, deliveryDays: 2, rating: 4.7, returnDays: 30, trustScore: 96 },
  ],
  "Kindle Paperwhite (2024)": [
    { retailer: "Amazon India", price: 13999, shipping: 0, deliveryDays: 1, rating: 4.6, returnDays: 10, trustScore: 93 },
    { retailer: "Flipkart", price: 14199, shipping: 0, deliveryDays: 3, rating: 4.3, returnDays: 7, trustScore: 86 },
    { retailer: "Croma", price: 14499, shipping: 0, deliveryDays: 2, rating: 4.4, returnDays: 7, trustScore: 91 },
    { retailer: "Reliance Digital", price: 14299, shipping: 0, deliveryDays: 4, rating: 4.1, returnDays: 7, trustScore: 84 },
    { retailer: "Tata CLiQ", price: 13799, shipping: 129, deliveryDays: 5, rating: 4.0, returnDays: 14, trustScore: 81 },
  ],
  "Instant Pot Duo 5.7L": [
    { retailer: "Amazon India", price: 8499, shipping: 0, deliveryDays: 2, rating: 4.5, returnDays: 10, trustScore: 93 },
    { retailer: "Flipkart", price: 8299, shipping: 0, deliveryDays: 3, rating: 4.2, returnDays: 7, trustScore: 86 },
    { retailer: "Croma", price: 9199, shipping: 0, deliveryDays: 1, rating: 4.4, returnDays: 7, trustScore: 91 },
    { retailer: "Reliance Digital", price: 8799, shipping: 0, deliveryDays: 3, rating: 4.2, returnDays: 7, trustScore: 84 },
    { retailer: "Vijay Sales", price: 8699, shipping: 149, deliveryDays: 5, rating: 4.0, returnDays: 5, trustScore: 78 },
  ],
  "Noise Buds VS104 Pro": [
    { retailer: "Amazon India", price: 1299, shipping: 0, deliveryDays: 2, rating: 4.1, returnDays: 10, trustScore: 93 },
    { retailer: "Flipkart", price: 1199, shipping: 0, deliveryDays: 3, rating: 4.0, returnDays: 7, trustScore: 86 },
    { retailer: "Myntra", price: 1349, shipping: 0, deliveryDays: 4, rating: 4.2, returnDays: 14, trustScore: 88 },
    { retailer: "Noise Official", price: 1499, shipping: 0, deliveryDays: 2, rating: 4.4, returnDays: 7, trustScore: 90 },
    { retailer: "Croma", price: 1399, shipping: 49, deliveryDays: 1, rating: 4.0, returnDays: 7, trustScore: 91 },
  ],
};

function buildCatalog(): { products: MockProduct[]; prices: MockPrice[] } {
  const products: MockProduct[] = PRODUCT_SEED.map((p, i) => ({ ...p, id: `prod_${i + 1}` }));
  const prices: MockPrice[] = [];
  products.forEach((product, pi) => {
    const quotes = RETAILER_QUOTES[product.name] ?? [];
    quotes.forEach((q, qi) => {
      const base = q.price + q.shipping;
      const drift = [1.06, 1.03, 1.01, 0.99, 1.02, 0.98, 1.0, 0.985, 1.0];
      const history = drift.map((d, idx) => Math.round(base * d + (pi * 37 + qi * 11 + idx * 7) % 180));
      history[history.length - 1] = base;
      prices.push({
        id: `price_${pi + 1}_${qi + 1}`,
        productId: product.id,
        retailer: q.retailer,
        price: q.price,
        shipping: q.shipping,
        deliveryDays: q.deliveryDays,
        rating: q.rating,
        returnDays: q.returnDays,
        trustScore: q.trustScore,
        inStock: q.inStock ?? q.retailer !== "Tata CLiQ",
        history,
      });
    });
  });
  return { products, prices };
}

const dayPlus = (n: number) => addDaysISO(new Date().toISOString().slice(0, 10), n);

export const OFFERS: MockOffer[] = [
  { id: "offer_swiggy", merchant: "Swiggy", title: "20% off your next 3 orders", description: "Because food delivery is one of your top categories this month.", category: "Food & Dining", discount: "20%", code: "GUARD20", expiresAt: dayPlus(9), minSpend: 399 },
  { id: "offer_bigbasket", merchant: "BigBasket", title: "₹200 off groceries above ₹1,500", description: "You shop here every week — stack this on your next basket.", category: "Groceries", discount: "₹200", code: "FRESH200", expiresAt: dayPlus(14), minSpend: 1500 },
  { id: "offer_myntra", merchant: "Myntra", title: "Extra 10% off with HDFC cards", description: "Your shopping spend is trending up — use it only on planned buys.", category: "Shopping", discount: "10%", code: "STYLE10", expiresAt: dayPlus(5), minSpend: 1999 },
  { id: "offer_makemytrip", merchant: "MakeMyTrip", title: "₹750 off weekend getaways", description: "Your Japan trip goal is 19% funded. A local weekend keeps it moving.", category: "Travel", discount: "₹750", code: "WEEKEND750", expiresAt: dayPlus(21), minSpend: 8000 },
];

export const DEMO_ACCOUNT = { email: "aarav@walletguardian.demo", password: "demo1234" };
