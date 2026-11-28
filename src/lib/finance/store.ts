import { useSyncExternalStore } from "react";
import type { Account, Bill, Budget, FinanceState, Goal, MerchantRule, Person, Prefs, Split, Transaction, TxType } from "./types";
import { categorize, normalizeMerchant, type CategorizeResult } from "./categorize";
import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, DEFAULT_PREFS, DEFAULT_WIDGETS, DEMO_PEOPLE, demoBills, demoSplits, demoState, emptyState } from "./demo";
import { advance } from "./bills";
import { myShare } from "./splits";

/**
 * Repository: local device storage today; swap `load`/`persist` for a cloud
 * implementation later without touching screens.
 */
const KEY = "extrack:v1";
const OLD_KEY = "rupeeflow:v1";
let state: FinanceState | null = null;
const listeners = new Set<() => void>();

function load(): FinanceState {
  try {
    const raw = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY);
    if (raw) {
      const s = JSON.parse(raw) as FinanceState;
      return migrate(s);
    }
  } catch {
    /* ignore corrupted storage */
  }
  return demoState();
}

/**
 * Built-in categories of a kind come back when that kind has none left, and the
 * built-in accounts when there are no accounts. "Delete everything" leaves
 * tombstones for the built-in ids on the server, so a fresh install pulling them
 * ended up with nothing to pick in the add sheet and nothing to file SMS under.
 */
export function withBasics(s: FinanceState): FinanceState {
  const gone = (["expense", "income"] as const).filter((k) => !s.categories.some((c) => c.kind === k));
  const categories = gone.length
    ? [...s.categories, ...DEFAULT_CATEGORIES.filter((d) => gone.includes(d.kind) && !s.categories.some((c) => c.id === d.id))]
    : s.categories;
  const accounts = s.accounts.length ? s.accounts : DEFAULT_ACCOUNTS;
  return categories === s.categories && accounts === s.accounts ? s : { ...s, categories, accounts };
}

/** Fill in anything added since the data was first saved on this device. */
function migrate(s: FinanceState): FinanceState {
  const prefs = { ...DEFAULT_PREFS, ...s.prefs };
  prefs.features = { ...DEFAULT_PREFS.features, ...s.prefs?.features };
  prefs.lock = { ...DEFAULT_PREFS.lock, ...s.prefs?.lock };
  const have = new Set(prefs.widgets.map((w) => w.id));
  prefs.widgets = [...prefs.widgets, ...DEFAULT_WIDGETS.filter((w) => !have.has(w.id))];
  const demo = prefs.demoMode;
  const accounts = s.accounts.map((a) => ({ ...DEFAULT_ACCOUNTS.find((d) => d.id === a.id), ...a }));
  if (demo && !accounts.some((a) => a.id === "debit")) accounts.push(DEFAULT_ACCOUNTS.find((a) => a.id === "debit")!);
  // Categories are the user's data: only append a default that is missing, never overwrite or reorder.
  const categories = [...s.categories, ...DEFAULT_CATEGORIES.filter((d) => d.id === "other-income" && !s.categories.some((c) => c.id === d.id))];
  return withBasics({
    ...s,
    categories,
    accounts,
    bills: s.bills ?? (demo ? demoBills() : []),
    people: s.people ?? (demo ? DEMO_PEOPLE : []),
    splits: s.splits ?? (demo ? demoSplits() : []),
    prefs,
  });
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full */
  }
}

function get(): FinanceState {
  if (!state) state = typeof window === "undefined" ? demoState() : load();
  return state;
}

type CommitListener = (prev: FinanceState, next: FinanceState) => void;
const commitListeners = new Set<CommitListener>();

function set(fn: (s: FinanceState) => FinanceState) {
  const prev = get();
  state = fn(prev);
  persist();
  listeners.forEach((l) => l());
  commitListeners.forEach((l) => l(prev, state!));
}

/** Swap state without it counting as a local edit (remote changes, sign-out). */
function replace(next: FinanceState) {
  state = next;
  persist();
  listeners.forEach((l) => l());
}

let serverSnap: FinanceState | null = null;
export function useFinance<T>(sel: (s: FinanceState) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => sel(get()),
    () => sel((serverSnap ??= emptyState())),
  );
}

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

