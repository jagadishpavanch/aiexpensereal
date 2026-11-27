import { describe, expect, it } from "vitest";
import { categorize } from "./categorize";
import { DEFAULT_CATEGORIES, DEMO_SMS, DEMO_SMS_EXTRA } from "./demo";
import { isFinanceAlert, parseAlert, type ParsedAlert } from "./sms-parse";

interface Case {
  name: string;
  text: string;
  alert: boolean;
  expect?: Partial<ParsedAlert>;
  /** The category the default categories give this message once parsed (merchant and text both read). */
  category?: string;
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
  { name: "Avl Limit printed right after the amount", alert: true, text: "Spent Rs 450.00 Avl Limit Rs 5000.00 on card XX1234 at CROMA", expect: { kind: "expense", amount: 450, merchant: "Croma", last4: "1234" } },
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
  // --- Real debits that happen to carry a promo-looking word ---
  { name: "wallet payment with a click-to-view footer", alert: true, text: "Rs 500 paid to Zomato via Paytm Wallet. Click to view receipt", expect: { kind: "expense", amount: 500, merchant: "Zomato" } },
  { name: "merchant called Win", alert: true, text: "Rs 450 spent on Win Pharmacy using GPay", expect: { kind: "expense", amount: 450 } },
  { name: "wallet receipt with an offer in the footer", alert: true, text: "Rs 120 paid to Cafe Coffee Day via Paytm Wallet. Check out latest offers in the app.", expect: { kind: "expense", amount: 120, merchant: "Cafe Coffee Day" } },
  // --- Bills, EMI, salary, refund ---
  { name: "EMI due reminder", alert: true, text: "Reminder: Your EMI of Rs 12,500 for loan A/c XX5566 is due on 05-Dec-26. Please maintain sufficient balance. -Bajaj Finserv", expect: { kind: "bill", amount: 12500, last4: "5566" } },
  { name: "EMI debited is an expense, not a bill", alert: true, text: "Rs 12,500.00 debited from A/c XX4821 towards EMI for loan XX5566 on 05-Dec-26. Avl Bal Rs 20,100.00", expect: { kind: "expense", amount: 12500, last4: "4821" } },
  { name: "Salary credit via NEFT", alert: true, text: "INR 85,000.00 credited to your A/c XX4821 on 01-11-26 by NEFT-ACME TECHNOLOGIES PVT LTD-SALARY OCT. Avl bal INR 1,20,300.00", expect: { kind: "income", amount: 85000, last4: "4821" } },
  { name: "Refund credited", alert: true, text: "Refund of Rs 799.00 for your Myntra order has been credited to your A/c XX4821 on 24-10-26. Ref 4455", expect: { kind: "refund", amount: 799, merchant: "Myntra", last4: "4821" } },
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
  { name: "win cashback promo without a transaction", alert: false, text: "Win Rs 500 cashback on your next payment" },
  { name: "flat off promo with click", alert: false, text: "Get flat Rs 200 off, click here" },
  { name: "OTP that mentions an amount and a merchant", alert: false, text: "482913 is your OTP to pay Rs 450 to Zomato via GPay. Do not share it with anyone." },
  { name: "promo that says you could win after a debit-like word", alert: false, text: "Pay with UPI and you could win Rs 1,000 cashback. Offer ends soon, click here." },
  { name: "amount-first loan spam that says credited", alert: false, text: "Dear customer, Rs 75,000 pre-approved loan offer. Amount credited in 10 minutes. Click now" },
  { name: "amount-first spam that says paid", alert: false, text: "Rs 500 off on your next order, you have paid for premium. Offer ends today. Click" },
  { name: "plain chat", alert: false, text: "Mom: Dinner at 8? Bring curd." },
  // --- Failed, declined and reversed-soon transactions are not money movement ---
  { name: "failed txn, amount reversed within 3 days", alert: false, text: "Your transaction of Rs 250.00 to SWIGGY has failed. Amount debited, if any, will be reversed within 3 days." },
  { name: "declined txn", alert: false, text: "Your transaction of Rs 250.00 at AMAZON on HDFC Bank Card XX9012 was declined." },
  { name: "unsuccessful UPI payment", alert: false, text: "UPI payment of Rs 300.00 to ramesh@ybl was unsuccessful. Ref 629104837122. Debited amount, if any, will be refunded." },
  { name: "could not be processed", alert: false, text: "Your payment of Rs 1,200.00 from A/c XX4821 could not be processed. Please try again." },
  { name: "ICICI declined for insufficient balance", alert: false, text: "Txn of INR 500.00 declined on your ICICI Bank Card XX9012 due to insufficient balance." },
  // --- Requests, mandates, scams and OTPs ---
  { name: "UPI collect request", alert: false, text: "ramesh@ybl has requested Rs 500 from you. Pay via your UPI app." },
  { name: "AutoPay mandate created", alert: false, text: "AutoPay mandate of Rs 649.00 created successfully for NETFLIX on your HDFC Bank Card XX9012." },
  { name: "lottery scam", alert: false, text: "Congratulations! You have won Rs 50,000. Click http://bit.ly/x to claim." },
  { name: "loan spam with Rs 5,00,000", alert: false, text: "Pre-approved personal loan of Rs 5,00,000 for you! Get it credited in 10 mins." },
  { name: "OTP for a card txn with the card number", alert: false, text: "OTP is 482910 for txn of Rs 1,499.00 at AMAZON on HDFC Bank Card 4821. Do not share." },
  // --- Bank of Baroda: "Dr." / "Cr." wording ---
  { name: "BOB Dr. from A/C and Cr. to a VPA", alert: true, text: "Rs.1000.00 Dr. from A/C XXXXXX4821 and Cr. to ramesh@ybl. Ref:629104837122. AvlBal:Rs5000.00(2026:10:21 10:12:00). Not you? Call 18005700-BOB", expect: { kind: "expense", amount: 1000, merchant: "Ramesh", last4: "4821", isUpi: true } },
  // --- Kotak and Axis layouts ---
  { name: "Kotak Sent from AC to a VPA with fraud link", alert: true, text: "Sent Rs.500.00 from Kotak Bank AC X1234 to ramesh@okicici on 21-10-26.UPI Ref 629104837122. Not you, https://kotak.com/KBANKT/Fraud", expect: { kind: "expense", amount: 500, merchant: "Ramesh", last4: "1234", isUpi: true } },
  { name: "Axis multi-line UPI P2M", alert: true, text: "INR 1,200.00 debited\nA/c no. XX4821\n21-10-26, 10:12:00\nUPI/P2M/629104837122/SWIGGY\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank", expect: { kind: "expense", amount: 1200, merchant: "Swiggy" } },
  // --- Credit card bill payment, own-account moves, wallet top-ups: transfers ---
  { name: "credit card bill payment received", alert: true, text: "Payment of Rs 18,240.50 received towards your ICICI Bank Credit Card XX9012. Thank you.", expect: { kind: "transfer", amount: 18240.5, last4: "9012" } },
  { name: "own-account transfer", alert: true, text: "Rs 5,000.00 transferred from A/c XX4821 to your A/c XX1111 on 21-10-26.", expect: { kind: "transfer", amount: 5000 } },
  { name: "wallet top-up from a card", alert: true, text: "Rs 500.00 added to your Paytm Wallet using HDFC Bank card XX4821. Updated balance Rs 620", expect: { kind: "transfer", amount: 500 } },
  // --- Refunds and reversals that completed ---
  { name: "card refund for an order", alert: true, text: "Refund of Rs 499.00 for your Amazon order has been credited to your HDFC Bank Card XX9012", expect: { kind: "refund", amount: 499, merchant: "Amazon", last4: "9012" } },
  { name: "failed UPI txn reversed to the account", alert: true, text: "Rs 250.00 reversed to your A/c XX4821 for failed UPI txn Ref 629104837122", expect: { kind: "refund", amount: 250 } },
  // --- ATM, NACH/ECS, cashback, NEFT ---
  { name: "ATM withdrawal names the ATM, not the terminal id", alert: true, text: "Rs 2,000.00 withdrawn at ATM S1AW1234 from A/c XX4821 on 21-10-26. Avl Bal Rs 10,000", expect: { kind: "expense", amount: 2000, merchant: "ATM withdrawal", last4: "4821" } },
  { name: "NACH auto-debit", alert: true, text: "Rs 3,000.00 debited from A/c XX4821 towards NACH-ICICI PRU LIFE on 05-11-26. Avl Bal Rs 7,000", expect: { kind: "expense", amount: 3000, merchant: "Icici Pru Life" } },
  { name: "wallet cashback credit", alert: true, text: "Cashback of Rs 25.00 credited to your Paytm wallet for order #1234", expect: { kind: "income", amount: 25, cashback: true } },
  { name: "NEFT credit with Indian-grouped amount", alert: true, text: "Rs. 5,00,000.00 credited to your A/c XX4821 on 01-11-26 by NEFT from ACME LABS. Avl Bal Rs 6,48,220.50", expect: { kind: "income", amount: 500000, merchant: "Acme Labs" } },
  // --- Utility payments, recharges and travel: spending even without a "debited" verb ---
  { name: "BBPS electricity payment is successful", alert: true, text: "Payment of Rs 1,340.00 towards BESCOM electricity bill a/c 12345 is successful. Txn ID 629104837122", expect: { kind: "expense", amount: 1340, merchant: "Bescom" }, category: "bills" },
  { name: "mobile recharge successful", alert: true, text: "Recharge of Rs 299 successful for Jio number 98XXXXX210 via Paytm. Order ID 12345", expect: { kind: "expense", amount: 299, merchant: "Jio" }, category: "bills" },
  { name: "IRCTC ticket booking debit", alert: true, text: "Rs 1,845.00 debited from A/c XX4821 for IRCTC ticket booking PNR 4521. Avl Bal Rs 9,000", expect: { kind: "expense", amount: 1845, merchant: "Irctc" }, category: "transport" },
  // --- Income that is not a salary ---
  { name: "money from a friend", alert: true, text: "You received ₹2,000.00 from Priya Sharma. UPI transaction ID 629104837122", expect: { kind: "income", amount: 2000, merchant: "Priya Sharma" }, category: "other-income" },
  { name: "savings interest credit", alert: true, text: "Interest of Rs 412.00 credited to your Savings A/c XX4821", expect: { kind: "income", amount: 412, last4: "4821" }, category: "other-income" },
  { name: "dividend credit names the company, not the rest of the sentence", alert: true, text: "Dividend of Rs 150.00 from INFOSYS LTD credited to A/c XX4821.", expect: { kind: "income", amount: 150, merchant: "Infosys" }, category: "other-income" },
  { name: "salary info line still reads as salary", alert: true, text: "Your A/c XX4821 credited with INR 92,000.00 on 01-11-26. Info: SALARY NOV ACME LABS.", expect: { kind: "income", amount: 92000 }, category: "salary" },
  // --- Investments are not spending or income ---
  { name: "SIP debit", alert: true, text: "Rs 5,000.00 debited from A/c XX4821 for SIP in AXIS BLUECHIP FUND via NACH on 05-11-26.", expect: { kind: "transfer", amount: 5000, merchant: "Axis Bluechip Fund" } },
  { name: "mutual fund redemption credit", alert: true, text: "Rs 25,000.00 credited to A/c XX4821 by NEFT from HDFC MUTUAL FUND (redemption).", expect: { kind: "transfer", amount: 25000, merchant: "Hdfc Mutual Fund" } },
  { name: "a cafe called Sip is still spending", alert: true, text: "Rs 220.00 spent on card XX4821 at SIP N DINE on 21-10-26.", expect: { kind: "expense", amount: 220 } },
  // --- Reversal wording ---
  { name: "reversal credited to a card for a merchant", alert: true, text: "Reversal of Rs 1,499.00 credited to your HDFC Bank Credit Card x9012 for AMAZON on 23-10-26.", expect: { kind: "refund", amount: 1499, merchant: "Amazon", last4: "9012" }, category: "shopping" },
  // --- Layouts that already work ---
  { name: "HDFC card spend with Avl Lmt and a timestamp", alert: true, text: "Rs.456.00 spent on HDFC Bank Card x9012 at ZOMATO LIMITED on 2026-10-21:20:11:02 Avl Lmt:Rs 1,20,000", expect: { kind: "expense", amount: 456 }, category: "food" },
  { name: "UPI payment to a pharmacy from a bank", alert: true, text: "Paid ₹1,200 to Apollo Pharmacy from HDFC Bank XX4821. UPI Ref: 629104837122", expect: { kind: "expense", amount: 1200, isUpi: true }, category: "health" },
  { name: "amount written as 450/-", alert: true, text: "A/c XX4821 debited Rs 450/- at DMART on 21-10-26.", expect: { kind: "expense", amount: 450, merchant: "Dmart", last4: "4821" } },
  { name: "INR glued to the amount", alert: true, text: "INR500.00 debited from A/c XX4821 at STARBUCKS on 21-10-26", expect: { kind: "expense", amount: 500, merchant: "Starbucks" } },
  { name: "IMPS transfer: the amount is not the fee", alert: true, text: "Rs 10,000.00 transferred via IMPS to SURESH KUMAR. Charges Rs 5.90 debited. Ref 629104837122", expect: { kind: "expense", amount: 10000, merchant: "Suresh Kumar" } },
  { name: "Paytm Postpaid bill with a due date", alert: true, text: "Your Paytm Postpaid bill of Rs 2,340 is due on 07-Dec-26.", expect: { kind: "bill", amount: 2340 } },
  // --- Round 4: foreign currency, deductions, mandates, savings, bill pay, tax refund, fees ---
  { name: "foreign currency spend cannot be read offline", alert: false, text: "USD 12.99 spent on your ICICI Bank Card XX9012 at SPOTIFY USA on 21-Oct-26. Avl Limit INR 1,40,000" },
  { name: "FASTag toll deduction", alert: true, text: "Rs 85.00 deducted from your FASTag wallet for toll at KHED SHIVAPUR plaza. Bal Rs 415", expect: { kind: "expense", amount: 85, merchant: "FASTag toll" }, category: "transport" },
  { name: "TDS deducted on interest is not a spend", alert: false, text: "TDS of Rs 41.20 deducted on interest for A/c XX4821" },
  { name: "interest credited with TDS deducted still counts as income", alert: true, text: "Interest of Rs 412.00 credited to A/c XX4821. TDS of Rs 41.20 deducted.", expect: { kind: "income", amount: 412 } },
  { name: "UPI AutoPay mandate debit names the service", alert: true, text: "Rs 199.00 debited from A/c XX4821 for UPI AutoPay mandate SPOTIFY. Ref 629104837122", expect: { kind: "expense", amount: 199, merchant: "Spotify" }, category: "entertainment" },
  { name: "standing instruction into a recurring deposit", alert: true, text: "Standing instruction of Rs 2,500 executed to RD A/c XX5566 from A/c XX4821 on 05-11-26", expect: { kind: "transfer", amount: 2500 } },
  { name: "bill paid via BillPay", alert: true, text: "Your BESCOM bill of Rs 1,340 has been paid via HDFC BillPay on 08-11-26. Ref 629104837122", expect: { kind: "expense", amount: 1340, merchant: "Bescom" }, category: "bills" },
  { name: "income tax refund is income, not a refund of spending", alert: true, text: "Income Tax refund of Rs 8,200.00 credited to A/c XX4821 by CPC BANGALORE", expect: { kind: "income", amount: 8200, merchant: "Income Tax refund" }, category: "other-income" },
  { name: "forex markup fee", alert: true, text: "Rs 45.20 debited as forex markup fee on HDFC Bank Card x9012 on 21-10-26", expect: { kind: "expense", amount: 45.2, merchant: "Forex markup fee", last4: "9012" } },
  { name: "cheque return charges", alert: true, text: "Rs 590.00 debited from A/c XX4821 towards cheque return charges on 21-10-26", expect: { kind: "expense", amount: 590, merchant: "Cheque return charges" } },
  { name: "Hinglish debit alert", alert: true, text: "Aapke A/c XX4821 se Rs 200 debit hue hain, UPI Ref 629104837122 - SBI", expect: { kind: "expense", amount: 200, isUpi: true } },
  { name: "EMI conversion of a purchase already recorded", alert: false, text: "Your txn of Rs 30,000 at CROMA has been converted to EMI of Rs 2,750 for 12 months on ICICI Card XX9012" },
  { name: "card hold", alert: false, text: "Rs 2,000.00 is on hold on your HDFC Bank Card x9012 for HOTEL BOOKING. Final amount may vary" },
  { name: "gift card added to balance", alert: false, text: "Rs 1,000 gift card from AMAZON added to your Amazon Pay balance" },
  { name: "share order executed", alert: false, text: "Your order to buy 10 shares of TCS at Rs 3,450 has been executed on Groww" },
  { name: "bare UPI credit", alert: true, text: "Rs 500.00 credited to A/c XX4821 via UPI. Ref 629104837122", expect: { kind: "income", amount: 500, isUpi: true }, category: "other-income" },
  { name: "card cashback for a merchant", alert: true, text: "Cashback of Rs 150.00 credited to your SBI Card ending 7788 for FLIPKART txn", expect: { kind: "income", amount: 150, cashback: true, last4: "7788" } },
  { name: "card statement lists the minimum due first", alert: true, text: "Minimum amount due Rs 920.00 on your ICICI Bank Credit Card XX9012. Total due Rs 18,240.50. Due date 05-Nov-26", expect: { kind: "bill", amount: 18240.5, last4: "9012" } },
];

describe("SMS corpus", () => {
  it.each(CORPUS)("$name", ({ text, alert, expect: want }) => {
    expect(isFinanceAlert(text)).toBe(alert);
    const p = parseAlert(text);
    if (!alert) {
      expect(p).toBeNull();
      return;
    }
    expect(p).not.toBeNull();
    if (want) expect(p).toMatchObject(want);
    if (want?.kind === "bill") expect(new Date(p!.dueDate!).getFullYear()).toBe(2026);
  });

  it.each(CORPUS.filter((c) => c.category))("$name: category", ({ text, category }) => {
    const p = parseAlert(text)!;
    const type = p.kind === "income" ? "income" : "expense";
    expect(categorize({ merchant: p.merchant ?? (type === "income" ? "Money received" : "Bank payment"), text, type }, [], DEFAULT_CATEGORIES).categoryId).toBe(category);
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
