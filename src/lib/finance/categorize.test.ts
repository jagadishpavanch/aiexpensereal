import { describe, expect, it } from "vitest";
import { categorize, explainCategorization, normalizeMerchant, shouldLearn } from "./categorize";
import { DEFAULT_CATEGORIES } from "./demo";
import type { Category, MerchantRule } from "./types";

const cats = DEFAULT_CATEGORIES;
const exp = (merchant: string, text?: string, rules: MerchantRule[] = [], c: Category[] = cats) => categorize({ merchant, text, type: "expense" }, rules, c);
const inc = (merchant: string, text?: string, rules: MerchantRule[] = [], c: Category[] = cats) => categorize({ merchant, text, type: "income" }, rules, c);

describe("normalizeMerchant", () => {
  it("drops UPI handles but keeps the name before them", () => {
    expect(normalizeMerchant("SWIGGY@icici")).toBe("swiggy");
    expect(normalizeMerchant("zomato@okaxis")).toBe("zomato");
    expect(normalizeMerchant("ola.money@ybl")).toBe("ola money");
  });
  it("drops reference numbers and long digit runs", () => {
    expect(normalizeMerchant("paytm-54321098@paytm")).toBe("paytm");
    expect(normalizeMerchant("UPI-SWIGGY-629104837122")).toBe("swiggy");
    expect(normalizeMerchant("Zepto ref 12345678901")).toBe("zepto");
  });
  it("returns an empty string for a bare phone-number VPA", () => {
    expect(normalizeMerchant("9876543210@ybl")).toBe("");
    expect(normalizeMerchant("   ")).toBe("");
  });
  it("maps legal names to brands", () => {
    expect(normalizeMerchant("Bundl Technologies Pvt Ltd")).toBe("swiggy");
    expect(normalizeMerchant("ZOMATO LTD")).toBe("zomato");
    expect(normalizeMerchant("Zomato Media Pvt. Ltd.")).toBe("zomato");
    expect(normalizeMerchant("ANI TECHNOLOGIES PRIVATE LIMITED")).toBe("ola");
    expect(normalizeMerchant("Uber India Systems Pvt Ltd")).toBe("uber");
    expect(normalizeMerchant("Grofers India Pvt Ltd")).toBe("blinkit");
    expect(normalizeMerchant("Blink Commerce Private Limited")).toBe("blinkit");
    expect(normalizeMerchant("Kiranakart Technologies")).toBe("zepto");
    expect(normalizeMerchant("Supermarket Grocery Supplies Pvt Ltd")).toBe("bigbasket");
    expect(normalizeMerchant("One97 Communications Ltd")).toBe("paytm");
  });
  it("strips legal suffixes, apostrophes and punctuation", () => {
    expect(normalizeMerchant("Domino's Pizza")).toBe("dominos pizza");
    expect(normalizeMerchant("Amazon Pay India Pvt Ltd")).toBe("amazon pay");
    expect(normalizeMerchant("  Chai   Point, . ")).toBe("chai point");
    expect(normalizeMerchant("Air India")).toBe("airindia");
  });
});

