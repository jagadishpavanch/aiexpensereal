import type { Transaction, TxType } from "./types";

export interface CsvRow {
  date: string;
  amount: number;
  merchant: string;
  type: TxType;
  category: string;
}

/** Splits CSV text into rows of cells, following RFC 4180 quoting ("a, b" and "say ""hi""" stay one cell). */
export function splitCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** A cell starting with one of these runs as a formula in Excel or Sheets. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Undoes the formula guard toCSV adds, so a round trip gives back the original text. */
const unguard = (s: string) => (s.startsWith("'") && FORMULA_START.test(s.slice(1)) ? s.slice(1) : s);

export function parseCSV(text: string) {
  const [head = [], ...lines] = splitCSV(text.trim());
  const header = head.map((h) => h.trim().toLowerCase());
  const idx = (k: string) => header.indexOf(k);
  const rows: CsvRow[] = [];
  const errors: { line: number; reason: string }[] = [];
  lines.forEach((cells, i) => {
    const c = cells.map((x) => unguard(x.trim()));
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
  // Merchant names come from bank SMS, where the payer chooses the name. A cell that would run as a formula
  // gets a leading apostrophe (parseCSV takes it off again).
  const esc = (raw: string) => {
    const s = FORMULA_START.test(raw) ? `'${raw}` : raw;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head, ...txs.map((t) => [t.date, t.amount, esc(t.merchant), t.type, t.categoryId, t.accountId, t.source, esc(t.note ?? "")].join(","))].join("\n");
}
