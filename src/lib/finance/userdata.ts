import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, demoState } from "./demo";
import type { FinanceState } from "./types";

type ListKey = "budgets" | "goals" | "rules" | "bills" | "people" | "splits";
const LISTS: ListKey[] = ["budgets", "goals", "rules", "bills", "people", "splits"];

/** Ids that only the sample data uses, per list. */
function sampleIds(): Record<ListKey, Set<string>> {
  const d = demoState();
  return Object.fromEntries(LISTS.map((k) => [k, new Set((d[k] as { id: string }[]).map((x) => x.id))])) as Record<ListKey, Set<string>>;
}

/** Everything in the state that is the user's own: not sample data and not a built-in category or account. */
export function hasRealData(s: FinanceState): boolean {
  if (s.transactions.some((t) => !t.isDemo)) return true;
  const sample = sampleIds();
  if (LISTS.some((k) => (s[k] as { id: string }[]).some((x) => !sample[k].has(x.id)))) return true;
  return s.categories.some((c) => !DEFAULT_CATEGORIES.some((d) => d.id === c.id)) || s.accounts.some((a) => !DEFAULT_ACCOUNTS.some((d) => d.id === a.id));
}

/** The state without its sample data; the user's own transactions, goals, people and so on stay. */
export function withoutSamples(s: FinanceState): FinanceState {
  const sample = sampleIds();
  const next = { ...s, transactions: s.transactions.filter((t) => !t.isDemo) };
  for (const k of LISTS) (next as unknown as Record<ListKey, { id: string }[]>)[k] = (s[k] as { id: string }[]).filter((x) => !sample[k].has(x.id));
  return next;
}
