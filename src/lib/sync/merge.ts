import { DEFAULT_PREFS } from "@/lib/finance/demo";
import type { FinanceState, Prefs } from "@/lib/finance/types";
import { listOf, type Collection, type Item, type ListCollection } from "./diff";
import { keyOf, type Outbox } from "./outbox";

export interface RemoteRow {
  collection: Collection;
  id: string;
  data: Record<string, unknown> | null;
  deleted: boolean;
  updated_at: string;
}

/** Apply pulled rows (oldest first). Records with unpushed local changes keep the local copy. */
export function applyRows(s: FinanceState, rows: RemoteRow[], pending: Outbox): FinanceState {
  const touched = new Map<ListCollection, Map<string, Item>>();
  let prefs = s.prefs;
  for (const r of rows) {
    if (pending[keyOf(r)]) continue;
    if (r.collection === "prefs") {
      const d = (r.deleted ? {} : r.data ?? {}) as Partial<Prefs>;
      prefs = { ...DEFAULT_PREFS, ...d, features: { ...DEFAULT_PREFS.features, ...d.features }, lock: s.prefs.lock };
      if (r.deleted) prefs.onboarded = false;
      continue;
    }
    let m = touched.get(r.collection);
    if (!m) {
      m = new Map(listOf(s, r.collection).map((x) => [x.id, x]));
      touched.set(r.collection, m);
    }
    if (r.deleted || !r.data) m.delete(r.id);
    else m.set(r.id, r.data as unknown as Item);
  }
  if (!touched.size && prefs === s.prefs) return s;
  const next = { ...s, prefs } as FinanceState;
  for (const [c, m] of touched) (next as unknown as Record<string, Item[]>)[c] = [...m.values()];
  if (touched.has("transactions")) next.transactions = [...next.transactions].sort((a, b) => +new Date(b.date) - +new Date(a.date));
  return next;
}
