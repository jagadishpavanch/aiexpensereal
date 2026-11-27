import { describe, expect, it, vi } from "vitest";
import { emptyState } from "@/lib/finance/demo";
import type { FinanceState } from "@/lib/finance/types";
import { planImport, type PlanOptions } from "./plan";
import type { RawAlert } from "./types";

const HDFC_UPI = "Sent Rs.250.00\nFrom HDFC Bank A/C *4821\nTo SWIGGY\nOn 21/10/26\nRef 629104837122\nNot You? Call 18002586161/SMS BLOCK UPI to 7308080808";
const HDFC_CARD = "Spent Rs.1499 On HDFC Bank Card 4821 At AMAZON On 2026-10-21:14:22:10.Not You? To Block+Reissue Call 18002586161";
const ICICI_BILL = "Your ICICI Bank Credit Card XX9012 statement is generated. Total amount due Rs 18,240.50, Minimum amount due Rs 920.00. Pay by 05-Nov-26.";
const BALANCE_ONLY = "HDFC Bank: Amount debited from a/c XX4821. Avl Bal Rs 9,000.00";
const OTP = "123456 is your OTP for login. Do not share it with anyone. -HDFC Bank";
const T = Date.UTC(2026, 9, 21, 9);

const sms = (id: string, text: string, at = T, from = "VM-HDFCBK"): RawAlert => ({ id, channel: "sms", from, text, at });
const opts = { categorize: vi.fn((m: string) => (m === "Swiggy" ? "food" : "shopping")), bills: true };
const plan = (alerts: RawAlert[], s: FinanceState = emptyState(), o: PlanOptions = opts) => planImport(alerts, s, o);