describe("categorize: user rules", () => {
  it("a user rule beats the built-in dictionary", () => {
    const r = exp("Swiggy", undefined, [{ id: "1", match: "swiggy", categoryId: "groceries" }]);
    expect(r).toEqual({ categoryId: "groceries", source: "rule", matched: "swiggy" });
  });
  it("matches case-insensitively against the raw merchant", () => {
    expect(exp("ZEPTO CAFE", undefined, [{ id: "1", match: "Zepto", categoryId: "food" }]).categoryId).toBe("food");
  });
  it("the longest matching rule wins", () => {
    const rules: MerchantRule[] = [{ id: "1", match: "swiggy", categoryId: "food" }, { id: "2", match: "swiggy instamart", categoryId: "groceries" }];
    expect(exp("Swiggy Instamart", undefined, rules)).toMatchObject({ categoryId: "groceries", matched: "swiggy instamart" });
    expect(exp("Swiggy", undefined, rules).categoryId).toBe("food");
  });
  it("a learned rule matches a noisy merchant through normalization", () => {
    const rules: MerchantRule[] = [{ id: "1", match: "chai point", categoryId: "shopping" }];
    expect(exp("CHAI   POINT@ybl", undefined, rules)).toMatchObject({ categoryId: "shopping", source: "rule" });
  });
  it("a short rule respects word boundaries", () => {
    const rules: MerchantRule[] = [{ id: "1", match: "ola", categoryId: "transport" }];
    expect(exp("Coca Cola", undefined, rules).source).not.toBe("rule");
    expect(exp("Ola", undefined, rules).source).toBe("rule");
  });
  it("skips a rule whose category was deleted", () => {
    const r = exp("Swiggy", undefined, [{ id: "1", match: "swiggy", categoryId: "gone" }]);
    expect(r).toMatchObject({ categoryId: "food", source: "merchant" });
  });
  it("skips a rule whose category has the wrong kind", () => {
    const r = inc("Swiggy refund", undefined, [{ id: "1", match: "swiggy", categoryId: "food" }]);
    expect(r.source).toBe("fallback");
    expect(r.categoryId).toBe("salary");
  });
  it("ignores empty rules", () => {
    expect(exp("Swiggy", undefined, [{ id: "1", match: "  ", categoryId: "rent" }]).source).toBe("merchant");
  });
});

describe("categorize: brand dictionary", () => {
  const table: [string, string][] = [
    ["Swiggy", "food"], ["ZOMATO", "food"], ["Domino's", "food"], ["McDonald's", "food"], ["KFC", "food"], ["Starbucks", "food"], ["Chai Point", "food"],
    ["BigBasket", "groceries"], ["Blinkit", "groceries"], ["Zepto", "groceries"], ["Swiggy Instamart", "groceries"], ["DMart", "groceries"], ["JioMart", "groceries"], ["Reliance Fresh", "groceries"],
    ["Uber", "transport"], ["Ola", "transport"], ["Rapido", "transport"], ["IRCTC", "transport"], ["redBus", "transport"], ["FASTag recharge", "transport"], ["HPCL", "transport"], ["Indian Oil", "transport"], ["Shell", "transport"],
    ["Airtel", "bills"], ["Jio", "bills"], ["BSNL", "bills"], ["BESCOM", "bills"], ["Tata Power", "bills"], ["ACT Fibernet", "bills"], ["Tata Play", "bills"],
    ["NoBroker", "rent"],
    ["Amazon", "shopping"], ["Flipkart", "shopping"], ["Myntra", "shopping"], ["Ajio", "shopping"], ["Meesho", "shopping"], ["Nykaa", "shopping"], ["Croma", "shopping"],
    ["Netflix", "entertainment"], ["Spotify", "entertainment"], ["Hotstar", "entertainment"], ["Prime Video", "entertainment"], ["BookMyShow", "entertainment"], ["PVR Inox", "entertainment"],
    ["Apollo Pharmacy", "health"], ["1mg", "health"], ["PharmEasy", "health"], ["Netmeds", "health"], ["Practo", "health"],
  ];
  it.each(table)("%s -> %s", (merchant, id) => {
    const r = exp(merchant);
    expect(r.categoryId).toBe(id);
    expect(r.source).toBe("merchant");
    expect(r.matched).toBeTruthy();
  });
  it("sees through UPI handles and legal names", () => {
    expect(exp("swiggy@icici").categoryId).toBe("food");
    expect(exp("Bundl Technologies Pvt Ltd").categoryId).toBe("food");
    expect(exp("Kiranakart Technologies Pvt Ltd").categoryId).toBe("groceries");
    expect(exp("ANI Technologies Pvt Ltd").categoryId).toBe("transport");
  });
  it("prefers the longest brand: Swiggy Instamart is groceries, Swiggy is food", () => {
    expect(exp("Swiggy Instamart").categoryId).toBe("groceries");
    expect(exp("swiggy").categoryId).toBe("food");
  });
  it("matches on word boundaries: olacabs yes, cola no", () => {
    expect(exp("OLACABS").categoryId).toBe("transport");
    expect(exp("Cola Corner")).toMatchObject({ categoryId: "other", source: "fallback" });
    expect(exp("Coca Cola").source).toBe("fallback");
  });
  it("ambiguous short names only match on their own", () => {
    expect(exp("Vi").categoryId).toBe("bills");
    expect(exp("Vivek Stores").source).toBe("fallback");
    expect(exp("More").categoryId).toBe("groceries");
    expect(exp("More Cars Garage").source).toBe("fallback");
    expect(exp("Metro").categoryId).toBe("transport");
  });
  it("falls through when the brand's category does not exist", () => {
    const noGroceries = cats.filter((c) => c.id !== "groceries");
    expect(exp("Blinkit", undefined, [], noGroceries)).toMatchObject({ categoryId: "other", source: "fallback" });
  });
});

