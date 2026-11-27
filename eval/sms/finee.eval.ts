/**
 * Scores the SMS reader (planImport -> parseAlert -> categorize) on the FinEE held-out test split.
 * Run: npx vitest run --config eval/sms/vitest.config.ts   (from an uppercase-drive path)
 * Needs: node eval/sms/fetch.mjs first. Writes the FinEE sections of eval/sms/report.md.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { categorize, type CategorizeSource } from "@/lib/finance/categorize";
import { DEFAULT_CATEGORIES, emptyState } from "@/lib/finance/demo";
import { isFinanceAlert, parseAlert } from "@/lib/finance/sms-parse";
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

// ---------- dataset ----------

interface Label {
  amount?: number; type?: "debit" | "credit"; account?: string; bank?: string; merchant?: string; beneficiary?: string;
  category?: string; is_p2m?: boolean; language?: string; vpa?: string;
}
interface Row { idx: number; text: string; label: Label | null }

/** EVAL_LIMIT=20000 reads an evenly spaced sample, so a tuning run on the 150k-row train split takes seconds. */
function loadRows(file: string): Row[] {
  const out: Row[] = [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const limit = Number(process.env.EVAL_LIMIT ?? 0);
  const stride = limit > 0 ? Math.max(1, Math.floor(lines.length / limit)) : 1;
  lines.forEach((line, i) => {
    if (!line.trim() || i % stride !== 0) return;
    try {
      const r = JSON.parse(line) as { messages?: { content?: string }[] };
      const user = String(r.messages?.[1]?.content ?? "");
      // The first line is one of eight instruction phrasings; the message follows a blank line.
      const cutAt = user.indexOf("\n\n");
      const text = cutAt >= 0 ? user.slice(cutAt + 2).trim() : user.trim();
      let label: Label | null = null;
      try {
        const parsed = JSON.parse(String(r.messages?.[2]?.content ?? ""));
        if (parsed && typeof parsed === "object") label = parsed as Label;
      } catch {
        label = null;
      }
      out.push({ idx: i, text, label });
    } catch {
      // A broken line is skipped; the count is reported.
    }
  });
  return out;
}

// ---------- scoring ----------

/** Dataset class -> how our output expresses it. `null` means we have no mapping and the row is not scored for category. */
const CLASS_MAP: Record<string, string> = {
  food: "food", grocery: "groceries", shopping: "shopping", transport: "transport", travel: "transport", bills: "bills",
  healthcare: "health", entertainment: "entertainment", salary: "salary", investment: "transfer", transfer: "transfer",
  refund: "refund", cashback: "cashback", emi: "bills",
};

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const merchantHit = (got: string, want: string) => {
  const a = normName(got);
  const b = normName(want);
  return a.length >= 2 && b.length >= 2 && (a === b || (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))));
};
const digitsOf = (s: string) => String(s ?? "").replace(/\D/g, "");

const ICICI_TEMPLATE = /ICICI Bank Acct XX\d+ (?:debited|credited)|^ICICI Bank/;

/** Masks a message to its template: digits -> #, capitalised name runs -> NAME. */
const KEEP_CAPS = new Set(["rs", "inr", "bank", "acct", "a/c", "ref", "avl", "bal", "limit", "call", "info", "not", "your", "dear", "customer", "thank", "thanks", "txn", "debited", "credited", "spent", "paid", "sent", "received", "transferred", "payment", "dispute", "card", "account", "balance", "available", "upi", "imps", "neft", "rtgs", "sms", "block", "to", "from", "on", "at", "for", "if", "is", "the", "in", "of", "by", "with", "has", "been", "was", "will", "be", "dr", "cr", "pos", "atm", "emi", "cc", "id", "no", "avail", "fund", "funds", "transaction", "transfer", "amount", "date", "time"]);
function template(text: string): string {
  const out: string[] = [];
  for (const tok of text.replace(/\d+/g, "#").split(/\s+/)) {
    const core = tok.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    if (/^[A-Z][a-z]+$/.test(core) && !KEEP_CAPS.has(core.toLowerCase())) {
      if (out[out.length - 1] !== "NAME") out.push("NAME");
    } else out.push(tok);
  }
  return out.join(" ");
}

const bankOf = (r: Row): string => {
  if (r.label?.bank) return r.label.bank;
  const m = r.text.match(/^([A-Za-z&.]+(?: [A-Za-z&.]+){0,2}?)(?: Bank| Acct| A\/c| CC| Card| Credit| Debit|:|\s+[-–])/);
  return m ? m[1].replace(/^(?:Dear|Your)$/i, "(unknown)") : "(unknown)";
};

