import { describe, expect, it } from "vitest";
import { DEMO_SMS, DEMO_SMS_EXTRA } from "./demo";
import { isFinanceAlert, parseAlert, type ParsedAlert } from "./sms-parse";

interface Case {
  name: string;
  text: string;
  alert: boolean;
  expect?: Partial<ParsedAlert>;
}

/** Realistic Indian bank, card and UPI messages. The amount must be the transaction, never a balance or limit. */
const CORPUS: Case[] = [
  // --- HDFC ---
  { name: "HDFC UPI sent", alert: true, text: "Sent Rs.250.00\nFrom HDFC Bank A/C *4821\nTo SWIGGY\nOn 21/10/26\nRef 629104837122\nNot You? Call 18002586161/SMS BLOCK UPI to 7308080808", expect: { kind: "expense", amount: 250, merchant: "Swiggy", last4: "4821", isUpi: true } },
  { name: "HDFC debit card spend", alert: true, text: "Spent Rs.1499 On HDFC Bank Card 4821 At AMAZON On 2026-10-21:14:22:10.Not You? To Block+Reissue Call 18002586161", expect: { kind: "expense", amount: 1499, merchant: "Amazon", last4: "4821" } },
  { name: "HDFC salary credit with Avl bal", alert: true, text: "Rs.58000.00 credited to HDFC Bank A/c XX4821 on 01-10-26 by NEFT from ACME LABS PVT LTD-SAL CR. Avl bal Rs.1,48,220.50", expect: { kind: "income", amount: 58000, last4: "4821" } },
  { name: "HDFC UPI debit to VPA, Avl Bal after", alert: true, text: "HDFC Bank: Rs 4,520.00 debited from a/c **4821 on 12-10-26 to VPA zomato@okaxis (UPI Ref No 629999111222). Avl Bal Rs 1,00,000.00", expect: { kind: "expense", amount: 4520, merchant: "Zomato", last4: "4821", isUpi: true } },
  { name: "HDFC credit card spend", alert: true, text: "Rs 12,000.00 was spent on your HDFC Bank Credit Card ending 4821 at MAKEMYTRIP on 21-10-26.", expect: { kind: "expense", amount: 12000, merchant: "Makemytrip", last4: "4821" } },
  { name: "HDFC ATM withdrawal", alert: true, text: "Rs 5,000.00 withdrawn from A/c XX4821 at HDFC ATM on 21-10-26. Avl Bal Rs 20,000.00", expect: { kind: "expense", amount: 5000, last4: "4821" } },
  // --- ICICI ---
  { name: "ICICI debit, merchant after semicolon", alert: true, text: "ICICI Bank Acct XX821 debited Rs. 1,250.00 on 21-Oct-26; SWIGGY credited. UPI:629104837122. Call 18002662 for dispute.", expect: { kind: "expense", amount: 1250, merchant: "Swiggy", isUpi: true } },
  { name: "ICICI credit card spend with Avl Limit", alert: true, text: "ICICI Bank Credit Card XX9012 has been used for a transaction of INR 3,499.00 on 20-Oct-26 at MYNTRA. Avl Limit: INR 1,46,501.00.", expect: { kind: "expense", amount: 3499, merchant: "Myntra", last4: "9012" } },
  { name: "ICICI card statement with minimum due", alert: true, text: "Your ICICI Bank Credit Card XX9012 statement is generated. Total amount due Rs 18,240.50, Minimum amount due Rs 920.00. Pay by 05-Nov-26.", expect: { kind: "bill", amount: 18240.5, last4: "9012" } },
  // --- SBI ---
  { name: "SBI UPI debit without Rs", alert: true, text: "Dear UPI user A/C X4821 debited by 500.0 on date 21Oct26 trf to RAMESH KUMAR Refno 629104837122 If not u? call 1800111109. -SBI", expect: { kind: "expense", amount: 500, merchant: "Ramesh Kumar", last4: "4821" } },
  { name: "SBI credit by transfer", alert: true, text: "Dear SBI User, your A/c X4821 credited by Rs.30000 on 01Nov26 transfer from MR ANITA SHARMA Ref No 4455667788. -SBI", expect: { kind: "income", amount: 30000, last4: "4821" } },
  { name: "SBI Card spend with available limit", alert: true, text: "Alert: INR 5,600.00 spent on SBI Card ending 7788 at DECATHLON on 22-10-26. Available credit limit INR 94,400.00.", expect: { kind: "expense", amount: 5600, merchant: "Decathlon", last4: "7788" } },
  { name: "SBI Card payment due", alert: true, text: "SBI Card: Payment of Rs 12,400.00 is due on 10-Nov-26 for card ending 7788. Min due Rs 620. Pay now to avoid late fee.", expect: { kind: "bill", amount: 12400, last4: "7788" } },
  // --- Axis ---
  { name: "Axis UPI P2M with Avl Bal", alert: true, text: "INR 800.00 debited A/c no. XX4821 05-11-26 12:44:10 UPI/P2M/630011223344/BigBasket Avl Bal INR 45,200.00 Not you? SMS BLOCK 4821 to 18004195959 -Axis Bank", expect: { kind: "expense", amount: 800, merchant: "Bigbasket", last4: "4821", isUpi: true } },
  { name: "Axis available balance printed before the amount", alert: true, text: "Available balance Rs 45,200.00. Rs 800.00 debited from A/c XX4821 on 05-11-26 at BIGBASKET.", expect: { kind: "expense", amount: 800, merchant: "Bigbasket" } },
  { name: "Balance listed first, transaction after", alert: true, text: "Avl Bal Rs 9,999.00 | Spent Rs 450.00 on card XX1234 at CROMA.", expect: { kind: "expense", amount: 450, merchant: "Croma", last4: "1234" } },
  // --- Kotak ---
  { name: "Kotak UPI sent to VPA", alert: true, text: "Sent Rs.300.00 from Kotak Bank AC X4821 to rapido@ybl on 21-10-26.UPI Ref 629104837122. Not you, https://kotak.com/Fraud", expect: { kind: "expense", amount: 300, merchant: "Rapido", last4: "4821", isUpi: true } },
  { name: "Kotak credit card spend", alert: true, text: "Spent Rs.2,350.00 on your Kotak Credit Card XX3456 at BOOKMYSHOW on 21-Oct-26. Available limit Rs 77,650.00", expect: { kind: "expense", amount: 2350, merchant: "Bookmyshow", last4: "3456" } },
  // --- Paytm, GPay, PhonePe ---
  { name: "Paytm Payments Bank payment", alert: true, text: "Paid Rs 150 to Chai Point using Paytm Payments Bank. Updated Balance: Rs 2,300. UPI Ref 629104837122", expect: { kind: "expense", amount: 150, merchant: "Chai Point", isUpi: true } },
  { name: "Paytm wallet payment", alert: true, text: "Rs. 99 paid at Netflix via Paytm Wallet. Wallet balance: Rs 1,234", expect: { kind: "expense", amount: 99, merchant: "Netflix" } },
  { name: "GPay payment", alert: true, text: "You paid ₹ 180.00 to Cafe Coffee Day using Google Pay. UPI Ref: 629104837122", expect: { kind: "expense", amount: 180, merchant: "Cafe Coffee Day", isUpi: true } },
  { name: "PhonePe payment", alert: true, text: "Paid ₹1,200.00 to Reliance Jio via PhonePe. UPI Ref 629104837122. Check balance on PhonePe", expect: { kind: "expense", amount: 1200, merchant: "Reliance Jio", isUpi: true } },
  { name: "GPay money received", alert: true, text: "Ramesh Kumar sent you ₹ 500.00 via Google Pay UPI. UPI Ref 629104837122", expect: { kind: "income", amount: 500, merchant: "Ramesh Kumar", isUpi: true } },
  { name: "PhonePe money received", alert: true, text: "Received ₹ 2,000.00 from Anita in your Bank A/c XX4821 via PhonePe. UPI Ref 629104837122", expect: { kind: "income", amount: 2000, merchant: "Anita", last4: "4821", isUpi: true } },
  // --- Bills, EMI, salary, refund ---
  { name: "EMI due reminder", alert: true, text: "Reminder: Your EMI of Rs 12,500 for loan A/c XX5566 is due on 05-Dec-26. Please maintain sufficient balance. -Bajaj Finserv", expect: { kind: "bill", amount: 12500, last4: "5566" } },
  { name: "EMI debited is an expense, not a bill", alert: true, text: "Rs 12,500.00 debited from A/c XX4821 towards EMI for loan XX5566 on 05-Dec-26. Avl Bal Rs 20,100.00", expect: { kind: "expense", amount: 12500, last4: "4821" } },
  { name: "Salary credit via NEFT", alert: true, text: "INR 85,000.00 credited to your A/c XX4821 on 01-11-26 by NEFT-ACME TECHNOLOGIES PVT LTD-SALARY OCT. Avl bal INR 1,20,300.00", expect: { kind: "income", amount: 85000, last4: "4821" } },
  { name: "Refund credited", alert: true, text: "Refund of Rs 799.00 for your Myntra order has been credited to your A/c XX4821 on 24-10-26. Ref 4455", expect: { kind: "income", amount: 799, last4: "4821" } },
  { name: "Real cashback credit", alert: true, text: "Cashback of Rs 25.00 credited to your A/c XX4821 on 25-10-26. Ref 629104837122", expect: { kind: "income", amount: 25, last4: "4821" } },
  // --- Not finance alerts ---
  { name: "balance-only message", alert: false, text: "Your A/c XX4821 Avl Bal is Rs 12,345.67 as on 21-10-26. -HDFC Bank" },
  { name: "balance enquiry with Bal label", alert: false, text: "A/c XX4821 Bal: INR 5,000.00 at 10:15 on 21-10-26" },
  { name: "limit-only message", alert: false, text: "Your credit limit has been increased to Rs 2,00,000. Available limit: Rs 1,50,000." },
  { name: "login OTP", alert: false, text: "123456 is your OTP for txn of Rs 500.00 at AMAZON. Valid for 10 mins. Do not share." },
  { name: "card OTP", alert: false, text: "OTP for txn of INR 1,500 at Flipkart is 482913. Do not share with anyone." },
  { name: "cashback promo", alert: false, text: "Get Rs 500 cashback on your first UPI payment! Offer valid till 31 Oct. Click https://pay.example/offer" },
  { name: "win promo", alert: false, text: "Congratulations! You can win Rs 10,000 this Diwali. Spend Rs 5,000 and get flat 10% off. T&C apply." },
  { name: "loan offer", alert: false, text: "Pre-approved personal loan of Rs 5,00,000 for you! Apply now, limited period offer." },
  { name: "promo that mentions credited", alert: false, text: "Offer: Rs 200 cashback will be credited within 24 hrs when you pay your bill on our app. Click to avail." },
  { name: "plain chat", alert: false, text: "Mom: Dinner at 8? Bring curd." },
];

