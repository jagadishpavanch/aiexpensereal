import type { Transaction } from "./types";

export const CASHBACK_SOURCES = ["Google Pay", "PhonePe", "Paytm", "Amazon Pay", "CRED", "Credit card", "Other"] as const;

export function isCashback(t: Transaction) {
  return t.type === "income" && !!t.cashback;
}

export function cashbackTotals(txs: Transaction[], now = new Date()) {
  let month = 0;
  let year = 0;
  let all = 0;
  const bySource = new Map<string, number>();
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString("en-IN", { month: "short" }), amount: 0 };
  });
  const idx = new Map(monthly.map((m, i) => [m.key, i]));
  const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1);
  for (const t of txs) {
    if (!isCashback(t)) continue;
    const d = new Date(t.date);
    all += t.amount;
    if (d >= yearAgo && d <= now) {
      year += t.amount;
      const src = t.cashbackSource || "Other";
      bySource.set(src, (bySource.get(src) ?? 0) + t.amount);
    }
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) month += t.amount;
    const i = idx.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (i !== undefined) monthly[i].amount += t.amount;
  }
  return {
    month,
    year,
    all,
    bySource: [...bySource.entries()].map(([source, amount]) => ({ source, amount })).sort((a, b) => b.amount - a.amount),
    monthly,
  };
}
