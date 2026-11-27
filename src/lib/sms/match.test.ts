import { describe, expect, it } from "vitest";
import { isBankSender, isSameTx, refOf, SAME_TX_WINDOW_MS } from "./match";

describe("isBankSender", () => {
  it("accepts Indian bank DLT sender ids", () => {
    for (const s of ["VM-HDFCBK", "AX-ICICIB-S", "JD-SBIUPI-T", "HDFCBK", "vm-axisbk", "VK-NEWBNK"]) expect(isBankSender(s)).toBe(true);
  });
  it("rejects phone numbers, shops and contacts", () => {
    for (const s of ["+919876543210", "9876543210", "VM-SWIGGY", "AD-AMAZON", "Mom", "", "123456"]) expect(isBankSender(s)).toBe(false);
  });
});

describe("refOf", () => {
  it("reads UPI and bank reference numbers", () => {
    expect(refOf("Sent Rs.250.00\nFrom HDFC Bank A/C *4821\nTo SWIGGY\nOn 21/10/26\nRef 629104837122\nNot You? Call 18002586161")).toBe("629104837122");
    expect(refOf("to VPA zomato@okaxis (UPI Ref No 629999111222). Avl Bal Rs 1,00,000.00")).toBe("629999111222");
    expect(refOf("debited by 500.0 on date 21Oct26 trf to RAMESH KUMAR Refno 629104837122 If not u? call 1800111109")).toBe("629104837122");
    expect(refOf("SWIGGY credited. UPI:629104837122. Call 18002662 for dispute.")).toBe("629104837122");
    expect(refOf("transfer from MR ANITA SHARMA Ref No 4455667788. -SBI")).toBe("4455667788");
  });
  it("ignores helpline numbers and card digits", () => {
    expect(refOf("Spent Rs.1499 On HDFC Bank Card 4821 At AMAZON. Not You? Call 18002586161")).toBeUndefined();
  });
});

describe("isSameTx", () => {
  const base = { type: "expense", amount: 250, at: 1_000_000 };
  it("same reference is the same transaction, different reference is not", () => {
    expect(isSameTx({ ...base, ref: "1" }, { ...base, at: base.at + 3 * SAME_TX_WINDOW_MS, ref: "1" })).toBe(true);
    expect(isSameTx({ ...base, ref: "1" }, { ...base, ref: "2" })).toBe(false);
  });
  it("without a reference on both, matches amount and type within the window", () => {
    expect(isSameTx(base, { ...base, at: base.at + SAME_TX_WINDOW_MS - 1, ref: "9" })).toBe(true);
    expect(isSameTx(base, { ...base, at: base.at + SAME_TX_WINDOW_MS + 1 })).toBe(false);
    expect(isSameTx(base, { ...base, amount: 251 })).toBe(false);
    expect(isSameTx(base, { ...base, type: "income" })).toBe(false);
  });
});
