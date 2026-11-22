import type { Account, Bill, Budget, Category, FinanceState, Goal, Person, Prefs, Split, Transaction, WidgetConfig } from "./types";

export const DEFAULT_CATEGORIES: Category[] = [
  { id: "food", name: "Food & dining", icon: "utensils", color: "chart-3", kind: "expense" },
  { id: "groceries", name: "Groceries", icon: "shopping-basket", color: "chart-4", kind: "expense" },
  { id: "transport", name: "Transport", icon: "car", color: "chart-5", kind: "expense" },
  { id: "rent", name: "Rent", icon: "home", color: "chart-1", kind: "expense" },
  { id: "bills", name: "Bills & utilities", icon: "zap", color: "chart-2", kind: "expense" },
  { id: "shopping", name: "Shopping", icon: "shopping-bag", color: "chart-6", kind: "expense" },
  { id: "entertainment", name: "Entertainment", icon: "film", color: "chart-5", kind: "expense" },
  { id: "health", name: "Health", icon: "heart-pulse", color: "chart-4", kind: "expense" },
  { id: "other", name: "Other", icon: "circle", color: "chart-6", kind: "expense" },
  { id: "salary", name: "Salary", icon: "briefcase", color: "chart-4", kind: "income" },
  { id: "freelance", name: "Freelance", icon: "laptop", color: "chart-2", kind: "income" },
];

export const DEFAULT_ACCOUNTS: Account[] = [
  { id: "hdfc", name: "HDFC Savings", kind: "bank", last4: "4821", balance: 148220, finish: "peacock" },
  { id: "upi", name: "UPI · GPay", kind: "upi", balance: 0 },
  { id: "card", name: "ICICI Credit Card", kind: "card", cardType: "credit", last4: "9012", limit: 150000, statementDay: 20, dueDay: 5, finish: "ink" },
  { id: "debit", name: "HDFC Debit Card", kind: "card", cardType: "debit", last4: "4821", finish: "marigold" },
  { id: "cash", name: "Cash", kind: "cash", balance: 3200 },
];

export const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: "balance", visible: true, size: "full" },
  { id: "ring", visible: true, size: "full" },
  { id: "budgets", visible: true, size: "half" },
  { id: "goals", visible: true, size: "half" },
  { id: "trend", visible: true, size: "full" },
  { id: "recent", visible: true, size: "full" },
  { id: "merchants", visible: false, size: "half" },
  { id: "recurring", visible: false, size: "half" },
  { id: "bills", visible: true, size: "full" },
  { id: "cashback", visible: true, size: "half" },
  { id: "splits", visible: true, size: "half" },
];

export const DEFAULT_PREFS: Prefs = {
  name: "Aarav",
  theme: "light",
  accent: "peacock",
  hideAmounts: false,
  aiEnabled: true,
  onboarded: false,
  demoMode: true,
  timeZone: "Asia/Kolkata",
  locale: "en-IN",
  notifications: { budgetAlerts: true, weeklySummary: true, bills: true },
  widgets: DEFAULT_WIDGETS,
  overallBudget: 0,
  features: { splits: true, cashback: true, bills: true, cards: true, lock: false, autoTracking: true },
  lock: { idleMinutes: 5 },
};

// Deterministic PRNG so demo data is stable per seed
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const POOL: { m: string; c: string; a: string; min: number; max: number; w: number }[] = [
  { m: "Swiggy", c: "food", a: "upi", min: 180, max: 650, w: 6 },
  { m: "Zomato", c: "food", a: "upi", min: 220, max: 780, w: 5 },
  { m: "Chai Point", c: "food", a: "upi", min: 40, max: 160, w: 6 },
  { m: "BigBasket", c: "groceries", a: "card", min: 600, max: 2800, w: 3 },
  { m: "Blinkit", c: "groceries", a: "upi", min: 150, max: 900, w: 5 },
  { m: "Uber", c: "transport", a: "upi", min: 120, max: 520, w: 5 },
  { m: "Namma Metro", c: "transport", a: "upi", min: 30, max: 90, w: 5 },
  { m: "Indian Oil", c: "transport", a: "card", min: 800, max: 2500, w: 1 },
  { m: "Amazon", c: "shopping", a: "card", min: 350, max: 4800, w: 2 },
  { m: "Myntra", c: "shopping", a: "card", min: 700, max: 3200, w: 1 },
  { m: "BookMyShow", c: "entertainment", a: "upi", min: 300, max: 1100, w: 1 },
  { m: "Apollo Pharmacy", c: "health", a: "upi", min: 120, max: 1400, w: 1 },
];

