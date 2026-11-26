import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FinanceState } from "@/lib/finance/types";
import type { Change } from "./diff";
import type { RemoteApi, SyncPort } from "./engine";
import { SYNC_KEYS } from "./engine";

type AuthCb = (event: string, session: { user: { id: string } } | null) => void;

const h = vi.hoisted(() => ({
  authCb: null as null | AuthCb,
  port: null as unknown as SyncPort & { commit(fn: (s: FinanceState) => FinanceState): void },
  /** Everything each user's remote has been asked to store, by user id. */
  pushed: {} as Record<string, Change[]>,
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@/lib/auth/google", () => ({ listenForNativeCallback: vi.fn() }));
vi.mock("@/lib/auth/supabase", () => ({
  getSupabase: () => ({
    auth: { onAuthStateChange: (cb: AuthCb) => void (h.authCb = cb), signOut: async () => ({ error: null }) },
  }),
}));
vi.mock("./supabase-remote", () => ({
  supabaseRemote: (_db: unknown, userId: string): RemoteApi => ({
    push: async (changes) => void (h.pushed[userId] = [...(h.pushed[userId] ?? []), ...changes]),
    pull: async () => [],
    hasAny: async () => false,
    wipe: async () => {},
  }),
}));
vi.mock("@/lib/finance/store", async () => {
  const { emptyState } = await import("@/lib/finance/demo");
  let s = emptyState();
  const ls = new Set<(p: FinanceState, n: FinanceState) => void>();
  h.port = {
    getState: () => s,
    onLocalCommit: (l) => (ls.add(l), () => void ls.delete(l)),
    applyRemote: (fn) => void (s = fn(s)),
    reset: () => void (s = emptyState()),
    commit: (fn) => {
      const p = s;
      s = fn(s);
      ls.forEach((l) => l(p, s));
    },
  };
  return { syncPort: h.port };
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const goal = { id: "g1", name: "Bike", target: 100, saved: 0, emoji: "🚲" };

async function load() {
  vi.resetModules();
  h.authCb = null;
  const rt = await import("./runtime");
  rt.initAppSession();
  const fire = async (u: { id: string } | null) => {
    await act(async () => {
      h.authCb!(u ? "SIGNED_IN" : "SIGNED_OUT", u ? { user: u } : null);
      await tick();
      await tick();
    });
  };
  return { rt, fire };
}

describe("an unrequested sign-out (real engine)", () => {
  beforeEach(() => {
    localStorage.clear();
    h.pushed = {};
  });

  it("keeps queued edits and the owner, and the same user's next sign-in pushes them", async () => {
    const { rt, fire } = await load();
    await fire({ id: "u1" });
    h.port.commit((s) => ({ ...s, goals: [goal] }));
    await fire(null); // session expired: not signOutAndForget
    expect(localStorage.getItem(SYNC_KEYS.owner)).toBe("u1");
    expect(JSON.parse(localStorage.getItem(SYNC_KEYS.outbox)!)).toHaveProperty("goals:g1");
    expect(h.pushed["u1"] ?? []).toHaveLength(0);

    await fire({ id: "u1" });
    await rt.syncNow();
    expect(h.pushed["u1"].find((c) => c.collection === "goals" && c.id === "g1")?.data).toEqual(goal);
  });

  it("never hands the first user's queued edit to a different user who signs in next", async () => {
    const { rt, fire } = await load();
    await fire({ id: "u1" });
    h.port.commit((s) => ({ ...s, goals: [goal] }));
    await fire(null);
    await fire({ id: "u2" });
    await rt.syncNow();
    expect(h.pushed["u2"] ?? []).toHaveLength(0);
    expect(h.pushed["u1"] ?? []).toHaveLength(0);
    expect(h.port.getState().goals).toEqual([]);
    expect(localStorage.getItem(SYNC_KEYS.owner)).toBe("u2");
  });
});
