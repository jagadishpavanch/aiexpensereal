import type { Budget, Transaction } from "./types";

export function inMonth(iso: string, ref: Date) {
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

/** Signed effect on spending: expenses add, refunds subtract, income/transfers ignored. */
export function spendOf(t: Transaction) {
  if (t.type === "expense") return t.amount;
  if (t.type === "refund") return -t.amount;
  return 0;
}

export function totals(txs: Transaction[]) {
  let income = 0;
  let spent = 0;
  for (const t of txs) {
    if (t.type === "income") income += t.amount;
    spent += spendOf(t);
  }
  return { income, spent, net: income - spent };
}

export function byCategory(txs: Transaction[]) {
  const m = new Map<string, number>();
  for (const t of txs) {
    const v = spendOf(t);
    if (v === 0) continue;
    m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + v);
  }
  return [...m.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount: Math.max(0, amount) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

export function budgetStatus(b: Budget, monthTxs: Transaction[]) {
  const spent = Math.max(
    0,
    monthTxs.filter((t) => t.categoryId === b.categoryId).reduce((s, t) => s + spendOf(t), 0),
  );
  const pct = b.limit > 0 ? spent / b.limit : 0;
  const state = pct >= 1 ? "over" : pct >= 0.8 ? "near" : "ok";
  return { spent, remaining: b.limit - spent, pct, state } as const;
}

export function dailySeries(txs: Transaction[], days: number, now = new Date()) {
  const out: { date: string; label: string; spent: number; income: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = d.toDateString();
    const dayTx = txs.filter((t) => new Date(t.date).toDateString() === key);
    const tt = totals(dayTx);
    out.push({
      date: d.toISOString(),
      label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      spent: tt.spent,
      income: tt.income,
    });
  }
  return out;
}

export function monthlySeries(txs: Transaction[], months: number, now = new Date()) {
  const out: { label: string; spent: number; income: number; net: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const tt = totals(txs.filter((t) => inMonth(t.date, ref)));
    out.push({ label: ref.toLocaleDateString("en-IN", { month: "short" }), ...tt });
  }
  return out;
}

export function topMerchants(txs: Transaction[], n = 5) {
  const m = new Map<string, { amount: number; count: number }>();
  for (const t of txs) {
    if (t.type !== "expense") continue;
    const cur = m.get(t.merchant) ?? { amount: 0, count: 0 };
    cur.amount += t.amount;
    cur.count += 1;
    m.set(t.merchant, cur);
  }
  return [...m.entries()].map(([merchant, v]) => ({ merchant, ...v })).sort((a, b) => b.amount - a.amount).slice(0, n);
}

/** Categories whose spend this month changed by >= threshold vs last month. */
export function anomalies(txs: Transaction[], now = new Date(), threshold = 0.3) {
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const cur = byCategory(txs.filter((t) => inMonth(t.date, now)));
  const last = new Map(byCategory(txs.filter((t) => inMonth(t.date, prev))).map((x) => [x.categoryId, x.amount]));
  return cur
    .map((c) => {
      const before = last.get(c.categoryId) ?? 0;
      const change = before === 0 ? 1 : (c.amount - before) / before;
      return { categoryId: c.categoryId, now: c.amount, before, change };
    })
    .filter((x) => Math.abs(x.change) >= threshold && x.now > 500)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

/** Same amount, merchant and day (within 2 minutes) counts as a duplicate. */
export function isDuplicate(a: Pick<Transaction, "amount" | "merchant" | "date">, list: Transaction[]) {
  const ta = new Date(a.date).getTime();
  return list.some(
    (t) =>
      t.amount === a.amount &&
      t.merchant.trim().toLowerCase() === a.merchant.trim().toLowerCase() &&
      Math.abs(new Date(t.date).getTime() - ta) <= 2 * 60 * 1000,
  );
}

export function heatmap(txs: Transaction[], now = new Date()) {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: daysIn }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), i + 1);
    const spent = txs.filter((t) => new Date(t.date).toDateString() === d.toDateString()).reduce((s, t) => s + spendOf(t), 0);
    return { day: i + 1, spent: Math.max(0, spent), future: d > now };
  });
  return { offset: (first.getDay() + 6) % 7, cells };
}

/** Budget state if an extra expense of `add` rupees were recorded now. */
export function budgetAfter(b: Budget, monthTxs: Transaction[], add: number) {
  const cur = budgetStatus(b, monthTxs);
  const spent = cur.spent + Math.max(0, add);
  const pct = b.limit > 0 ? spent / b.limit : 0;
  return { spent, remaining: b.limit - spent, pct, state: pct >= 1 ? "over" : pct >= 0.8 ? "near" : "ok" } as const;
}

/** Overall monthly limit across all spending. */
export function overallStatus(limit: number, monthTxs: Transaction[], add = 0) {
  const spent = Math.max(0, totals(monthTxs).spent) + Math.max(0, add);
  const pct = limit > 0 ? spent / limit : 0;
  return { spent, limit, remaining: limit - spent, pct, state: limit <= 0 ? "ok" : pct >= 1 ? "over" : pct >= 0.8 ? "near" : "ok" } as const;
}

/** Spending per day of the given month (index 1..31). */
export function daySpendInMonth(txs: Transaction[], year: number, month: number) {
  const out: Record<number, number> = {};
  for (const t of txs) {
    const d = new Date(t.date);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const v = spendOf(t);
    if (v) out[d.getDate()] = (out[d.getDate()] ?? 0) + v;
  }
  return out;
}

/** This month's money in/out for one account, plus its recent transactions. */
export function accountActivity(txs: Transaction[], accountId: string, now = new Date()) {
  const mine = txs.filter((t) => t.accountId === accountId);
  const month = mine.filter((t) => inMonth(t.date, now));
  const spent = Math.max(0, month.reduce((s, t) => s + spendOf(t), 0));
  const received = month.reduce((s, t) => s + (t.type === "income" ? t.amount : 0), 0);
  return { spent, received, count: mine.length, recent: mine.slice(0, 5) };
}
