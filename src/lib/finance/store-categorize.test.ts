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