type Fail = "missed" | "amount" | "direction" | "last4" | "merchant" | "category" | "p2m";
const FAIL_ORDER: Fail[] = ["missed", "amount", "direction", "last4", "merchant", "category", "p2m"];

interface Scored {
  row: Row;
  lang: string;
  bank: string;
  icici: boolean;
  outcome: Outcome["kind"];
  detected: boolean;
  gotAmount?: number;
  gotType?: string;
  gotMerchant?: string;
  gotClass?: string;
  gotSource?: CategorizeSource | "bill";
  gotLast4?: string;
  toPerson?: boolean;
  /** Label says transfer to a person and we say expense (or income) with toPerson: a deliberate design difference, counted as correct. */
  designAgree?: boolean;
  p2mOk?: boolean;
  /** The labelled merchant or beneficiary appears in the message text. When it does not, no reader could recover it. */
  derivable?: boolean;
  amountOk?: boolean;
  directionOk?: boolean;
  last4Ok?: boolean;
  merchantOk?: boolean;
  categoryOk?: boolean;
  expectedClass?: string;
  hasMerchantLabel: boolean;
  fails: Fail[];
  disagreement?: string;
}

/** Heuristics for rows where the label, not the reader, looks wrong. Reported separately from real failures. */
function disagreement(r: Row, got: string | undefined): string | undefined {
  const t = r.text;
  const lab = r.label?.type;
  if (lab === "credit" && /\b(?:transferred to|sent to|paid to|debited)\b/i.test(t) && !/\b(?:credited to your|received|credited with|credited by)\b/i.test(t)) return 'labelled credit but text says "transferred/sent/paid to" or "debited"';
  if (lab === "debit" && /\b(?:credited (?:to your|with|by)|received|refund(?:ed)?)\b/i.test(t) && !/\bdebited\b/i.test(t)) return 'labelled debit but text says "credited/received/refund"';
  if (lab === "credit" && got === "expense" && /\bdebited\b/i.test(t) && /\bcredited\b/i.test(t)) return 'labelled credit, text has both "debited" and "credited" (payee credited)';
  return undefined;
}

function scoreAll(rows: Row[]): Scored[] {
  const scored: Scored[] = [];
  const state = emptyState();
  for (const row of rows) {
    const label = row.label;
    const lang = label?.language ?? "en";
    const hasMerchantLabel = Boolean(label?.merchant || label?.beneficiary);
    let source: CategorizeSource | undefined;
    const items = planImport(
      [{ id: `f${row.idx}`, channel: "notification", from: "", text: row.text, at: Date.UTC(2025, 5, 1), viaSmsApp: false }],
      state,
      {
        categorize: (m, t, ty) => {
          const res = categorize({ merchant: m, text: t, type: ty }, [], DEFAULT_CATEGORIES);
          source = res.source;
          return res.categoryId;
        },
        bills: true,
      },
    );
    const o = items[0].outcome;
    const s: Scored = { row, lang, bank: bankOf(row), icici: ICICI_TEMPLATE.test(row.text), outcome: o.kind, detected: o.kind === "tx" || o.kind === "bill", hasMerchantLabel, fails: [] };
    if (!label || typeof label.amount !== "number" || !label.type) {
      scored.push(s); // unlabelled: kept in the list so it can be counted, never scored
      continue;
    }
    if (!s.detected) {
      s.fails.push("missed");
      scored.push(s);
      continue;
    }
    if (o.kind === "tx") {
      s.gotAmount = o.tx.amount;
      s.gotType = o.tx.type;
      s.gotMerchant = o.tx.merchant;
      s.toPerson = o.tx.toPerson === true;
      s.gotClass = o.tx.type === "transfer" ? "transfer" : o.tx.type === "refund" ? "refund" : o.tx.cashback ? "cashback" : o.tx.categoryId;
      s.gotSource = source;
    } else if (o.kind === "bill") {
      s.gotAmount = o.bill.amount;
      s.gotType = "bill";
      s.gotMerchant = o.bill.name;
      s.gotClass = o.bill.categoryId;
      s.gotSource = "bill";
    }
    s.amountOk = Math.abs((s.gotAmount ?? 0) - label.amount) <= 1 + 1e-9;
    s.directionOk = label.type === "debit" ? ["expense", "transfer", "bill"].includes(s.gotType!) : ["income", "refund", "transfer"].includes(s.gotType!);
    if (!s.amountOk) s.fails.push("amount");
    if (!s.directionOk) {
      s.disagreement = disagreement(row, s.gotType);
      s.fails.push("direction");
    }
    if (label.account) {
      const p = isFinanceAlert(row.text) ? parseAlert(row.text) : null;
      const want = digitsOf(label.account);
      const got = digitsOf(p?.last4 ?? "");
      s.gotLast4 = got;
      s.last4Ok = got.length > 0 && want.length > 0 && (want.endsWith(got) || got.endsWith(want));
      if (!s.last4Ok) s.fails.push("last4");
    }
    if (hasMerchantLabel) {
      const want = (label.merchant ?? label.beneficiary)!;
      s.derivable = normName(row.text).includes(normName(want));
    }
    if (typeof label.is_p2m === "boolean" && !["refund", "cashback", "emi"].includes(label.category ?? "")) {
      // Refunds, cashbacks and EMI reminders are labelled is_p2m false although there is no person on the other side, so they are not scored.
      // Bills and transfers have no payee output, so they count as "shop" (is_p2m true).
      s.p2mOk = !s.toPerson === label.is_p2m;
      if (!s.p2mOk) s.fails.push("p2m");
    }
    if (hasMerchantLabel) {
      const want = (label.merchant ?? label.beneficiary)!;
      s.merchantOk = merchantHit(s.gotMerchant ?? "", want);
      if (!s.merchantOk) s.fails.push("merchant");
      const exp = label.category ? CLASS_MAP[label.category] : undefined;
      if (exp) {
        s.expectedClass = exp;
        s.designAgree = label.category === "transfer" && label.is_p2m === false && s.toPerson === true && (s.gotType === "expense" || s.gotType === "income");
        s.categoryOk = s.gotClass === exp || s.designAgree;
        if (!s.categoryOk) s.fails.push("category");
      }
    }
    scored.push(s);
  }
  return scored;
}