describe("categorize: keywords", () => {
  it("reads keywords from the merchant", () => {
    expect(exp("Hotel Saravana Restaurant")).toMatchObject({ categoryId: "food", source: "keyword", matched: "restaurant" });
    expect(exp("Sri Krishna Dhaba").categoryId).toBe("food");
    expect(exp("Paradise Biryani").categoryId).toBe("food");
    expect(exp("HP Petrol Pump")).toMatchObject({ categoryId: "transport", source: "keyword" });
    expect(exp("City Medical Store").categoryId).toBe("health");
    expect(exp("Smile Dental Clinic").categoryId).toBe("health");
  });
  it("reads keywords from the SMS text when the merchant says nothing", () => {
    expect(exp("", "Rs 1,200 paid towards electricity bill via BBPS").categoryId).toBe("bills");
    expect(exp("Unknown", "Mobile recharge of Rs 299 successful").categoryId).toBe("bills");
    expect(exp("", "Broadband payment received").categoryId).toBe("bills");
  });
  it("merchant keywords beat text keywords", () => {
    expect(exp("Apollo Clinic", "paid for restaurant").categoryId).toBe("health");
  });
  it("keywords need word boundaries", () => {
    expect(exp("Business Associates").source).toBe("fallback");
    expect(exp("Message Center").source).toBe("fallback");
  });
  it("rent keyword but not 'rent a car'", () => {
    expect(exp("House Rent").categoryId).toBe("rent");
    expect(exp("Rent A Car Services").source).toBe("fallback");
  });
  it("a longer keyword beats a shorter one", () => {
    expect(exp("Mall Pharmacy").categoryId).toBe("health");
  });
});

describe("categorize: income", () => {
  it("salary keywords", () => {
    expect(inc("ACME LABS", "SAL CR for Oct")).toMatchObject({ categoryId: "salary", source: "keyword" });
    expect(inc("Acme Payroll").categoryId).toBe("salary");
    expect(inc("", "Salary credited").categoryId).toBe("salary");
  });
  it("freelance brands and keywords", () => {
    expect(inc("Upwork Global Inc")).toMatchObject({ categoryId: "freelance", source: "merchant" });
    expect(inc("Fiverr").categoryId).toBe("freelance");
    expect(inc("Client A", "Invoice 204 payment").categoryId).toBe("freelance");
  });
  it("an expense brand never lands in an income category", () => {
    const r = inc("Swiggy");
    expect(r.categoryId).toBe("salary");
    expect(r.source).toBe("fallback");
  });
  it("an income keyword never lands in an expense category", () => {
    expect(exp("Salary Advance Cafe").categoryId).toBe("food");
  });
});

