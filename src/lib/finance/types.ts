export type TxType = "expense" | "income" | "transfer" | "refund";
export type TxSource = "manual" | "sms_demo" | "csv" | "ai";

export interface Category {
  id: string;
  name: string;
  icon: string; // lucide icon name key
  color: string; // chart token var name e.g. "chart-1"
  kind: "expense" | "income";
}

export interface Account {
  id: string;
  name: string;
  kind: "bank" | "upi" | "card" | "cash" | "wallet";
  cardType?: "debit" | "credit";
  last4?: string;
  balance?: number;
  limit?: number; // credit limit
  statementDay?: number;
  dueDay?: number;
  finish?: "peacock" | "marigold" | "ink";
}

export type Repeat = "none" | "weekly" | "monthly" | "yearly";

export interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDate: string; // ISO date of the next unpaid due
  repeat: Repeat;
  categoryId: string;
  accountId: string;
  paidCount: number;
  done?: boolean; // one-off bill already paid
}

export type PersonGroup = "friend" | "partner" | "family" | "roommate" | "other";

export interface Person {
  id: string;
  name: string;
  group: PersonGroup;
}

export type SplitMode = "equal" | "exact" | "percent" | "shares";

export interface SplitShare {
  personId: string; // "me" for the user
  amount: number;
}

export interface Split {
  id: string;
  title: string;
  total: number;
  paidBy: string; // "me" or personId
  date: string;
  mode: SplitMode;
  shares: SplitShare[];
  settled: string[]; // personIds that have settled this split
  txId?: string;
}

export interface Transaction {
  id: string;
  type: TxType;
  amount: number; // positive, in paise-free rupees (2 decimals allowed)
  categoryId: string;
  accountId: string;
  merchant: string;
  note?: string;
  date: string; // ISO
  source: TxSource;
  isDemo: boolean;
  recurring?: boolean;
  cashback?: boolean;
  cashbackSource?: string;
}

export interface Budget {
  id: string;
  categoryId: string;
  limit: number; // monthly
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  deadline?: string;
  emoji: string;
}

export interface MerchantRule {
  id: string;
  match: string;
  categoryId: string;
}

export type WidgetId =
  | "balance"
  | "ring"
  | "recent"
  | "budgets"
  | "trend"
  | "goals"
  | "merchants"
  | "recurring"
  | "bills"
  | "cashback"
  | "splits";

export interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
  size: "full" | "half";
}

export interface Prefs {
  name: string;
  theme: "light" | "dark" | "system";
  accent: "peacock" | "marigold" | "indigo" | "rose";
  hideAmounts: boolean;
  aiEnabled: boolean;
  onboarded: boolean;
  demoMode: boolean;
  timeZone: string;
  locale: string;
  notifications: { budgetAlerts: boolean; weeklySummary: boolean; bills: boolean };
  widgets: WidgetConfig[];
  overallBudget: number; // 0 = no overall limit
  features: Features;
  lock: LockPrefs;
}

export interface Features {
  splits: boolean;
  cashback: boolean;
  bills: boolean;
  cards: boolean;
  lock: boolean;
  autoTracking: boolean;
}

export interface LockPrefs {
  credentialId?: string;
  pinHash?: string;
  idleMinutes: number;
}

export interface FinanceState {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  budgets: Budget[];
  goals: Goal[];
  rules: MerchantRule[];
  bills: Bill[];
  people: Person[];
  splits: Split[];
  prefs: Prefs;
}