// ---------- aggregation ----------

interface Agg {
  n: number; labelled: number; detected: number; unread: number;
  amountN: number; amountOk: number; dirN: number; dirOk: number; lastN: number; lastOk: number;
  merN: number; merOk: number; catN: number; catOk: number; silent: number; p2mN: number; p2mOk: number; design: number; merDN: number; merDOk: number; catDN: number; catDOk: number; p2mDN: number; p2mDOk: number;
}
function agg(list: Scored[]): Agg {
  const a: Agg = { n: list.length, labelled: 0, detected: 0, unread: 0, amountN: 0, amountOk: 0, dirN: 0, dirOk: 0, lastN: 0, lastOk: 0, merN: 0, merOk: 0, catN: 0, catOk: 0, silent: 0, p2mN: 0, p2mOk: 0, design: 0, merDN: 0, merDOk: 0, catDN: 0, catDOk: 0, p2mDN: 0, p2mDOk: 0 };
  for (const s of list) {
    const l = s.row.label;
    if (!l || typeof l.amount !== "number" || !l.type) continue;
    a.labelled++;
    if (s.outcome === "unread") a.unread++;
    if (!s.detected) continue;
    a.detected++;
    a.amountN++;
    if (s.amountOk) a.amountOk++;
    a.dirN++;
    if (s.directionOk) a.dirOk++;
    if (s.last4Ok !== undefined) { a.lastN++; if (s.last4Ok) a.lastOk++; }
    if (s.merchantOk !== undefined) { a.merN++; if (s.merchantOk) a.merOk++; }
    if (s.derivable) {
      a.merDN++;
      if (s.merchantOk) a.merDOk++;
      if (s.categoryOk !== undefined) { a.catDN++; if (s.categoryOk) a.catDOk++; }
    }
    if (s.p2mOk !== undefined) {
      a.p2mN++;
      if (s.p2mOk) a.p2mOk++;
      // A labelled person that the message never names cannot be told from a shop by any reader.
      if (s.derivable !== false) { a.p2mDN++; if (s.p2mOk) a.p2mDOk++; }
    }
    if (s.designAgree) a.design++;
    if (s.categoryOk !== undefined) {
      a.catN++;
      if (s.categoryOk) a.catOk++;
      else if (s.gotSource !== "fallback") a.silent++;
    }
  }
  return a;
}
const num = (a: number, b: number) => (b === 0 ? null : (100 * a) / b);

