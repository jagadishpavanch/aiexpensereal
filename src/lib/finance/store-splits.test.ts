import { beforeEach, describe, expect, it } from "vitest";
import { actions, syncPort } from "./store";
import { balances, splitSummary } from "./splits";
import type { Transaction } from "./types";

const tx = (over: Partial<Omit<Transaction, "id">> = {}): Omit<Transaction, "id"> => ({
  type: "expense", amount: 3000, merchant: "Dinner", categoryId: "food", accountId: "upi", date: new Date().toISOString(), source: "manual", isDemo: false, ...over,
});
const state = () => syncPort.getState();

describe("addSplit", () => {
  beforeEach(() => syncPort.reset());

  it("when I paid, only my share is recorded as my spending", () => {
    actions.addSplit({ title: "Dinner", total: 3000, paidBy: "me", date: new Date().toISOString(), mode: "equal", shares: [{ personId: "me", amount: 1000 }, { personId: "a", amount: 1000 }, { personId: "b", amount: 1000 }] }, tx());
    expect(state().transactions).toHaveLength(1);
    expect(state().transactions[0].amount).toBe(1000);
    expect(balances(state().splits).get("a")).toBe(1000);
  });

  it("when someone else paid, my share is my spending and I owe them", () => {
    actions.addSplit({ title: "Cab", total: 2400, paidBy: "k", date: new Date().toISOString(), mode: "equal", shares: [{ personId: "me", amount: 1200 }, { personId: "k", amount: 1200 }] }, tx({ amount: 2400 }));
    expect(state().transactions[0].amount).toBe(1200);
    expect(balances(state().splits).get("k")).toBe(-1200);
  });

  it("records no spending at all when my share is nothing", () => {
    actions.addSplit({ title: "Treat", total: 500, paidBy: "me", date: new Date().toISOString(), mode: "exact", shares: [{ personId: "me", amount: 0 }, { personId: "a", amount: 500 }] }, tx({ amount: 500 }));
    expect(state().transactions).toHaveLength(0);
    expect(state().splits[0].txId).toBeUndefined();
  });
});

describe("people", () => {
  beforeEach(() => syncPort.reset());

  it("adding a name that already exists returns that person, whatever the case or spacing", () => {
    const a = actions.addPerson({ name: "Asha", group: "friend" });
    const again = actions.addPerson({ name: "  asha ", group: "family" });
    expect(again.id).toBe(a.id);
    expect(state().people).toHaveLength(1);
  });
});

describe("deleting a person", () => {
  beforeEach(() => syncPort.reset());
  const when = new Date().toISOString();

  it("is refused while a split with them is still open, even if the net balance is zero", () => {
    const a = actions.addPerson({ name: "Asha", group: "friend" });
    actions.addSplit({ title: "Lunch", total: 200, paidBy: "me", date: when, mode: "equal", shares: [{ personId: "me", amount: 100 }, { personId: a.id, amount: 100 }] });
    actions.addSplit({ title: "Cab", total: 200, paidBy: a.id, date: when, mode: "equal", shares: [{ personId: "me", amount: 100 }, { personId: a.id, amount: 100 }] });
    expect(balances(state().splits).get(a.id)).toBe(0);
    expect(actions.deletePerson(a.id)).toBe(false);
    expect(state().people).toHaveLength(1);
  });

  it("works once everything with them is settled", () => {
    const a = actions.addPerson({ name: "Asha", group: "friend" });
    actions.addSplit({ title: "Lunch", total: 200, paidBy: "me", date: when, mode: "equal", shares: [{ personId: "me", amount: 100 }, { personId: a.id, amount: 100 }] });
    actions.settlePerson(a.id);
    expect(actions.deletePerson(a.id)).toBe(true);
    expect(state().people).toHaveLength(0);
  });
});

describe("splits that point at a person who is gone (e.g. deleted on another device)", () => {
  beforeEach(() => syncPort.reset());

  it("can still be settled, so the totals on Splits can be cleared", () => {
    actions.addSplit({ title: "Lunch", total: 200, paidBy: "me", date: new Date().toISOString(), mode: "equal", shares: [{ personId: "me", amount: 100 }, { personId: "ghost", amount: 100 }] });
    expect(splitSummary(state().splits).owedToMe).toBe(100);
    actions.settlePerson("ghost");
    expect(splitSummary(state().splits).owedToMe).toBe(0);
  });
});
