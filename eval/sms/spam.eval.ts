/**
 * Precision check: no spam, chat or non-transaction SMS in CloveAI/india-spam-sms may become a transaction.
 * Run: npx vitest run --config eval/sms/vitest.config.ts   (from an uppercase-drive path)
 * Needs: node eval/sms/fetch.mjs first. Writes the spam section of eval/sms/report.md.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { categorize } from "@/lib/finance/categorize";
import { DEFAULT_CATEGORIES, emptyState } from "@/lib/finance/demo";
import { planImport } from "@/lib/sms/plan";
import type { Outcome } from "@/lib/sms/types";

const DIR = path.resolve(process.cwd(), "eval/sms");
const DATA = path.join(DIR, ".data");
const SPLIT = process.env.EVAL_SPLIT ?? "test";

// ---------- shared report helpers (duplicated in the other eval file on purpose: the eval folder is just these files) ----------

const cut = (s: string, n = 140) => {
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const md = (s: string, n = 140) => cut(s, n).replace(/\|/g, "\\|").replace(/`/g, "'");
const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`);
const gitHash = () => {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: DIR }).toString().trim();
  } catch {
    return "unknown";
  }
};

/** The numbers from the committed baseline run (report.md, "Baseline (before)"). The baseline sections of the report are frozen. */
const BASELINE: Record<string, number | null> = {
  recallEn: 98.6, recallIn: 0.0, amount: 100.0, direction: 98.3, category: 43.6, spamKept: 10.2, p2m: null, silentWrong: 0.3, iciciRecall: 100.0, iciciAmount: 100.0,
};

// Only the held-out test split writes report.md; tuning runs on train or valid write to the ignored .data folder.
const REPORT = SPLIT === "test" ? path.join(DIR, "report.md") : path.join(DATA, `report-${SPLIT}.md`);
const REGIONS = ["summary", "finee", "spam"] as const;
const HEADING = "## After Phase B";
const section = () => `${HEADING}\n\n<!-- b-stamp -->\n\n${REGIONS.map((r) => `<!-- b-${r}:start -->\n<!-- b-${r}:end -->`).join("\n\n")}\n`;

function writeRegion(name: (typeof REGIONS)[number], body: string) {
  let doc = fs.existsSync(REPORT) ? fs.readFileSync(REPORT, "utf8").replace(/\r\n/g, "\n") : "# SMS reader evaluation\n";
  if (!doc.includes(HEADING)) doc = doc.replace(/\s*$/, "\n\n") + section();
  const start = `<!-- b-${name}:start -->`;
  const end = `<!-- b-${name}:end -->`;
  const a = doc.indexOf(start);
  const b = doc.indexOf(end);
  if (a < 0 || b < 0) throw new Error(`report is missing the b-${name} markers`);
  doc = doc.slice(0, a + start.length) + "\n" + body.trim() + "\n" + doc.slice(b);
  const stamp = `_Run ${new Date().toISOString()} · base commit \`${gitHash()}\` (working tree) · FinEE split: \`${SPLIT}\`_`;
  doc = doc.replace(/<!-- b-stamp -->[^\n]*/, `<!-- b-stamp -->${stamp}`);
  fs.writeFileSync(REPORT, doc);
}

interface Target { label: string; key: string; goal: string; test: (v: number) => boolean; note?: string }
function summaryTable(): string {
  const read = (file: string) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")) as Record<string, number | null>;
    } catch {
      return {};
    }
  };
  const m = { ...read(SPLIT === "test" ? "metrics-finee.json" : `metrics-finee-${SPLIT}.json`), ...read("metrics-spam.json") };
  const T: Target[] = [
    { label: "Detection recall, English", key: "recallEn", goal: "≥ 98%", test: (v) => v >= 98 },
    { label: "Detection recall, Indian languages", key: "recallIn", goal: "≥ 90%", test: (v) => v >= 90 },
    { label: "Amount within ₹1 (of detected)", key: "amount", goal: "≥ 99%", test: (v) => v >= 99 },
    { label: "Direction (of detected)", key: "direction", goal: "≥ 97%", test: (v) => v >= 97 },
    { label: "Category (merchant-labelled rows)", key: "category", goal: "≥ 85%", test: (v) => v >= 85 },
    { label: "CloveAI spam kept as a transaction", key: "spamKept", goal: "0%", test: (v) => v === 0 },
    { label: "Person vs shop (`is_p2m`)", key: "p2m", goal: "≥ 90%", test: (v) => v >= 90 },
    { label: "Wrong category saved silently", key: "silentWrong", goal: "≤ 5%", test: (v) => v <= 5, note: "no needs-review flag until Phase C: every non-fallback miss is silent" },
    { label: "Real ICICI subset: detection", key: "iciciRecall", goal: "≥ 99%", test: (v) => v >= 99 },
    { label: "Real ICICI subset: amount", key: "iciciAmount", goal: "≥ 99%", test: (v) => v >= 99 },
  ];
  const f = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${v.toFixed(1)}%`);
  const rows = T.map((t) => {
    const after = m[t.key];
    const status = after === null || after === undefined ? "not met" : t.test(Math.round(after * 10) / 10) ? "met" : "not met";
    return `| ${t.label} | ${t.goal} | ${f(BASELINE[t.key])} | ${f(after)} | ${status}${t.note ? ` (${t.note})` : ""} |`;
  });
  return `### Before and after against targets\n\n| Metric | Target | Before | After | Status |\n|---|---|---:|---:|---|\n${rows.join("\n")}`;
}

