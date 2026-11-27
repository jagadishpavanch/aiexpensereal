/**
 * Reads Indian bank / UPI / bill alerts and pulls out the money details.
 * Runs entirely on-device. The Android app will feed it SMS and notification text.
 */
export interface ParsedAlert {
  /** "refund" gives money back for an earlier spend; "transfer" moves your own money (card bill payment, own-account move, wallet top-up). */
  kind: "expense" | "income" | "bill" | "refund" | "transfer";
  amount: number;
  merchant?: string;
  last4?: string;
  dueDate?: string; // ISO, bills only
  isUpi: boolean;
  /** Set on cashback credits, so they can be told apart from salary or a friend paying you back. */
  cashback?: true;
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

// "Dr." and "Cr." are Bank of Baroda style abbreviations for debited and credited.
const DEBIT = /\b(?:debited|spent|withdrawn|purchase|paid|used|transferred|deducted|dr|sent(?!\s+you))\b|\bdebit\b(?!\s*card)/gi;
const CREDIT = /\b(?:credited|received|deposited|refund(?:ed)?|cashback|reversed|cr|sent you)\b|\bcredit alert\b/gi;
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

/** A transaction that did not happen, or whose money is only promised back: "has failed", "declined", "will be reversed within 3 days". */
const FAILED = /\b(?:failed|declined|unsuccessful|rejected|not\s+successful|(?:could|can)\s?not\s+be\s+processed|unable\s+to\s+process|insufficient\s+(?:funds|balance))\b|\bwill\s+be\s+(?:reversed|refunded|credited\s+back)\b/i;
const PROMISED_REVERSAL = /\bwill\s+be\s+(?:reversed|refunded|credited\s+back)\b/gi;
/** A reversal that already landed ("reversed to your A/c", "has been refunded"), even though the text may say "failed txn". */
const COMPLETED_REVERSAL = /\b(?:reversed|refunded)\s+(?:back\s+)?to\b|\b(?:has|have)\s+been\s+(?:credited|reversed|refunded)\b/i;
/** UPI collect requests ask you to pay; nothing has moved yet. */
const PAY_REQUEST = /\brequested\s+(?:rs\.?|inr|₹)|\bcollect\s+request\b/i;
/** Creating or cancelling an AutoPay/e-mandate moves no money, unless the text also says a debit happened. */
const MANDATE_SETUP = /\b(?:auto-?pay|e-?mandate|mandate|standing\s+instruction)\b.{0,60}?\b(?:created|registered|set\s?up|activated|approved|cancell?ed|paused|revoked|successfully)\b/i;
const MONEY_MOVED = /\b(?:debited|spent|paid|deducted|charged|credited)\b/i;

/** Tax the bank withholds on your interest is not something you spent, unless the same message also credits money. */
const TDS_DEDUCTED = /\btds\b.{0,40}?\bdeducted\b|\bdeducted\b.{0,40}?\btds\b/i;

function didNotHappen(text: string): boolean {
  if (TDS_DEDUCTED.test(text) && !/\bcredited\b/i.test(text)) return true;
  if (FAILED.test(text) && !COMPLETED_REVERSAL.test(text.replace(PROMISED_REVERSAL, ""))) return true;
  return PAY_REQUEST.test(text) || (MANDATE_SETUP.test(text) && !MONEY_MOVED.test(text));
}

function isNoise(text: string): boolean {
  if (didNotHappen(text)) return true;
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

// Moves of your own money are neither spending nor income. Each pattern names one wording banks use.
/** "Payment of Rs 18,240.50 received towards your ICICI Bank Credit Card XX9012". */
const CARD_BILL_PAID = /\bpayment\b.{0,60}?\breceived\s+towards\b.{0,40}?\bcard\b/i;
/** "Rs 5,000 transferred from A/c XX4821 to your A/c XX1111". */
const OWN_ACCOUNT = /\btransferred\b.{0,50}?\bto\s+your\s+(?:own\s+)?(?:a\/c|ac|acct|account)\b/i;
/** "Rs 500 added to your Paytm Wallet using HDFC Bank card XX4821": the card spend is the real expense. */
const WALLET_TOPUP = /\b(?:added|loaded)\b.{0,20}?\bto\s+your\b.{0,25}?\bwallet\b/i;
const CASHBACK = /\bcashback\b/i;
/** Putting money into investments (or taking it back out) moves wealth, it is not spending or income. */
const INVESTMENT = /\bmutual\s+funds?\b|\bmf\b|\bredemption\b|\bredeemed\b|\b(?:for|towards|of)\s+sip\b|\bsip\s+(?:in|of|installment|instalment|investment|folio|amount|payment)\b|\b(?:zerodha|groww|upstox|kuvera|smallcase|indmoney|demat)\b|\bstocks?\b/i;
/** "Payment of Rs 1,340 towards BESCOM bill is successful", "Recharge of Rs 299 successful": completed spending with no debit verb. */
const SUCCESS_PAYMENT = /\b(?:payment|recharge)\b.{0,100}?\bsuccessful(?:ly)?\b/i;
/** "Standing instruction of Rs 2,500 executed to RD A/c XX5566": a standing order into your own savings. */
const SAVINGS_INSTRUCTION = /\bstanding\s+instruction\b.{0,60}?\bexecuted\b.{0,30}?\b(?:rd|fd|ppf|recurring|fixed|savings)\b/i;
/** Income tax and GST refunds are money from the government, not a purchase coming back, so they must not reduce spending. */
const TAX_REFUND = /\b(?:income\s+tax|gst)\s+refund\b/i;
const REFUND = /\brefund(?:ed)?\b|\breversed\b|\breversal\b/i;

/** What the message is, or null when it is not a money movement. */
function classify(text: string): ParsedAlert["kind"] | null {
  if (CARD_BILL_PAID.test(text) || OWN_ACCOUNT.test(text)) return "transfer";
  if (WALLET_TOPUP.test(text) && !CASHBACK.test(text)) return "transfer";
  if (SAVINGS_INSTRUCTION.test(text)) return "transfer";
  const dir = direction(text) ?? (SUCCESS_PAYMENT.test(text) ? "expense" : null);
  if (dir && INVESTMENT.test(text)) return "transfer";
  if (dir === "income" && REFUND.test(text) && !TAX_REFUND.test(text)) return "refund";
  return dir;
}

function isBillAlert(text: string): boolean {
  return BILL.test(text) && DUE.test(text) && firstIndex(DEBIT, text.replace(/due/gi, "")) < 0;
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
const END = "(?=\\s+(?:on|ref|refno|via|using|from|in|upi|avl|bal|txn|if|not|for|towards|dated|dt|credited)\\b|\\s*\\(|\\s*[,;|/]|\\.(?:\\s|$)|\\s+-|\\s*[\\r\\n]|\\s*$)";
const re = (src: string) => new RegExp(src, "gi");

/** "paid towards BESCOM electricity bill", "for Jio number 98XXXXX210": the biller is named before the bill or number. */
const BILLER = [
  re(`\\b(?:towards|to)\\s+${NAME}\\s+(?:electricity|water|gas|broadband|dth|fibernet|postpaid|prepaid|mobile|bill)\\b`),
  re(`\\bfor\\s+${NAME}\\s+(?:number|mobile|dth)\\b`),
  re(`\\byour\\s+${NAME}\\s+bill\\s+of\\b.{0,40}?\\bpaid\\b`), // "Your BESCOM bill of Rs 1,340 has been paid"
];
/** "for IRCTC ticket booking", "for your Amazon order": the shop is named before the thing bought. */
const ITEM_MERCHANT = re(`\\bfor\\s+(?:your\\s+)?${NAME}\\s+(?:order|purchase|booking|ticket|subscription)\\b`);
const EXPENSE_MERCHANT = [
  re(`\\b(?:towards|for)\\s+(?:nach|ecs|ach)[-\\s/:]+${NAME}${END}`), // auto-debit: "towards NACH-ICICI PRU LIFE"
  re(`\\b(?:mandate|auto-?pay(?!\\s+mandate))\\s+(?!(?:of|for|id|ref|no)\\b)${NAME}${END}`), // "for UPI AutoPay mandate SPOTIFY"
  ...BILLER,
  re(`\\bupi\\/(?:[a-z0-9]+\\/)*?\\d{6,}\\/${NAME}${END}`),
  re(`\\bto\\s+vpa\\s+${NAME}${END}`),
  re(`\\bat\\s+${NAME}${END}`),
  re(`\\b(?:trf to|transfer to|paid to|sent to|payment to|to)\\s+${NAME}${END}`),
  re(`;\\s*${NAME}\\s+credited\\b`),
  ITEM_MERCHANT,
];
/** "Refund of Rs 499 for your Amazon order": the shop is the one named before "order". */
const REFUND_MERCHANT = [ITEM_MERCHANT, re(`\\bfor\\s+${NAME}${END}`)];
const INCOME_MERCHANT = [re(`^\\s*${NAME}\\s+sent you\\b`), re(`\\bfrom\\s+${NAME}${END}`)];
/** "debited for SIP in AXIS BLUECHIP FUND": the fund is the one named after "SIP in". */
const INVEST_MERCHANT = [re(`\\bsip\\s+(?:in|of|to)\\s+${NAME}${END}`), ...INCOME_MERCHANT];
/** Words that start a phrase that is not a merchant ("to Block+Reissue", "from A/c XX1234"). */
const NOT_A_NAME = /^(?:failed|a|ac|a\/c|acct|account|avl|your|the|my|block|call|card|rs|inr|xx|x+|avoid|pay|be|get|see|view|check|know|update|stop|activate|dispute|reissue|continue)\b/i;

function merchantOf(text: string, kind: ParsedAlert["kind"]): string | undefined {
  const patterns = kind === "income" ? INCOME_MERCHANT : kind === "refund" ? [...REFUND_MERCHANT, ...INCOME_MERCHANT] : kind === "transfer" ? INVEST_MERCHANT : EXPENSE_MERCHANT;
  for (const pattern of patterns) {
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

/** A cash withdrawal at an ATM: the merchant is the withdrawal itself, not the terminal id that follows "at". */
/** A bank charge: "debited as forex markup fee", "towards cheque return charges". The fee is its own merchant, in sentence case. */
const BANK_FEE = /\b(?:as|towards|for)\s+((?:[a-z]+\s+){0,3}?(?:fees?|charges?|penalty))\b/i;
const FASTAG = /\bfastag\b/i;

/** Expenses whose merchant is a kind of payment rather than a named shop: cash at an ATM, a FASTag toll, a bank fee. */
function specialExpenseMerchant(text: string): string | undefined {
  if (ATM_CASH.test(text)) return "ATM withdrawal";
  if (FASTAG.test(text)) return "FASTag toll";
  const fee = text.match(BANK_FEE)?.[1];
  if (fee) return fee.charAt(0).toUpperCase() + fee.slice(1).toLowerCase();
  return undefined;
}

const DIVIDEND = /\bdividend\b/i;
const ATM_CASH =/\batm\b/i;
/** UPI by name, or a VPA ("ramesh@ybl": a handle with no dot after it, unlike an email address). */
const UPI = /\bupi\b|vpa|[\w.-]{2,}@[a-z][a-z0-9]{1,20}\b(?!\.[a-z])/i;

export function parseAlert(text: string): ParsedAlert | null {
  if (isNoise(text)) return null;
  const amount = transactionAmount(text);
  if (amount === null) return null;
  const due = text.match(DUE);
  const isBill = isBillAlert(text);
  const kind = isBill ? "bill" : classify(text);
  if (!kind) return null;
  let merchant = kind === "expense" ? specialExpenseMerchant(text) ?? merchantOf(text, kind) : merchantOf(text, kind);
  if (kind === "income" && TAX_REFUND.test(text)) merchant = "Income Tax refund";
  if (kind === "income" && DIVIDEND.test(text)) merchant = merchant?.replace(/\s+(?:ltd|limited)$/i, ""); // "Infosys Ltd" pays as "Infosys"
  return {
    kind,
    amount,
    merchant,
    last4: text.match(LAST4)?.[1],
    dueDate: isBill && due ? parseDue(due) : undefined,
    isUpi: UPI.test(text),
    ...(kind === "income" && CASHBACK.test(text) ? { cashback: true as const } : {}),
  };
}

/** Only bank, card, UPI and bill alerts are kept; OTPs, promotions, balance-only and chat texts are ignored on the phone. */
export function isFinanceAlert(text: string) {
  if (isNoise(text) || transactionAmount(text) === null) return false;
  return classify(text) !== null || isBillAlert(text) || (BILL.test(text) && DUE.test(text));
}