export function makeDemoTransactions(now = new Date(), seed = 42): Transaction[] {
  const r = rng(seed);
  const out: Transaction[] = [];
  const total = POOL.reduce((s, p) => s + p.w, 0);
  let n = 0;
  const id = () => `demo-${seed}-${n++}`;
  for (let d = 0; d < 92; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
    const perDay = Math.floor(r() * 4) + 1;
    for (let k = 0; k < perDay; k++) {
      let pick = r() * total;
      const p = POOL.find((x) => (pick -= x.w) < 0) ?? POOL[0];
      const date = new Date(day);
      date.setHours(8 + Math.floor(r() * 14), Math.floor(r() * 60));
      if (date > now) continue;
      out.push({
        id: id(), type: "expense", amount: Math.round(p.min + r() * (p.max - p.min)),
        categoryId: p.c, accountId: p.a, merchant: p.m, date: date.toISOString(),
        source: r() > 0.35 ? "sms_demo" : "manual", isDemo: true,
      });
    }
    // monthly items on day 1 / 5 / 10
    const dom = day.getDate();
    const at = (h: number) => { const x = new Date(day); x.setHours(h, 5); return x.toISOString(); };
    if (dom === 1) out.push({ id: id(), type: "income", amount: 92000, categoryId: "salary", accountId: "hdfc", merchant: "Acme Labs Pvt Ltd", date: at(9), source: "sms_demo", isDemo: true, recurring: true });
    if (dom === 3) out.push({ id: id(), type: "expense", amount: 24000, categoryId: "rent", accountId: "hdfc", merchant: "House rent", date: at(10), source: "manual", isDemo: true, recurring: true });
    if (dom === 6) out.push({ id: id(), type: "expense", amount: 649, categoryId: "entertainment", accountId: "card", merchant: "Netflix", date: at(7), source: "sms_demo", isDemo: true, recurring: true });
    if (dom === 8) out.push({ id: id(), type: "expense", amount: 1340, categoryId: "bills", accountId: "upi", merchant: "BESCOM Electricity", date: at(11), source: "sms_demo", isDemo: true, recurring: true });
    if (dom === 12) out.push({ id: id(), type: "expense", amount: 999, categoryId: "bills", accountId: "upi", merchant: "Airtel Fiber", date: at(12), source: "sms_demo", isDemo: true, recurring: true });
    if (dom === 18 && r() > 0.3) out.push({ id: id(), type: "income", amount: Math.round(8000 + r() * 12000), categoryId: "freelance", accountId: "hdfc", merchant: "Upwork payout", date: at(15), source: "manual", isDemo: true });
    if ((dom === 4 || dom === 17) && r() > 0.25) {
      const srcs = ["Google Pay", "PhonePe", "Paytm", "Amazon Pay", "CRED"];
      const src = srcs[Math.floor(r() * srcs.length)];
      out.push({ id: id(), type: "income", amount: Math.round(10 + r() * 140), categoryId: "freelance", accountId: "upi", merchant: `${src} cashback`, date: at(13), source: "sms_demo", isDemo: true, cashback: true, cashbackSource: src });
    }
    if (dom === 21 && r() > 0.5) out.push({ id: id(), type: "refund", amount: 499, categoryId: "shopping", accountId: "card", merchant: "Amazon", date: at(16), source: "sms_demo", isDemo: true });
  }
  return out.filter((t) => new Date(t.date) <= now).sort((a, b) => +new Date(b.date) - +new Date(a.date));
}

export const DEMO_BUDGETS: Budget[] = [
  { id: "b1", categoryId: "food", limit: 8000 },
  { id: "b2", categoryId: "groceries", limit: 6000 },
  { id: "b3", categoryId: "transport", limit: 4000 },
  { id: "b4", categoryId: "shopping", limit: 5000 },
  { id: "b5", categoryId: "entertainment", limit: 2000 },
];

export const DEMO_GOALS: Goal[] = [
  { id: "g1", name: "Goa trip", target: 40000, saved: 26500, emoji: "🏖️" },
  { id: "g2", name: "Emergency fund", target: 300000, saved: 118000, emoji: "🛟" },
  { id: "g3", name: "New laptop", target: 120000, saved: 34000, emoji: "💻" },
];

export const DEMO_SMS = [
  "Rs.452.00 debited from A/c XX4821 on 21-10-26 to VPA swiggy@icici (UPI Ref 629104837122). Not you? Call 1800-xxx -HDFC Bank",
  "INR 92,000.00 credited to A/c XX4821 on 01-10-26 by NEFT from ACME LABS PVT LTD. Avl Bal INR 1,48,220.18",
  "Your ICICI Credit Card XX9012 has been used for INR 2,349.00 at AMAZON on 19-Oct-26. Avl Lmt: INR 1,12,400",
];