export const actions = {
  addTx(t: Omit<Transaction, "id">) {
    const tx = { ...t, id: uid() };
    set((s) => ({ ...s, transactions: [tx, ...s.transactions].sort((a, b) => +new Date(b.date) - +new Date(a.date)) }));
    return tx;
  },
  updateTx(id: string, patch: Partial<Transaction>) {
    set((s) => ({ ...s, transactions: s.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)).sort((a, b) => +new Date(b.date) - +new Date(a.date)) }));
  },
  deleteTx(id: string) {
    const removed = get().transactions.find((t) => t.id === id);
    set((s) => ({ ...s, transactions: s.transactions.filter((t) => t.id !== id) }));
    return removed;
  },
  restoreTx(t: Transaction) {
    set((s) => ({ ...s, transactions: [t, ...s.transactions].sort((a, b) => +new Date(b.date) - +new Date(a.date)) }));
  },
  setPrefs(p: Partial<Prefs>) {
    set((s) => ({ ...s, prefs: { ...s.prefs, ...p } }));
  },
  upsertBudget(b: Omit<Budget, "id"> & { id?: string }) {
    set((s) => {
      const existing = s.budgets.find((x) => x.categoryId === b.categoryId);
      const budgets = existing ? s.budgets.map((x) => (x.id === existing.id ? { ...x, limit: b.limit } : x)) : [...s.budgets, { ...b, id: uid() }];
      return { ...s, budgets };
    });
  },
  deleteBudget(id: string) {
    set((s) => ({ ...s, budgets: s.budgets.filter((b) => b.id !== id) }));
  },
  addGoal(g: Omit<Goal, "id">) {
    set((s) => ({ ...s, goals: [...s.goals, { ...g, id: uid() }] }));
  },
  contributeGoal(id: string, amount: number) {
    set((s) => ({ ...s, goals: s.goals.map((g) => (g.id === id ? { ...g, saved: Math.min(g.target, g.saved + amount) } : g)) }));
  },
  deleteGoal(id: string) {
    set((s) => ({ ...s, goals: s.goals.filter((g) => g.id !== id) }));
  },
  addRule(r: Omit<MerchantRule, "id">) {
    set((s) => ({ ...s, rules: [...s.rules, { ...r, id: uid() }] }));
  },
  deleteRule(id: string) {
    set((s) => ({ ...s, rules: s.rules.filter((r) => r.id !== id) }));
  },
  addCategory(name: string, kind: "expense" | "income") {
    set((s) => ({ ...s, categories: [...s.categories, { id: uid(), name, icon: "tag", color: "chart-5", kind }] }));
  },
  /** Adds many transactions in one commit and returns their new ids (for an Undo). */
  importTxs(txs: Omit<Transaction, "id">[]): string[] {
    const added = txs.map((t) => ({ ...t, id: uid() }));
    set((s) => ({ ...s, transactions: [...added, ...s.transactions].sort((a, b) => +new Date(b.date) - +new Date(a.date)) }));
    return added.map((t) => t.id);
  },
  /** Removes many transactions in one commit, e.g. undoing an import. */
  removeTxs(ids: string[]) {
    const drop = new Set(ids);
    set((s) => ({ ...s, transactions: s.transactions.filter((t) => !drop.has(t.id)) }));
  },
  loadDemo() {
    const prefs = get().prefs;
    const d = demoState();
    set(() => ({ ...d, prefs: { ...prefs, demoMode: true } }));
  },
  startFresh() {
    const prefs = get().prefs;
    const e = emptyState();
    set(() => ({ ...e, prefs: { ...prefs, demoMode: false } }));
  },
  upsertAccount(a: Omit<Account, "id"> & { id?: string }) {
    set((s) => ({ ...s, accounts: a.id ? s.accounts.map((x) => (x.id === a.id ? { ...x, ...a, id: x.id } : x)) : [...s.accounts, { ...a, id: uid() }] }));
  },
  deleteAccount(id: string) {
    set((s) => ({ ...s, accounts: s.accounts.filter((a) => a.id !== id) }));
  },
  upsertBill(b: Omit<Bill, "id" | "paidCount"> & { id?: string }) {
    set((s) => ({ ...s, bills: b.id ? s.bills.map((x) => (x.id === b.id ? { ...x, ...b, id: x.id } : x)) : [...s.bills, { ...b, id: uid(), paidCount: 0 }] }));
  },
  deleteBill(id: string) {
    set((s) => ({ ...s, bills: s.bills.filter((b) => b.id !== id) }));
  },
  /** Records the payment as an expense and moves a repeating bill to its next due date. */
  payBill(id: string) {
    const b = get().bills.find((x) => x.id === id);
    if (!b) return;
    actions.addTx({ type: "expense", amount: b.amount, categoryId: b.categoryId, accountId: b.accountId, merchant: b.name, date: new Date().toISOString(), source: "manual", isDemo: false, recurring: b.repeat !== "none" });
    set((s) => ({
      ...s,
      bills: s.bills.map((x) => (x.id !== id ? x : x.repeat === "none" ? { ...x, done: true, paidCount: x.paidCount + 1 } : { ...x, dueDate: advance(x.dueDate, x.repeat), paidCount: x.paidCount + 1 })),
    }));
  },
  addPerson(p: Omit<Person, "id">) {
    const person = { ...p, id: uid() };
    set((s) => ({ ...s, people: [...s.people, person] }));
    return person;
  },
  deletePerson(id: string) {
    set((s) => ({ ...s, people: s.people.filter((p) => p.id !== id) }));
  },
  /** Saves a split. When I paid, only my share is recorded as my spending. */
  addSplit(sp: Omit<Split, "id" | "settled">, tx?: Omit<Transaction, "id">) {
    let txId: string | undefined;
    if (tx) txId = actions.addTx({ ...tx, amount: sp.paidBy === "me" ? sp.total : myShare({ ...sp, id: "", settled: [] }), note: `Split · your share ₹${myShare({ ...sp, id: "", settled: [] })}` }).id;
    set((s) => ({ ...s, splits: [{ ...sp, id: uid(), settled: [], txId }, ...s.splits] }));
  },
  settlePerson(personId: string) {
    set((s) => ({
      ...s,
      splits: s.splits.map((sp) => {
        const involved = sp.paidBy === personId ? sp.shares.some((x) => x.personId === "me") : sp.paidBy === "me" && sp.shares.some((x) => x.personId === personId);
        if (!involved) return sp;
        const who = sp.paidBy === personId ? "me" : personId;
        return sp.settled.includes(who) ? sp : { ...sp, settled: [...sp.settled, who] };
      }),
    }));
  },
  deleteSplit(id: string) {
    set((s) => ({ ...s, splits: s.splits.filter((x) => x.id !== id) }));
  },
  /** Picks a category from the user's rules, the built-in merchant list and keywords. Always returns a usable category. */
  categorize(merchant: string, opts?: { text?: string; type?: TxType }): CategorizeResult {
    const { rules, categories } = get();
    return categorize({ merchant, text: opts?.text, type: opts?.type ?? "expense" }, rules, categories);
  },
  /** Remembers the user's correction: future payments to this merchant go to `categoryId`. Returns the rule's match, or undefined if nothing was learned. */
  learnCategory(merchant: string, categoryId: string): { match: string } | undefined {
    const key = normalizeMerchant(merchant);
    if (!key || !get().categories.some((c) => c.id === categoryId)) return undefined;
    const same = (r: MerchantRule) => r.match.trim().toLowerCase() === key || normalizeMerchant(r.match) === key;
    const existing = get().rules.find(same);
    if (existing?.categoryId === categoryId) return { match: existing.match };
    set((s) => ({
      ...s,
      rules: existing ? s.rules.map((r) => (r.id === existing.id ? { ...r, categoryId } : r)) : [...s.rules, { id: uid(), match: key, categoryId }],
    }));
    return { match: existing?.match ?? key };
  },
  /** How many past transactions from this merchant would move to the category (same side, not transfers). */
  pastToRecategorize(merchant: string, categoryId: string): number {
    return movable(get(), merchant, categoryId).length;
  },
  /**
   * Moves every past transaction from this merchant to the category in one commit, so the learned rule
   * covers history as well as the future. Returns an undo that puts each one back.
   */
  recategorizeMerchant(merchant: string, categoryId: string): () => void {
    const prev = new Map(movable(get(), merchant, categoryId).map((t) => [t.id, t.categoryId]));
    if (!prev.size) return () => {};
    set((s) => ({ ...s, transactions: s.transactions.map((t) => (prev.has(t.id) ? { ...t, categoryId } : t)) }));
    return () => set((s) => ({ ...s, transactions: s.transactions.map((t) => (prev.has(t.id) && t.categoryId === categoryId ? { ...t, categoryId: prev.get(t.id)! } : t)) }));
  },
};