function metricsTable(cols: { name: string; a: Agg }[]): string {
  const row = (label: string, f: (a: Agg) => string) => `| ${label} | ${cols.map((c) => f(c.a)).join(" | ")} |`;
  return [
    `| Metric | ${cols.map((c) => c.name).join(" | ")} |`,
    `|---|${cols.map(() => "---:").join("|")}|`,
    row("Rows (labelled)", (a) => String(a.labelled)),
    row("Detection recall", (a) => `${pct(a.detected, a.labelled)} (${a.detected})`),
    row("Read as 'unread' (money-like, not parsed)", (a) => pct(a.unread, a.labelled)),
    row("Amount within ₹1 (of detected)", (a) => pct(a.amountOk, a.amountN)),
    row("Direction (of detected)", (a) => pct(a.dirOk, a.dirN)),
    row("Last 4 (rows with account label)", (a) => `${pct(a.lastOk, a.lastN)} (n=${a.lastN})`),
    row("Merchant (rows with merchant/beneficiary label)", (a) => `${pct(a.merOk, a.merN)} (n=${a.merN})`),
    row("Category (merchant-labelled, mapped classes)", (a) => `${pct(a.catOk, a.catN)} (n=${a.catN})`),
    row("Merchant, only rows whose label is in the message", (a) => `${pct(a.merDOk, a.merDN)} (n=${a.merDN})`),
    row("Category, only rows whose merchant label is in the message", (a) => `${pct(a.catDOk, a.catDN)} (n=${a.catDN})`),
    row("Wrong category, not fallback (silent)", (a) => pct(a.silent, a.catN)),
    row("`is_p2m` (person vs shop), all labelled rows", (a) => `${pct(a.p2mOk, a.p2mN)} (n=${a.p2mN})`),
    row("`is_p2m`, only rows whose payee is named in the message", (a) => `${pct(a.p2mDOk, a.p2mDN)} (n=${a.p2mDN})`),
    row("Category rows counted correct by design (transfer to a person kept as expense)", (a) => String(a.design)),
  ].join("\n");
}

function groupTable(title: string, groups: Map<string, Scored[]>, limit?: number): string {
  const entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const shown = limit ? entries.slice(0, limit) : entries;
  const rest = limit ? entries.slice(limit).flatMap((e) => e[1]) : [];
  const lines = [`| ${title} | Rows | Recall | Amount | Direction | Last4 | Merchant | Category |`, "|---|---:|---:|---:|---:|---:|---:|---:|"];
  const add = (name: string, list: Scored[]) => {
    const a = agg(list);
    lines.push(`| ${md(name, 40)} | ${a.labelled} | ${pct(a.detected, a.labelled)} | ${pct(a.amountOk, a.amountN)} | ${pct(a.dirOk, a.dirN)} | ${pct(a.lastOk, a.lastN)} | ${pct(a.merOk, a.merN)} | ${pct(a.catOk, a.catN)} |`);
  };
  for (const [k, v] of shown) add(k, v);
  if (rest.length) add(`(${entries.length - shown.length} other)`, rest);
  return lines.join("\n");
}

/** Failure templates listed per type. The baseline report lists 25; this run lists fewer to keep the report readable. */
const TOP_FAIL = 10;

function failureLists(scored: Scored[]): string {
  const out: string[] = [];
  for (const type of FAIL_ORDER) {
    const hits = scored.filter((s) => s.fails.includes(type) && !(type === "direction" && s.disagreement));
    const byT = new Map<string, Scored[]>();
    for (const s of hits) {
      const k = template(s.row.text);
      (byT.get(k) ?? byT.set(k, []).get(k)!).push(s);
    }
    const top = [...byT.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, TOP_FAIL);
    out.push(`#### ${type}: ${hits.length} rows, ${byT.size} templates`);
    if (!hits.length) {
      out.push("_none_", "");
      continue;
    }
    top.forEach(([t, list], i) => {
      const s = list[0];
      const l = s.row.label!;
      const want = type === "p2m" ? String(l.is_p2m) : type === "category" ? `${l.category}→${s.expectedClass} (${l.merchant ?? l.beneficiary})` : type === "merchant" ? String(l.merchant ?? l.beneficiary) : type === "amount" ? String(l.amount) : type === "last4" ? String(l.account) : l.type;
      const got = type === "p2m" ? "toPerson " + String(s.toPerson) : type === "category" ? `${s.gotClass} [${s.gotSource}]` : type === "merchant" ? String(s.gotMerchant) : type === "amount" ? String(s.gotAmount) : type === "last4" ? String(s.gotLast4 || "none") : type === "missed" ? `outcome ${s.outcome}` : String(s.gotType);
      out.push(`${i + 1}. **${list.length}×** \`${md(t, 100)}\` — e.g. \`${md(s.row.text, 100)}\` · label ${md(String(want), 40)} · got ${md(String(got), 40)}`);
    });
    out.push("");
  }
  return out.join("\n");
}