describe("SMS corpus", () => {
  it.each(CORPUS)("$name", ({ text, alert, expect: want }) => {
    expect(isFinanceAlert(text)).toBe(alert);
    const p = parseAlert(text);
    if (!alert) {
      return;
    }
    expect(p).not.toBeNull();
    if (want) expect(p).toMatchObject(want);
    if (want?.kind === "bill") expect(new Date(p!.dueDate!).getFullYear()).toBe(2026);
  });

  it("reads the due date of a card bill", () => {
    const p = parseAlert(CORPUS.find((c) => c.name === "ICICI card statement with minimum due")!.text)!;
    expect(new Date(p.dueDate!).getDate()).toBe(5);
    expect(new Date(p.dueDate!).getMonth()).toBe(10);
  });

  it("balance-only and OTP texts do not parse into transactions", () => {
    expect(parseAlert("Your A/c XX4821 Avl Bal is Rs 12,345.67 as on 21-10-26. -HDFC Bank")).toBeNull();
    expect(parseAlert("Your credit limit has been increased to Rs 2,00,000. Available limit: Rs 1,50,000.")).toBeNull();
  });

  it("keeps reading the built-in demo messages correctly", () => {
    const got = [...DEMO_SMS, ...DEMO_SMS_EXTRA].map((t) => ({ kept: isFinanceAlert(t), p: parseAlert(t) }));
    expect(got.every((g) => g.kept)).toBe(true);
    expect(got.map((g) => [g.p!.kind, g.p!.amount, g.p!.merchant])).toEqual([
      ["expense", 452, "Swiggy"],
      ["income", 92000, "Acme Labs Pvt Ltd"],
      ["expense", 2349, "Amazon"],
      ["bill", 18240.5, undefined],
      ["expense", 1340, "Bescom"],
      ["income", 75, "Phonepe"],
      ["bill", 999, undefined],
    ]);
  });

  it("covers at least 25 messages", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(25);
  });
});
