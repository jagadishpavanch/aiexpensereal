import { isFinanceAlert, parseAlert, type ParsedAlert } from "@/lib/finance/sms-parse";
import type { Account, FinanceState, Transaction, TxSource } from "@/lib/finance/types";
import { isBankSender, isSameTx, refOf, type TxFingerprint } from "./match";
import type { AlertChannel, ImportItem, Outcome, RawAlert } from "./types";

export interface PlanOptions {
  categorize: (merchant: string, text: string, type: "expense" | "income") => string;
  /** prefs.features.bills: when off, bill alerts are ignored. */
  bills: boolean;
}

const MONEY_HINT = /(?:rs\.?|inr|₹)\s*\d/i;
const MONEY_VERB = /\b(?:debited|credited|spent|paid|received|withdrawn|sent|transferred)\b/i;
const OTP = /\b(?:otp|one[\s-]time password|verification code)\b/i;
const SOURCE: Record<AlertChannel, TxSource> = { sms: "sms", notification: "notification", sample: "sms_demo" };

/** The account a parsed alert belongs to: matching last four digits first (card or not, as the text says), then UPI, then the first bank. */
export function accountFor(p: ParsedAlert, text: string, accounts: Account[]): string {
  if (p.last4) {
    const same = accounts.filter((a) => a.last4 === p.last4);
    const wantCard = /\bcard\b/i.test(text);
    const hit = same.find((a) => (a.kind === "card") === wantCard) ?? same[0];
    if (hit) return hit.id;
  }
  const firstOf = (k: Account["kind"]) => accounts.find((a) => a.kind === k)?.id;
  return (p.isUpi ? firstOf("upi") : undefined) ?? firstOf("bank") ?? accounts[0]?.id ?? "cash";
}

const FALLBACK_MERCHANT = { expense: "Bank payment", income: "Money received", refund: "Refund", transfer: "Transfer" } as const;

const needsSenderCheck = (a: RawAlert) => a.channel === "sms" || (a.channel === "notification" && a.viaSmsApp === true);

/**
 * Decides what each message becomes. Pure: the caller saves the result. Duplicates are checked against earlier
 * imports in the state and against messages earlier in the same batch.
 */
export function planImport(alerts: RawAlert[], state: FinanceState, opts: PlanOptions): ImportItem[] {
  const seen: TxFingerprint[] = state.transactions
    .filter((t) => t.source === "sms" || t.source === "notification")
    .map((t) => ({ type: t.type, amount: t.amount, at: Date.parse(t.date), ref: t.ref }));
  const billKeys = new Set(state.bills.map((b) => `${b.amount}|${b.dueDate.slice(0, 10)}`));
  const hasTransferCategory = state.categories.some((c) => c.id === "transfer");
  const billCategory = state.categories.some((c) => c.id === "bills") ? "bills" : opts.categorize("bill", "", "expense");

  const decide = (a: RawAlert): Outcome => {
    if (needsSenderCheck(a) && !isBankSender(a.from)) return { kind: "ignored", reason: "sender" };
    const parsed = isFinanceAlert(a.text) ? parseAlert(a.text) : null;
    if (!parsed) {
      const looksLikeMoney = MONEY_HINT.test(a.text) && MONEY_VERB.test(a.text) && !OTP.test(a.text);
      return looksLikeMoney ? { kind: "unread" } : { kind: "ignored", reason: "not-money" };
    }
    const accountId = accountFor(parsed, a.text, state.accounts);
    if (parsed.kind === "bill") {
      if (!opts.bills) return { kind: "ignored", reason: "bills-off" };
      const dueDate = parsed.dueDate ?? new Date(a.at).toISOString();
      const key = `${parsed.amount}|${dueDate.slice(0, 10)}`;
      if (billKeys.has(key)) return { kind: "duplicate" };
      billKeys.add(key);
      const name = parsed.last4 ? `Card bill ··${parsed.last4}` : (parsed.merchant ?? "Bill");
      return { kind: "bill", bill: { name, amount: parsed.amount, dueDate, repeat: "none", categoryId: billCategory, accountId } };
    }
    const type = parsed.kind;
    const fp: TxFingerprint = { type, amount: parsed.amount, at: a.at, ref: refOf(a.text) };
    if (seen.some((s) => isSameTx(s, fp))) return { kind: "duplicate" };
    seen.push(fp);
    const merchant = parsed.merchant ?? FALLBACK_MERCHANT[type];
    // A refund undoes an expense and a transfer is not income, so both are categorised as expenses.
    const categoryId = type === "transfer" && hasTransferCategory ? "transfer" : opts.categorize(merchant, a.text, type === "income" ? "income" : "expense");
    const tx: Omit<Transaction, "id"> = {
      type,
      amount: parsed.amount,
      merchant,
      categoryId,
      accountId,
      date: new Date(a.at).toISOString(),
      source: SOURCE[a.channel],
      isDemo: a.channel === "sample",
      ...(parsed.cashback ? { cashback: true } : {}),
      ...(fp.ref ? { ref: fp.ref } : {}),
    };
    return { kind: "tx", tx };
  };

  return [...alerts].sort((a, b) => a.at - b.at).map((alert) => ({ alert, outcome: decide(alert) }));
}