export const DEMO_SMS_EXTRA = [
  "Your ICICI Credit Card XX9012 statement: Total due Rs 18,240.50. Due date 05-Nov-26. Min due Rs 920.",
  "Rs 1,340.00 paid to BESCOM via UPI from A/c XX4821. UPI Ref 528193.",
  "You have received Rs 75.00 cashback from PhonePe. It is credited to your A/c XX4821.",
  "Airtel bill of Rs 999 is due on 12-11-26. Pay now to avoid late fee.",
];

function dueThisOrNext(now: Date, day: number) {
  const d = new Date(now.getFullYear(), now.getMonth(), day, 9);
  if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

export function demoBills(now = new Date()): Bill[] {
  const soon = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 9).toISOString();
  return [
    { id: "bill-rent", name: "House rent", amount: 24000, dueDate: dueThisOrNext(now, 3), repeat: "monthly", categoryId: "rent", accountId: "hdfc", paidCount: 0 },
    { id: "bill-card", name: "ICICI card bill", amount: 18240, dueDate: soon(4), repeat: "monthly", categoryId: "bills", accountId: "hdfc", paidCount: 0 },
    { id: "bill-power", name: "BESCOM electricity", amount: 1340, dueDate: soon(1), repeat: "monthly", categoryId: "bills", accountId: "upi", paidCount: 0 },
    { id: "bill-net", name: "Airtel Fiber", amount: 999, dueDate: soon(-1), repeat: "monthly", categoryId: "bills", accountId: "upi", paidCount: 0 },
    { id: "bill-netflix", name: "Netflix", amount: 649, dueDate: dueThisOrNext(now, 6), repeat: "monthly", categoryId: "entertainment", accountId: "card", paidCount: 0 },
    { id: "bill-ins", name: "Health insurance", amount: 14500, dueDate: soon(40), repeat: "yearly", categoryId: "health", accountId: "hdfc", paidCount: 0 },
  ];
}

export const DEMO_PEOPLE: Person[] = [
  { id: "p-riya", name: "Riya", group: "partner" },
  { id: "p-kabir", name: "Kabir", group: "friend" },
  { id: "p-ananya", name: "Ananya", group: "friend" },
  { id: "p-rohan", name: "Rohan", group: "roommate" },
  { id: "p-mom", name: "Mom", group: "family" },
];

export function demoSplits(now = new Date()): Split[] {
  const ago = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, 20).toISOString();
  return [
    { id: "s1", title: "Dinner at Toit", total: 3600, paidBy: "me", date: ago(1), mode: "equal", settled: [], shares: [{ personId: "me", amount: 900 }, { personId: "p-riya", amount: 900 }, { personId: "p-kabir", amount: 900 }, { personId: "p-ananya", amount: 900 }] },
    { id: "s2", title: "Goa cab", total: 2400, paidBy: "p-kabir", date: ago(4), mode: "equal", settled: [], shares: [{ personId: "me", amount: 1200 }, { personId: "p-kabir", amount: 1200 }] },
    { id: "s3", title: "Flat groceries", total: 3000, paidBy: "me", date: ago(6), mode: "shares", settled: [], shares: [{ personId: "me", amount: 2000 }, { personId: "p-rohan", amount: 1000 }] },
    { id: "s4", title: "Movie night", total: 1200, paidBy: "me", date: ago(12), mode: "equal", settled: ["p-ananya"], shares: [{ personId: "me", amount: 600 }, { personId: "p-ananya", amount: 600 }] },
  ];
}

export function emptyState(): FinanceState {
  return { transactions: [], categories: DEFAULT_CATEGORIES, accounts: DEFAULT_ACCOUNTS, budgets: [], goals: [], rules: [], bills: [], people: [], splits: [], prefs: DEFAULT_PREFS };
}

export function demoState(now = new Date()): FinanceState {
  return {
    transactions: makeDemoTransactions(now),
    categories: DEFAULT_CATEGORIES,
    accounts: DEFAULT_ACCOUNTS,
    budgets: DEMO_BUDGETS,
    goals: DEMO_GOALS,
    rules: [{ id: "r1", match: "swiggy", categoryId: "food" }, { id: "r2", match: "uber", categoryId: "transport" }],
    bills: demoBills(now),
    people: DEMO_PEOPLE,
    splits: demoSplits(now),
    prefs: { ...DEFAULT_PREFS, demoMode: true, overallBudget: 60000 },
  };
}
