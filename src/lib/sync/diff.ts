import type { FinanceState, Prefs } from "@/lib/finance/types";

export const COLLECTIONS = ["transactions", "categories", "accounts", "budgets", "goals", "rules", "bills", "people", "splits"] as const;
export type ListCollection = (typeof COLLECTIONS)[number];
export type Collection = ListCollection | "prefs";
export const PREFS_ID = "prefs";

export interface Change {
  collection: Collection;
  id: string;
  data: Record<string, unknown> | null; // null = deleted
}

export type Item = { id: string };
export const listOf = (s: FinanceState, c: ListCollection) => s[c] as unknown as Item[];
const asData = (x: unknown) => x as Record<string, unknown>;

/** Prefs that follow the user to every device. `lock` belongs to this phone only. */
export function syncedPrefs(p: Prefs): Omit<Prefs, "lock"> {
  const { lock: _lock, ...rest } = p;
  return rest;
}

/** Records changed by one store commit. Store updates are immutable, so identity marks change. */
export function diffState(prev: FinanceState, next: FinanceState): Change[] {
  const out: Change[] = [];
  for (const c of COLLECTIONS) {
    const a = listOf(prev, c);
    const b = listOf(next, c);
    if (a === b) continue;
    const before = new Map(a.map((x) => [x.id, x]));
    for (const item of b) {
      if (before.get(item.id) !== item) out.push({ collection: c, id: item.id, data: asData(item) });
      before.delete(item.id);
    }
    for (const id of before.keys()) out.push({ collection: c, id, data: null });
  }
  if (prev.prefs !== next.prefs) {
    const p = syncedPrefs(next.prefs);
    if (JSON.stringify(syncedPrefs(prev.prefs)) !== JSON.stringify(p)) out.push({ collection: "prefs", id: PREFS_ID, data: asData(p) });
  }
  return out;
}

/** Every record, for the one-time upload of a device's existing data. */
export function toChanges(s: FinanceState): Change[] {
  const out: Change[] = [];
  for (const c of COLLECTIONS) for (const item of listOf(s, c)) out.push({ collection: c, id: item.id, data: asData(item) });
  out.push({ collection: "prefs", id: PREFS_ID, data: asData(syncedPrefs(s.prefs)) });
  return out;
}
