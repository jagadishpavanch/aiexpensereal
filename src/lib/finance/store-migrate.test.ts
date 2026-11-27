import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CATEGORIES, emptyState } from "./demo";

/** Loads the store fresh with `saved` already in localStorage, as an existing install would. */
async function loadWith(saved: unknown) {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem("extrack:v1", JSON.stringify(saved));
  const { syncPort } = await import("./store");
  return syncPort.getState();
}

describe("store migration of categories", () => {
  beforeEach(() => localStorage.clear());

  it("adds the Other income category to an install saved before it existed", async () => {
    const old = { ...emptyState(), categories: DEFAULT_CATEGORIES.filter((c) => c.id !== "other-income") };
    const s = await loadWith(old);
    expect(s.categories.find((c) => c.id === "other-income")).toEqual({ id: "other-income", name: "Other income", icon: "circle", color: "chart-4", kind: "income" });
    expect(s.categories.length).toBe(old.categories.length + 1);
  });

  it("keeps the user's own categories and does not duplicate the new one", async () => {
    const custom = { id: "c1", name: "Pocket money", icon: "tag", color: "chart-5", kind: "income" as const };
    const s = await loadWith({ ...emptyState(), categories: [...DEFAULT_CATEGORIES, custom] });
    expect(s.categories.filter((c) => c.id === "other-income")).toHaveLength(1);
    expect(s.categories).toContainEqual(custom);
  });
});
