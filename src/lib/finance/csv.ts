import type { Transaction, TxType } from "./types";

export interface CsvRow {
  date: string;
  amount: number;
  merchant: string;
  type: TxType;
  category: string;
}

export function parseCSV(text: string) {
  const lines = text.trim().split(/\r?\n/);
  const header = (lines.shift() ?? "").split(",").map((h) => h.trim().toLowerCase());
  const idx = (k: string) => header.indexOf(k);
  const rows: CsvRow[] = [];
  const errors: { line: number; reason: string }[] = [];
  lines.forEach((line, i) => {
    const c = line.split(",").map((x) => x.trim());
    const date = c[idx("date")];
    const amount = Number(c[idx("amount")]);
    const merchant = c[idx("merchant")] ?? "";
    const type = (c[idx("type")] || "expense") as TxType;
    const category = c[idx("category")] || "other";
    if (!date || isNaN(new Date(date).getTime())) return errors.push({ line: i + 2, reason: "Invalid date" });
    if (!isFinite(amount) || amount <= 0) return errors.push({ line: i + 2, reason: "Invalid amount" });
    if (!merchant) return errors.push({ line: i + 2, reason: "Missing merchant" });
    if (!["expense", "income", "transfer", "refund"].includes(type)) return errors.push({ line: i + 2, reason: "Unknown type" });
    rows.push({ date: new Date(date).toISOString(), amount, merchant, type, category });
  });
  return { rows, errors };
}

export function toCSV(txs: Transaction[]) {
  const head = "date,amount,merchant,type,category,account,source,note";
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [head, ...txs.map((t) => [t.date, t.amount, esc(t.merchant), t.type, t.categoryId, t.accountId, t.source, esc(t.note ?? "")].join(","))].join("\n");
}
