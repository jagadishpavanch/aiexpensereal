import { beforeEach, describe, expect, it, vi } from "vitest";
import { actions, syncPort } from "./store";

describe("actions.categorize", () => {
  beforeEach(() => syncPort.reset());

  it("uses the built-in dictionary and the current categories", () => {
    expect(actions.categorize("Swiggy")).toMatchObject({ categoryId: "food", source: "merchant" });
    expect(actions.categorize("Unknown shop")).toMatchObject({ categoryId: "other", source: "fallback" });
  });

  it("passes text and type through", () => {
    expect(actions.categorize("", { text: "paid towards electricity bill" }).categoryId).toBe("bills");
    expect(actions.categorize("Acme", { text: "SAL CR", type: "income" })).toMatchObject({ categoryId: "salary", source: "keyword" });
  });

  it("reads the user's rules from the store", () => {
    actions.addRule({ match: "swiggy", categoryId: "groceries" });
    expect(actions.categorize("Swiggy")).toMatchObject({ categoryId: "groceries", source: "rule" });
  });
});

describe("actions.learnCategory", () => {
  beforeEach(() => syncPort.reset());

  it("adds a rule keyed by the normalized merchant", () => {
    const r = actions.learnCategory("Chai Point@ybl", "shopping");
    expect(r).toEqual({ match: "chai point" });
    expect(syncPort.getState().rules).toEqual([expect.objectContaining({ match: "chai point", categoryId: "shopping" })]);
    expect(actions.categorize("CHAI POINT")).toMatchObject({ categoryId: "shopping", source: "rule" });
  });

  it("replaces an existing rule for the same match instead of adding another", () => {
    actions.addRule({ match: "Zepto", categoryId: "food" });
    const before = syncPort.getState().rules[0];
    actions.learnCategory("ZEPTO", "groceries");
    const rules = syncPort.getState().rules;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: before.id, match: "Zepto", categoryId: "groceries" });
  });

  it("does not commit when the rule already says this", () => {
    actions.learnCategory("Zepto", "groceries");
    const seen = vi.fn();
    const off = syncPort.onLocalCommit(seen);
    actions.learnCategory("zepto", "groceries");
    off();
    expect(seen).not.toHaveBeenCalled();
  });

  it("stays immutable: untouched rules keep their identity, the old array is not edited", () => {
    actions.addRule({ match: "a1", categoryId: "food" });
    actions.addRule({ match: "b2", categoryId: "food" });
    const before = syncPort.getState().rules;
    const [a, b] = before;
    actions.learnCategory("b2", "rent");
    const after = syncPort.getState().rules;
    expect(after).not.toBe(before);
    expect(after[0]).toBe(a);
    expect(after[1]).not.toBe(b);
    expect(b.categoryId).toBe("food");
  });

  it("ignores merchants that normalize to nothing, and unknown categories", () => {
    expect(actions.learnCategory("9876543210@ybl", "food")).toBeUndefined();
    expect(actions.learnCategory("Swiggy", "no-such-category")).toBeUndefined();
    expect(syncPort.getState().rules).toEqual([]);
  });
});

// "Apply to all history and future": after a correction, past transactions from the same merchant
// can be moved too, in one commit, and put back with Undo.
describe("actions.recategorizeMerchant", () => {
  beforeEach(() => syncPort.reset());
  const add = (merchant: string, categoryId: string, type: "expense" | "income" | "transfer" = "expense") =>
    actions.addTx({ type, amount: 100, merchant, categoryId, accountId: "cash", date: new Date().toISOString(), source: "sms", isDemo: false });

  it("counts and moves past transactions from the same merchant, matching names loosely", () => {
    add("Apsrtc", "other");
    add("APSRTC ", "other");
    add("UPI-apsrtc@sbi", "other");
    add("Apsrtc", "transport");
    add("Swiggy", "other");
    expect(actions.pastToRecategorize("Apsrtc", "transport")).toBe(3);
    const undo = actions.recategorizeMerchant("Apsrtc", "transport");
    const cats = syncPort.getState().transactions.map((t) => `${t.merchant.trim()}:${t.categoryId}`);
    expect(cats.filter((c) => c.endsWith(":transport"))).toHaveLength(4);
    expect(cats).toContain("Swiggy:other");
    undo();
    expect(syncPort.getState().transactions.filter((t) => t.categoryId === "transport")).toHaveLength(1);
  });

  it("leaves transfers and the other side (income vs expense) alone", () => {
    add("Ravi", "other");
    add("Ravi", "other-income", "income");
    add("Ravi", "other", "transfer");
    expect(actions.pastToRecategorize("Ravi", "food")).toBe(1);
  });

  it("is one commit, so sync sees one change", () => {
    add("Apsrtc", "other");
    add("Apsrtc", "other");
    const seen = vi.fn();
    const off = syncPort.onLocalCommit(seen);
    actions.recategorizeMerchant("Apsrtc", "transport");
    off();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