describe("planImport", () => {
  it("turns a bank SMS into a categorised transaction on the right account", () => {
    const [item] = plan([sms("1", HDFC_UPI)]);
    expect(item.outcome).toEqual({
      kind: "tx",
      tx: { type: "expense", amount: 250, merchant: "Swiggy", categoryId: "food", accountId: "hdfc", date: new Date(T).toISOString(), source: "sms", isDemo: false, ref: "629104837122" },
    });
    expect(opts.categorize).toHaveBeenCalledWith("Swiggy", HDFC_UPI, "expense");
  });

  it("puts a card spend on the card with those last four digits", () => {
    const [item] = plan([sms("1", HDFC_CARD)]);
    expect(item.outcome).toMatchObject({ kind: "tx", tx: { accountId: "debit", amount: 1499 } });
  });

  it("never trusts a sender that isn't a bank", () => {
    expect(plan([sms("1", HDFC_UPI, T, "+919876543210")])[0].outcome).toEqual({ kind: "ignored", reason: "sender" });
  });

  it("skips the same payment seen twice, by reference or by amount and time", () => {
    const items = plan([
      sms("1", HDFC_UPI),
      { id: "n1", channel: "notification", app: "com.phonepe.app", from: "PhonePe", text: HDFC_UPI, at: T + 60_000 },
      { id: "n2", channel: "notification", app: "com.phonepe.app", from: "PhonePe", text: "Paid Rs 250 to Swiggy", at: T + 120_000 },
      { id: "n3", channel: "notification", app: "com.phonepe.app", from: "PhonePe", text: "Paid Rs 250 to Swiggy", at: T + 40 * 60_000 },
    ]);
    expect(items.map((i) => i.outcome.kind)).toEqual(["tx", "duplicate", "duplicate", "tx"]);
  });

  it("skips payments already imported earlier", () => {
    const s = emptyState();
    const state = { ...s, transactions: [{ id: "t", type: "expense" as const, amount: 250, categoryId: "food", accountId: "hdfc", merchant: "Swiggy", date: new Date(T - 86_400_000).toISOString(), source: "sms" as const, isDemo: false, ref: "629104837122" }] };
    expect(plan([sms("1", HDFC_UPI)], state)[0].outcome).toEqual({ kind: "duplicate" });
  });

  it("turns a card statement into a bill, unless bills are switched off", () => {
    expect(plan([sms("1", ICICI_BILL, T, "AX-ICICIB")])[0].outcome).toMatchObject({ kind: "bill", bill: { name: "Card bill ··9012", amount: 18240.5, accountId: "card", categoryId: "bills", repeat: "none" } });
    expect(plan([sms("1", ICICI_BILL, T, "AX-ICICIB")], emptyState(), { ...opts, bills: false })[0].outcome).toEqual({ kind: "ignored", reason: "bills-off" });
  });

  it("lists bank money messages it couldn't read, and ignores OTPs", () => {
    expect(plan([sms("1", BALANCE_ONLY)])[0].outcome).toEqual({ kind: "unread" });
    expect(plan([sms("1", OTP)])[0].outcome).toEqual({ kind: "ignored", reason: "not-money" });
  });

  it("checks the sender of SMS-app notifications but not of bank or UPI apps", () => {
    const viaSms: RawAlert = { id: "n", channel: "notification", app: "com.google.android.apps.messaging", viaSmsApp: true, from: "Ramesh", text: HDFC_UPI, at: T };
    expect(plan([viaSms])[0].outcome).toEqual({ kind: "ignored", reason: "sender" });
    expect(plan([{ ...viaSms, from: "VM-HDFCBK" }])[0].outcome).toMatchObject({ kind: "tx", tx: { source: "notification" } });
  });

  it("saves a refund as a refund, categorised as the spend it undoes", () => {
    const text = "Refund of Rs 499.00 for your Amazon order has been credited to your HDFC Bank Card XX9012";
    const o = { ...opts, categorize: vi.fn(() => "shopping") };
    const [item] = plan([sms("1", text)], emptyState(), o);
    expect(item.outcome).toMatchObject({ kind: "tx", tx: { type: "refund", amount: 499, merchant: "Amazon", categoryId: "shopping" } });
    expect(o.categorize).toHaveBeenCalledWith("Amazon", text, "expense");
  });

  it("saves moving your own money as a transfer, using the transfer category when there is one", () => {
    const text = "Rs 5,000.00 transferred from A/c XX4821 to your A/c XX1111 on 21-10-26.";
    const s = emptyState();
    const [plain] = plan([sms("1", text)], s);
    expect(plain.outcome).toMatchObject({ kind: "tx", tx: { type: "transfer", amount: 5000, merchant: "Transfer", categoryId: "shopping" } });
    const withCat = { ...s, categories: [...s.categories, { ...s.categories[0], id: "transfer", name: "Transfer" }] };
    expect(plan([sms("1", text)], withCat)[0].outcome).toMatchObject({ kind: "tx", tx: { type: "transfer", categoryId: "transfer" } });
  });

  it("flags a cashback credit as cashback income", () => {
    const [item] = plan([sms("1", "Cashback of Rs 25.00 credited to your Paytm wallet for order #1234")]);
    expect(item.outcome).toMatchObject({ kind: "tx", tx: { type: "income", amount: 25, cashback: true } });
    expect((plan([sms("1", HDFC_UPI)])[0].outcome as { tx: { cashback?: boolean } }).tx.cashback).toBeUndefined();
  });

  it("ignores a failed payment that the bank says will be reversed", () => {
    const [item] = plan([sms("1", "Your transaction of Rs 250.00 to SWIGGY has failed. Amount debited, if any, will be reversed within 3 days.")]);
    expect(item.outcome.kind).not.toBe("tx");
  });

  it("marks samples as demo data and returns items oldest first", () => {
    const items = plan([
      { id: "b", channel: "sample", from: "", text: HDFC_CARD, at: T + 1 },
      { id: "a", channel: "sample", from: "", text: HDFC_UPI, at: T },
    ]);
    expect(items.map((i) => i.alert.id)).toEqual(["a", "b"]);
    expect(items[0].outcome).toMatchObject({ kind: "tx", tx: { source: "sms_demo", isDemo: true } });
  });
});
