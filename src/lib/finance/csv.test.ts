import { describe, expect, it } from "vitest";
import { parseCSV, splitCSV, toCSV } from "./csv";
import type { Transaction } from "./types";

const tx = (p: Partial<Transaction>): Transaction => ({
  id: "t", type: "expense", amount: 250, categoryId: "food", accountId: "upi", merchant: "Swiggy",
  date: "2026-11-20T06:00:00.000Z", source: "sms", isDemo: false, ...p,
});

describe("splitCSV", () => {
  it("keeps quoted commas, doubled quotes and quoted line breaks inside one cell", () => {
    expect(splitCSV('a,"b, c","say ""hi""","x\ny"\r\n1,2,3,4')).toEqual([["a", "b, c", 'say "hi"', "x\ny"], ["1", "2", "3", "4"]]);
  });
});

describe("CSV round trip", () => {
  it("a merchant with a comma comes back whole, with type and category in their columns", () => {
    const { rows, errors } = parseCSV(toCSV([tx({ merchant: "Ravi, Kirana Store", note: "milk, eggs" })]));
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ date: "2026-11-20T06:00:00.000Z", amount: 250, merchant: "Ravi, Kirana Store", type: "expense", category: "food" }]);
  });

  it("a merchant that looks like a formula can't run in a spreadsheet, and imports back unchanged", () => {
    const evil = '=HYPERLINK("http://x.test","Refund")';
    const csv = toCSV([tx({ merchant: evil }), tx({ merchant: "+91 transfer" }), tx({ merchant: "@home" })]);
    for (const line of csv.split("\n").slice(1)) expect(line.split(",")[2]).toMatch(/^"?'/);
    expect(parseCSV(csv).rows.map((r) => r.merchant)).toEqual([evil, "+91 transfer", "@home"]);
  });
});
