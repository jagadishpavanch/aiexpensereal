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

// ---------- amounts ----------

const AMOUNT_G = /(?<![a-z])(?:rs\.?|inr|₹)\s*(\d[\d,]*(?:\.\d{1,2})?)/gi;
/** SBI style: "debited by 500.0" with no currency marker. Only used when nothing else carries a currency. */
const BARE_AMOUNT = /\b(?:debited|credited)\s+(?:by|with|for)\s+(\d[\d,]*(?:\.\d+)?)/i;
/** The words right before an amount that make it a balance or limit rather than the transaction. */
const BALANCE_LABEL = /\b(?:avl|avail|available|bal|balance|lmt|limit)\b(?:(?!debited|credited|spent|paid|withdrawn)[^.;|]){0,30}$/i;
/** "Rs 9,000 is your Avl Bal": the amount is a balance only when the label names it ("is", "the", "your"). A bare "Rs 450 Avl Limit Rs 5000" is a spend followed by a limit. */
const BALANCE_AFTER = /^\s*(?:(?:is|the|your)\s+)+(?:avl\.?|avail\w*)\s*(?:bal\w*|lmt|limit)/i;
const MIN_LABEL = /\bmin(?:imum)?\b[^.;]{0,20}$/i;

interface Candidate { value: number; balance: boolean; min: boolean }

function candidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  let prevEnd = 0;
  for (const m of text.matchAll(AMOUNT_G)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const before = text.slice(prevEnd, start).slice(-45);
    const sentence = before.split(/[.!?]\s|\n/).pop() ?? "";
    out.push({
      value: Number(m[1].replace(/,/g, "")),
      balance: BALANCE_LABEL.test(sentence) || BALANCE_AFTER.test(text.slice(end, end + 30)),
      min: MIN_LABEL.test(sentence),
    });
    prevEnd = end;
  }
  if (!out.length) {
    const b = text.match(BARE_AMOUNT);
    if (b) out.push({ value: Number(b[1].replace(/,/g, "")), balance: false, min: false });
  }
  return out;
}

/** The transaction amount: the first amount that is not a balance, limit or minimum due. */
function transactionAmount(text: string): number | null {
  const ok = candidates(text).filter((c) => !c.balance && Number.isFinite(c.value) && c.value > 0);
  return (ok.find((c) => !c.min) ?? ok[0])?.value ?? null;
}

// ---------- classification ----------

const DEBIT = /\b(?:debited|spent|withdrawn|purchase|paid|used|transferred|sent(?!\s+you))\b|\bdebit\b(?!\s*card)/gi;
const CREDIT = /\b(?:credited|received|deposited|refund(?:ed)?|cashback|reversed|sent you)\b|\bcredit alert\b/gi;
const BILL = /\b(bill|due|statement|emi|premium)\b/i;
const DUE = /(?:due(?:\s*(?:date|on|by))?|pay(?:able)?\s+by|on or before)\s*(?:is\s*)?:?\s*(\d{1,2})(?:st|nd|rd|th)?[-/ ]([a-z]{3,9}|\d{1,2})[-/ ](\d{2,4})/i;
const LAST4 = /\b(?:a\/c|ac|acct|account|card)\b\s*(?:no\.?\s*)?(?:ending\s*(?:in|with)?\s*)?[x*]*\s*(\d{4})\b/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const OTP = /\botp\b[^.]{0,25}\b\d{4,8}\b|\b\d{4,8}\b[^.]{0,25}\botp\b|\botp\s+(?:is|for)\b|\bone[- ]?time\s+(?:password|pin)\b|verification code/i;
const DONE = /\b(?:debited|credited|withdrawn|spent)\b/i;
const PROMO = /\b(?:offers?|click|win|apply now|limited period|t\s*&\s*c|tncs?|congratulations|hurry|coupon|use code|promo(?:code)?|discount|exclusive|pre-?approved)\b|\bflat\s*\d+\s*%|\bget\s+(?:rs\.?|inr|₹)\s*[\d,]+\s*(?:cashback|off)|will be credited/i;
/** Real alerts carry a masked account/card number or a bank reference; promotions do not. */
const TXN_ID = /\b(?:a\/c|ac|acct|account|card)\b[^\n]{0,20}?(?:[x*]+\s*\d{3,4}|\d{4})\b|\bref(?:erence)?\s*(?:no\.?|number)?\s*[:.]?\s*\d{6,}|\bupi\/[a-z0-9]+\/\d{6,}/i;

/** A past-tense money verb: something already happened. */
const PAST_TXN = /\b(?:debited|spent|paid|sent|withdrawn|credited|received|refund(?:ed)?)\b/i;
/** Future or conditional wording: "will be credited", "you could win", "get Rs 200 ...". */
const FUTURE = /\b(?:will|shall|would|could|can|may|to\s+be)\s+(?:be\s+)?(?:credited|debited|refunded|received|win|get|earn)\b|\bget\s+(?:flat\s+)?(?:rs\.?|inr|₹)/i;

/** Cues that only marketing uses, wherever they sit in the message: "pre-approved", "offer ends", "Rs 500 off", "10% off". */
const HARD_PROMO = /\b(?:pre-?approved|apply now|loan offer|limited period|offer ends)\b|\b\d+\s*%\s*off\b|(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d+)?\s+off\b/i;