// ---------- the eval ----------

/** Shapes listed per list. The baseline report lists 40; this run lists fewer to keep the report readable. */
const TOP = 15;

interface Msg { text: string; label: number }
const FUTURE = /\b(?:will be|will get|processed|on hold|requested|pending|scheduled|within \d+ (?:working )?(?:days|hours))\b/i;
const MONEY = /(?:rs\.?|inr|₹)\s*\d/i;

/** Groups near-identical messages (digits masked, first 45 chars) so a list of 40 shows 40 different shapes, with how many rows each stands for. */
function groups<T extends { text: string }>(list: T[], n: number): { count: number; first: T }[] {
  const m = new Map<string, T[]>();
  for (const r of list) {
    const k = r.text.replace(/\d+/g, "#").slice(0, 45);
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return [...m.values()].map((v) => ({ count: v.length, first: v[0] })).sort((a, b) => b.count - a.count).slice(0, n);
}

describe("CloveAI india-spam-sms", () => {
  it("never turns spam into a transaction, and reports what real SMS become", () => {
    const file = path.join(DATA, "spam.json");
    if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run: node eval/sms/fetch.mjs`);
    const msgs = (JSON.parse(fs.readFileSync(file, "utf8")) as Msg[]).filter((m) => m && typeof m.text === "string");
    expect(msgs.length).toBeGreaterThan(1000);
    const state = emptyState();
    const run = msgs.map((m, i) => {
      const items = planImport(
        [{ id: `s${i}`, channel: "notification", from: "", text: m.text, at: Date.UTC(2025, 5, 1), viaSmsApp: false }],
        state,
        { categorize: (mm, t, ty) => categorize({ merchant: mm, text: t, type: ty }, [], DEFAULT_CATEGORIES).categoryId, bills: true },
      );
      const o: Outcome = items[0].outcome;
      return { ...m, o, kept: o.kind === "tx" || o.kind === "bill" };
    });
    type R = (typeof run)[number];
    const what = (o: Outcome) => (o.kind === "tx" ? `${o.tx.type} ₹${o.tx.amount} ${o.tx.merchant}` : o.kind === "bill" ? `bill ₹${o.bill.amount} ${o.bill.name}` : o.kind);

    const spam = run.filter((r) => r.label === 1);
    const ham = run.filter((r) => r.label === 0);
    const spamKept = spam.filter((r) => r.kept);
    const hamKept = ham.filter((r) => r.kept);
    const hamNot = ham.filter((r) => !r.kept);
    const kinds = (list: R[]) => {
      const c = new Map<string, number>();
      for (const r of list) c.set(r.o.kind, (c.get(r.o.kind) ?? 0) + 1);
      return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
    };
    const money = (list: R[]) => list.filter((r) => MONEY.test(r.text));
    const future = run.filter((r) => r.kept && FUTURE.test(r.text));

    const metrics = { spamKept: spam.length ? (100 * spamKept.length) / spam.length : null, hamKept: ham.length ? (100 * hamKept.length) / ham.length : null };
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, "metrics-spam.json"), JSON.stringify(metrics));

    const li = (g: { count: number; first: R }, withOutcome = true) => `- **${g.count}×** \`${md(g.first.text, 110)}\`${withOutcome ? ` → ${md(what(g.first.o), 50)}` : ""}`;
    const out = [
      "### CloveAI india-spam-sms",
      "",
      `${msgs.length} messages (${spam.length} spam, ${ham.length} not spam). Same pipeline as the FinEE eval: one \`planImport\` call per message, channel \`notification\`, \`viaSmsApp: false\`. Real SMS also pass a bank-sender check first, which this run does not apply, so these numbers are a worst case.`,
      "",
      "| | Rows | Kept as transaction/bill | Share | Outcomes |",
      "|---|---:|---:|---:|---|",
      `| Spam (label 1) | ${spam.length} | ${spamKept.length} | ${pct(spamKept.length, spam.length)} | ${kinds(spam)} |`,
      `| Not spam (label 0) | ${ham.length} | ${hamKept.length} | ${pct(hamKept.length, ham.length)} | ${kinds(ham)} |`,
      "",
      `Not-spam messages that mention an amount: ${money(ham).length}, of which kept ${money(ham).filter((r) => r.kept).length}.`,
      "",
      `#### Spam kept as a transaction (target 0): ${spamKept.length}`,
      "",
      spamKept.length ? groups(spamKept, TOP).map((r) => li(r)).join("\n") : "_none_",
      "",
      `#### Kept rows with a pending or future cue (will be, processed, on hold, requested, pending): ${future.length}`,
      "",
      future.length ? groups(future, TOP).map((r) => li(r)).join("\n") : "_none_",
      "",
      `#### Not spam, kept (top ${TOP} message shapes of ${hamKept.length} rows): is each a completed money movement?`,
      "",
      groups(hamKept, TOP).map((r) => li(r)).join("\n") || "_none_",
      "",
      `#### Not spam, not kept, but mentioning an amount (top ${TOP} message shapes of ${money(hamNot).length} rows): did we miss a transaction?`,
      "",
      groups(money(hamNot), TOP).map((g) => `${li(g, false)} _(${g.first.o.kind})_`).join("\n") || "_none_",
    ].join("\n");

    writeRegion("spam", out);
    writeRegion("summary", summaryTable());
  });
});