/** Past transactions from the same merchant on the category's side (expense/refund or income), not yet in it. */
function movable(s: FinanceState, merchant: string, categoryId: string): Transaction[] {
  const key = normalizeMerchant(merchant);
  const cat = s.categories.find((c) => c.id === categoryId);
  if (!key || !cat) return [];
  const side = (t: Transaction) => (cat.kind === "income" ? t.type === "income" : t.type === "expense" || t.type === "refund");
  return s.transactions.filter((t) => t.categoryId !== categoryId && side(t) && normalizeMerchant(t.merchant) === key);
}

/** The sync engine's only door into the store. Screens use `useFinance` + `actions`. */
export const syncPort = {
  getState: get,
  onLocalCommit(l: CommitListener) {
    commitListeners.add(l);
    return () => void commitListeners.delete(l);
  },
  applyRemote(fn: (s: FinanceState) => FinanceState) {
    const next = fn(get());
    replace(next);
    // Restoring built-ins is a local edit, so it is pushed and replaces the server's tombstones.
    const healed = withBasics(next);
    if (healed !== next) set(() => healed);
  },
  reset(opts?: { keepLock?: boolean }) {
    try {
      localStorage.removeItem(OLD_KEY);
    } catch {
      /* storage unavailable */
    }
    const lock = opts?.keepLock ? get().prefs.lock : DEFAULT_PREFS.lock;
    replace({ ...emptyState(), prefs: { ...DEFAULT_PREFS, onboarded: false, lock } });
  },
};
