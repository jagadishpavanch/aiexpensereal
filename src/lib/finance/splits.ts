import type { Split, SplitMode, SplitShare } from "./types";

const toPaise = (n: number) => Math.round(n * 100);

/**
 * Turns participant inputs into rupee shares that add up exactly to `total`.
 * - equal: values ignored
 * - exact: values are rupee amounts (must add up to total)
 * - percent: values are percentages (must add up to 100)
 * - shares: values are weights (any positive numbers)
 * Leftover paise go to the first participants, one paisa each.
 */
export function computeShares(
  total: number,
  mode: SplitMode,
  people: { personId: string; value?: number }[],
): { shares: SplitShare[]; error?: string } {
  if (people.length === 0) return { shares: [], error: "Pick at least one person" };
  const T = toPaise(total);
  if (mode === "exact") {
    // Stored in whole paise (what is checked is what is saved), and a negative amount is never valid.
    if (people.some((p) => (p.value ?? 0) < 0)) return { shares: [], error: "Amounts can't be negative" };
    const shares = people.map((p) => ({ personId: p.personId, amount: toPaise(p.value ?? 0) / 100 }));
    const sum = shares.reduce((s, x) => s + toPaise(x.amount), 0);
    return sum === T ? { shares } : { shares, error: `Amounts add up to ₹${(sum / 100).toFixed(2)}, not ₹${total.toFixed(2)}` };
  }
  let weights: number[];
  if (mode === "equal") weights = people.map(() => 1);
  else weights = people.map((p) => Math.max(0, p.value ?? 0));
  const wsum = weights.reduce((a, b) => a + b, 0);
  if (mode === "percent" && Math.abs(wsum - 100) > 0.001) return { shares: [], error: `Percentages add up to ${wsum}%, not 100%` };
  if (wsum <= 0) return { shares: [], error: "Give at least one person a share" };
  // Floor each share in integers: floating point gave 3074 where the exact answer is 3073 (1.3 : 3.9 of 122.92),
  // which handed the leftover paisa to the wrong person. Weights are scaled to micro-units; BigInt avoids overflow.
  const scaled = weights.map((w) => BigInt(Math.round(w * 1e6)));
  const ssum = scaled.reduce((a, b) => a + b, 0n);
  if (ssum <= 0n) return { shares: [], error: "Give at least one person a share" };
  const raw = scaled.map((w) => Number((BigInt(T) * w) / ssum));
  let left = T - raw.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % raw.length) {
    if (weights[i] > 0) { raw[i] += 1; left -= 1; }
  }
  return { shares: people.map((p, i) => ({ personId: p.personId, amount: raw[i] / 100 })) };
}

/**
 * Net balance per person across splits. Positive = they owe you; negative = you owe them.
 * Settled shares are ignored.
 */
export function balances(splits: Split[]): Map<string, number> {
  const m = new Map<string, number>();
  const add = (id: string, v: number) => m.set(id, Math.round(((m.get(id) ?? 0) + v) * 100) / 100);
  for (const s of splits) {
    if (s.paidBy === "me") {
      for (const sh of s.shares) if (sh.personId !== "me" && !s.settled.includes(sh.personId)) add(sh.personId, sh.amount);
    } else {
      const mine = s.shares.find((x) => x.personId === "me");
      if (mine && !s.settled.includes("me")) add(s.paidBy, -mine.amount);
    }
  }
  return m;
}

/** True while this split still has money between me and `personId` that nobody settled. */
export function hasOpenShare(s: Split, personId: string): boolean {
  if (s.paidBy === personId) return s.shares.some((x) => x.personId === "me") && !s.settled.includes("me");
  if (s.paidBy === "me") return s.shares.some((x) => x.personId === personId) && !s.settled.includes(personId);
  return false;
}

export function splitSummary(splits: Split[]) {
  let owedToMe = 0;
  let iOwe = 0;
  for (const v of balances(splits).values()) {
    if (v > 0) owedToMe += v;
    else iOwe += -v;
  }
  return { owedToMe: Math.round(owedToMe * 100) / 100, iOwe: Math.round(iOwe * 100) / 100 };
}

/** My own share of a split (what actually counts as my spending). */
export function myShare(s: Split) {
  return s.shares.find((x) => x.personId === "me")?.amount ?? 0;
}