describe("categorize: fallback and missing categories", () => {
  it("expense falls back to other", () => {
    expect(exp("Totally Unknown Shop")).toEqual({ categoryId: "other", source: "fallback" });
  });
  it("transfer and refund use expense categories", () => {
    expect(categorize({ merchant: "Amazon", type: "refund" }, [], cats).categoryId).toBe("shopping");
    expect(categorize({ merchant: "Friend", type: "transfer" }, [], cats).categoryId).toBe("other");
  });
  it("uses the first expense category when other was deleted", () => {
    const noOther = cats.filter((c) => c.id !== "other");
    expect(exp("Unknown", undefined, [], noOther).categoryId).toBe("food");
  });
  it("income falls back to the first income category, even a custom one", () => {
    const custom: Category[] = [...cats.filter((c) => c.kind === "expense"), { id: "c1", name: "Pocket money", icon: "tag", color: "chart-5", kind: "income" }];
    expect(inc("Unknown", undefined, [], custom).categoryId).toBe("c1");
  });
  it("with no category of the right kind, falls back to other when it exists", () => {
    const onlyExpense = cats.filter((c) => c.kind === "expense");
    const r = inc("Unknown", undefined, [], onlyExpense);
    expect(r).toEqual({ categoryId: "other", source: "fallback" });
  });
  it("with no category of the right kind and no other, uses the first category of any kind", () => {
    const odd: Category[] = [
      { id: "c9", name: "Gifts", icon: "tag", color: "chart-5", kind: "expense" },
      { id: "c8", name: "Fun", icon: "tag", color: "chart-4", kind: "expense" },
    ];
    expect(inc("Unknown", undefined, [], odd).categoryId).toBe("c9");
  });
  it("with an empty category list returns the id other (nothing exists to point at)", () => {
    expect(exp("Unknown", undefined, [], [])).toEqual({ categoryId: "other", source: "fallback" });
  });
  it("handles an empty merchant and no text", () => {
    expect(exp("")).toEqual({ categoryId: "other", source: "fallback" });
  });
  it("does not mutate its inputs", () => {
    const rules: MerchantRule[] = [{ id: "1", match: "swiggy", categoryId: "food" }];
    const snapshot = JSON.stringify([rules, cats]);
    exp("Swiggy", "text", rules);
    expect(JSON.stringify([rules, cats])).toBe(snapshot);
  });
});

describe("explainCategorization", () => {
  it("explains each source", () => {
    expect(explainCategorization({ categoryId: "food", source: "rule", matched: "swiggy" })).toBe('your rule "swiggy"');
    expect(explainCategorization({ categoryId: "food", source: "merchant", matched: "swiggy" })).toBe('known merchant "swiggy"');
    expect(explainCategorization({ categoryId: "food", source: "keyword", matched: "cafe" })).toBe('"cafe" in the name');
    expect(explainCategorization({ categoryId: "other", source: "fallback" })).toBeUndefined();
  });
});

describe("shouldLearn", () => {
  it("does not learn from an untouched default", () => {
    expect(shouldLearn({ userPicked: false, chosen: "food", enginePick: "other" })).toBe(false);
    expect(shouldLearn({ userPicked: false, chosen: "food", original: "shopping" })).toBe(false);
  });
  it("learns an explicit pick that differs from the engine", () => {
    expect(shouldLearn({ userPicked: true, chosen: "shopping", enginePick: "other" })).toBe(true);
  });
  it("does not learn an explicit pick equal to the engine", () => {
    expect(shouldLearn({ userPicked: true, chosen: "food", enginePick: "food" })).toBe(false);
  });
  it("on an edit, learns only a pick that differs from the saved category", () => {
    expect(shouldLearn({ userPicked: true, chosen: "shopping", original: "food" })).toBe(true);
    expect(shouldLearn({ userPicked: true, chosen: "food", original: "food" })).toBe(false);
  });
});