/**
 * A completed transaction that merely carries a promo word ("Click to view receipt", "Win Pharmacy"):
 * a past-tense verb and an amount, with no promo cue ahead of the first of them and no future wording.
 */
function looksLikeCompletedTxn(text: string): boolean {
  const verb = PAST_TXN.exec(text);
  const amount = /(?<![a-z])(?:rs\.?|inr|₹)\s*\d/i.exec(text);
  if (!verb || !amount || FUTURE.test(text) || HARD_PROMO.test(text)) return false;
  const promo = PROMO.exec(text);
  return !promo || promo.index > Math.min(verb.index, amount.index);
}

function isNoise(text: string): boolean {
  if (OTP.test(text) && !DONE.test(text)) return true;
  return PROMO.test(text) && !TXN_ID.test(text) && !looksLikeCompletedTxn(text);
}

function firstIndex(re: RegExp, text: string): number {
  re.lastIndex = 0;
  const m = re.exec(text);
  re.lastIndex = 0;
  return m ? m.index : -1;
}

/** Whichever of debit or credit wording comes first decides the direction ("refund ... credited" is income). */
function direction(text: string): "expense" | "income" | null {
  const d = firstIndex(DEBIT, text);
  const c = firstIndex(CREDIT, text);
  if (d < 0 && c < 0) return null;
  if (c < 0) return "expense";
  if (d < 0) return "income";
  return d < c ? "expense" : "income";
}

function parseDue(m: RegExpMatchArray): string | undefined {
  const day = Number(m[1]);
  const mon = /^\d+$/.test(m[2]) ? Number(m[2]) - 1 : MONTHS.indexOf(m[2].toLowerCase().slice(0, 3));
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (mon < 0 || mon > 11 || day < 1 || day > 31) return undefined;
  return new Date(year, mon, day, 9).toISOString();
}

// ---------- merchant ----------

const NAME = "([a-z][a-z0-9@._&'\\- ]{1,40}?)";
const END = "(?=\\s+(?:on|ref|refno|via|using|from|in|upi|avl|bal|txn|if|not|for|towards|dated|dt)\\b|\\s*\\(|\\s*[,;|/]|\\.(?:\\s|$)|\\s+-|\\s*[\\r\\n]|\\s*$)";
const re = (src: string) => new RegExp(src, "gi");

const EXPENSE_MERCHANT = [
  re(`\\bupi\\/(?:[a-z0-9]+\\/)*?\\d{6,}\\/${NAME}${END}`),
  re(`\\bto\\s+vpa\\s+${NAME}${END}`),
  re(`\\bat\\s+${NAME}${END}`),
  re(`\\b(?:trf to|transfer to|paid to|sent to|payment to|to)\\s+${NAME}${END}`),
  re(`;\\s*${NAME}\\s+credited\\b`),
];
const INCOME_MERCHANT = [re(`^\\s*${NAME}\\s+sent you\\b`), re(`\\bfrom\\s+${NAME}${END}`)];
/** Words that start a phrase that is not a merchant ("to Block+Reissue", "from A/c XX1234"). */
const NOT_A_NAME = /^(?:a|ac|a\/c|acct|account|avl|your|the|my|block|call|card|rs|inr|xx|x+|avoid|pay|be|get|see|view|check|know|update|stop|activate|dispute|reissue|continue)\b/i;

function merchantOf(text: string, kind: ParsedAlert["kind"]): string | undefined {
  for (const pattern of kind === "income" ? INCOME_MERCHANT : EXPENSE_MERCHANT) {
    for (const m of text.matchAll(pattern)) {
      const name = m[1]
        .replace(/@.*/, "")
        .replace(/\s*-\s*sal(?:ary)?\b.*$/i, "")
        .replace(/[\s\-.]+$/, "")
        .replace(/\s+/g, " ")
        .trim();
      if (name.length < 2 || NOT_A_NAME.test(name) || !/[a-z]{2}/i.test(name)) continue;
      return name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
    }
  }
  return undefined;
}

// ---------- public API ----------

export function parseAlert(text: string): ParsedAlert | null {
  if (isNoise(text)) return null;
  const amount = transactionAmount(text);
  if (amount === null) return null;
  const due = text.match(DUE);
  const isBill = BILL.test(text) && !!due && firstIndex(DEBIT, text.replace(/due/gi, "")) < 0;
  const kind: ParsedAlert["kind"] = isBill ? "bill" : direction(text) ?? "expense";
  return {
    kind,
    amount,
    merchant: merchantOf(text, kind),
    last4: text.match(LAST4)?.[1],
    dueDate: isBill && due ? parseDue(due) : undefined,
    isUpi: /\bupi\b|vpa/i.test(text),
  };
}

/** Only bank, card, UPI and bill alerts are kept; OTPs, promotions, balance-only and chat texts are ignored on the phone. */
export function isFinanceAlert(text: string) {
  if (isNoise(text) || transactionAmount(text) === null) return false;
  return direction(text) !== null || (BILL.test(text) && DUE.test(text));
}