function confusion(scored: Scored[]): string {
  const rows = scored.filter((s) => s.categoryOk !== undefined && !s.designAgree);
  const exp = new Map<string, Map<string, number>>();
  const gotTotals = new Map<string, number>();
  for (const s of rows) {
    const e = s.expectedClass!;
    const g = s.gotClass ?? "?";
    const m = exp.get(e) ?? exp.set(e, new Map()).get(e)!;
    m.set(g, (m.get(g) ?? 0) + 1);
    gotTotals.set(g, (gotTotals.get(g) ?? 0) + 1);
  }
  const cols = [...gotTotals.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const lines = [`| expected \\ got | ${cols.join(" | ")} | total | acc |`, `|---|${cols.map(() => "---:").join("|")}|---:|---:|`];
  for (const [e, m] of [...exp.entries()].sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0))) {
    const total = [...m.values()].reduce((x, y) => x + y, 0);
    lines.push(`| ${e} | ${cols.map((c) => m.get(c) ?? "").join(" | ")} | ${total} | ${pct(m.get(e) ?? 0, total)} |`);
  }
  return lines.join("\n");
}

function labelDistribution(rows: Row[]): string {
  const bad = rows.filter((r) => !r.label).length;
  const c = new Map<string, number>();
  for (const r of rows) if (r.label) c.set(r.label.category ?? "(no category)", (c.get(r.label.category ?? "(no category)") ?? 0) + 1);
  const total = rows.length - bad;
  const lines = ["| Label category | Rows | Share | Maps to |", "|---|---:|---:|---|"];
  for (const [k, v] of [...c.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| ${k} | ${v} | ${pct(v, total)} | ${CLASS_MAP[k] ?? "(none)"} |`);
  const withM = rows.filter((r) => r.label?.merchant || r.label?.beneficiary);
  const c2 = new Map<string, number>();
  for (const r of withM) c2.set(r.label!.category ?? "(no category)", (c2.get(r.label!.category ?? "(no category)") ?? 0) + 1);
  const l2 = ["| Label category (merchant/beneficiary-labelled rows only) | Rows | Share |", "|---|---:|---:|"];
  for (const [k, v] of [...c2.entries()].sort((a, b) => b[1] - a[1])) l2.push(`| ${k} | ${v} | ${pct(v, withM.length)} |`);
  return `${lines.join("\n")}\n\n${l2.join("\n")}`;
}

function disagreementList(scored: Scored[]): string {
  const hits = scored.filter((s) => s.disagreement);
  const byReason = new Map<string, Scored[]>();
  for (const s of hits) (byReason.get(s.disagreement!) ?? byReason.set(s.disagreement!, []).get(s.disagreement!)!).push(s);
  if (!hits.length) return "_none flagged_";
  const out = [`${hits.length} direction misses look like label noise (excluded from the direction failure list above, still counted in the direction %).`, ""];
  for (const [reason, list] of byReason) {
    out.push(`- **${list.length}×** ${reason}`);
    const byT = new Map<string, Scored[]>();
    for (const s of list) (byT.get(template(s.row.text)) ?? byT.set(template(s.row.text), []).get(template(s.row.text))!).push(s);
    [...byT.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 15).forEach(([t, l]) => out.push(`  - ${l.length}× \`${md(t)}\` e.g. \`${md(l[0].row.text, 110)}\` (label ${l[0].row.label!.type}, got ${l[0].gotType})`));
  }
  return out.join("\n");
}

// ---------- the eval ----------

