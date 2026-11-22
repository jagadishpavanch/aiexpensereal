/**
 * Reads Indian bank / UPI / bill alerts and pulls out the money details.
 * Runs entirely on-device. The Android app will feed it SMS and notification text.
 */
export interface ParsedAlert {
  kind: "expense" | "income" | "bill";
  amount: number;
  merchant?: string;
  last4?: string;
  dueDate?: string; // ISO, bills only
  isUpi: boolean;
}

const AMOUNT = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
const DEBIT = /\b(debited|spent|used|paid|sent|withdrawn|purchase)\b/i;
const CREDIT = /\b(credited|received|deposited|refund(?:ed)?|cashback)\b/i;
const BILL = /\b(bill|due|statement|emi|premium)\b/i;
const LAST4 = /(?:a\/c|acct|account|card)\s*(?:no\.?\s*)?(?:ending\s*)?(?:[x*]+)?\s*(\d{4})\b/i;
const MERCHANT = /(?:to vpa|to|at|from|by neft from|by upi from)\s+([a-z0-9@._&\- ]{2,40}?)(?=\s+on\b|\s+ref\b|\s*\(|[.,]|\s+avl|\s+upi|$)/i;
const DUE = /due\s*(?:date|on|by)?\s*:?\s*(\d{1,2})[-/ ]([a-z]{3}|\d{1,2})[-/ ](\d{2,4})/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function parseDue(m: RegExpMatchArray): string | undefined {
  const day = Number(m[1]);
  const mon = /^\d+$/.test(m[2]) ? Number(m[2]) - 1 : MONTHS.indexOf(m[2].toLowerCase());
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (mon < 0 || mon > 11 || day < 1 || day > 31) return undefined;
  return new Date(year, mon, day, 9).toISOString();
}

export function parseAlert(text: string): ParsedAlert | null {
  const a = text.match(AMOUNT);
  if (!a) return null;
  const amount = Number(a[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const due = text.match(DUE);
  const isBill = BILL.test(text) && !!due && !DEBIT.test(text.replace(/due/gi, ""));
  const kind: ParsedAlert["kind"] = isBill ? "bill" : DEBIT.test(text) ? "expense" : CREDIT.test(text) ? "income" : "expense";
  const merchantRaw = text.match(MERCHANT)?.[1]?.trim();
  const merchant = merchantRaw?.replace(/@.*/, "").replace(/\s+/g, " ").trim();
  return {
    kind,
    amount,
    merchant: merchant ? merchant.replace(/\b\w/g, (c) => c.toUpperCase()) : undefined,
    last4: text.match(LAST4)?.[1],
    dueDate: isBill && due ? parseDue(due) : undefined,
    isUpi: /\bupi\b|vpa/i.test(text),
  };
}

/** Only bank, card, UPI and bill alerts are kept; everything else is ignored on the phone. */
export function isFinanceAlert(text: string) {
  return AMOUNT.test(text) && (DEBIT.test(text) || CREDIT.test(text) || (BILL.test(text) && DUE.test(text)));
}