describe("FinEE", () => {
  it("scores the reader on the held-out split and writes the report", () => {
    const file = path.join(DATA, `${SPLIT}.jsonl`);
    if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run: node eval/sms/fetch.mjs`);
    const rows = loadRows(file);
    expect(rows.length).toBeGreaterThan(1000);
    const scored = scoreAll(rows);

    const en = scored.filter((s) => s.lang === "en");
    const ind = scored.filter((s) => s.lang !== "en");
    const icici = scored.filter((s) => s.icici);
    const iciciAcct = scored.filter((s) => s.row.label?.account);
    const A = { all: agg(scored), en: agg(en), ind: agg(ind), icici: agg(icici), acct: agg(iciciAcct) };

    const byLang = new Map<string, Scored[]>();
    const byBank = new Map<string, Scored[]>();
    for (const s of scored) {
      (byLang.get(s.lang) ?? byLang.set(s.lang, []).get(s.lang)!).push(s);
      (byBank.get(s.bank) ?? byBank.set(s.bank, []).get(s.bank)!).push(s);
    }
    const unlabelled = scored.filter((s) => !s.row.label || typeof s.row.label.amount !== "number" || !s.row.label.type).length;

    const metrics = {
      recallEn: num(A.en.detected, A.en.labelled),
      recallIn: num(A.ind.detected, A.ind.labelled),
      amount: num(A.all.amountOk, A.all.amountN),
      direction: num(A.all.dirOk, A.all.dirN),
      category: num(A.all.catOk, A.all.catN),
      silentWrong: num(A.all.silent, A.all.catN),
      iciciRecall: num(A.icici.detected, A.icici.labelled),
      iciciAmount: num(A.icici.amountOk, A.icici.amountN),
      p2m: num(A.all.p2mOk, A.all.p2mN),
      p2mDerivable: num(A.all.p2mDOk, A.all.p2mDN),
      merchantDerivable: num(A.all.merDOk, A.all.merDN),
      categoryDerivable: num(A.all.catDOk, A.all.catDN),
    };
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, SPLIT === "test" ? "metrics-finee.json" : `metrics-finee-${SPLIT}.json`), JSON.stringify(metrics));

    const body = [
      `### FinEE \`${SPLIT}\` split`,
      "",
      `${rows.length} rows read, ${unlabelled} not scored (no amount/type label or unparseable label JSON). Each row is one \`planImport([alert], emptyState(), …)\` call with channel \`notification\`, \`viaSmsApp: false\`, \`DEFAULT_CATEGORIES\`, bills on. "Detected" means the outcome was a transaction or a bill.`,
      "",
      "#### Scorecard",
      "",
      metricsTable([
        { name: "All", a: A.all },
        { name: "English", a: A.en },
        { name: "Indian languages", a: A.ind },
        { name: "ICICI templates", a: A.icici },
        { name: "ICICI rows with account label", a: A.acct },
      ]),
      "",
      `_ICICI templates_ = text matching \`${ICICI_TEMPLATE.source}\`. Most FinEE rows are synthetic; only 2,419 ICICI rows are real, and they cannot be told apart from synthetic ICICI-template rows by text alone, so the last column is the closest proxy (the rows that carry a hand-checked \`account\` label).`,
      "",
      "#### By language",
      "",
      groupTable("Language", byLang),
      "",
      "#### By bank (top 25 by rows)",
      "",
      groupTable("Bank", byBank, 25),
      "",
      "#### Category confusion (merchant-labelled rows, dataset class mapped to ours)",
      "",
      `Design decision: a UPI payment to a person stays an expense (it must count in spending) and carries \`toPerson\`. Rows labelled \`transfer\` with \`is_p2m: false\` that we read as an expense or income to a person are counted correct and left out of the matrix below (${A.all.design} rows). This is a deliberate disagreement with the dataset's class, not a reader failure.`,
      "",
      "Mapping: food→food, grocery→groceries, shopping→shopping, transport/travel→transport, bills/emi→bills, healthcare→health, entertainment→entertainment, investment/transfer→tx type transfer, refund→tx type refund, cashback→cashback flag. Rows labelled with a class outside this list are not scored.",
      "",
      confusion(scored),
      "",
      `### Failures by type (top ${TOP_FAIL} templates each)`,
      "",
      "Template = digits to `#`, capitalised name runs to `NAME`.",
      "",
      failureLists(scored),
      "### Label disagreements (likely dataset noise, not reader bugs)",
      "",
      disagreementList(scored),
    ].join("\n");

    // Row-level results for ad-hoc digging (kept in the ignored .data folder).
    fs.writeFileSync(path.join(DATA, SPLIT === "test" ? "scored-finee.json" : `scored-finee-${SPLIT}.json`), JSON.stringify(scored.map(({ row, ...s }) => ({ idx: row.idx, text: row.text, label: row.label, ...s }))));

    writeRegion("finee", body);
    writeRegion("summary", summaryTable());
    expect(A.all.labelled).toBeGreaterThan(0);
  });
});
