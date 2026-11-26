import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

type AuthCb = (event: string, session: { user: { id: string } } | null) => void;
type FakeEngine = {
  userId: string;
  start: Mock;
  syncNow: Mock;
  forget: Mock;
  stop: Mock;
  wipeAll: Mock;
  emit: (i: unknown) => void;
  resolveStart: () => void;
  rejectStart: () => void;
};

const h = vi.hoisted(() => ({
  authCb: null as null | AuthCb,
  signOut: null as unknown as Mock,
  engines: [] as FakeEngine[],
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@/lib/auth/google", () => ({ listenForNativeCallback: vi.fn() }));
vi.mock("@/lib/finance/store", () => ({ syncPort: {} }));
vi.mock("./supabase-remote", () => ({ supabaseRemote: (_db: unknown, userId: string) => ({ userId }) }));
vi.mock("@/lib/auth/supabase", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (cb: AuthCb) => void (h.authCb = cb),
      signOut: (o: unknown) => h.signOut(o),
    },
  }),
}));
vi.mock("./engine", () => ({
  createSyncEngine: (opts: { remote: { userId: string }; onInfo: (i: unknown) => void }) => {
    let resolveStart!: () => void;
    let rejectStart!: () => void;
    const e: FakeEngine = {
      userId: opts.remote.userId,
      start: vi.fn(
        () =>
          new Promise<void>((res, rej) => {
            resolveStart = res;
            rejectStart = rej;
          }),
      ),
      syncNow: vi.fn(async () => {}),
      forget: vi.fn(),
      stop: vi.fn(),
      wipeAll: vi.fn(async () => {}),
      emit: opts.onInfo,
      resolveStart: () => resolveStart(),
      rejectStart: () => rejectStart(),
    };
    h.engines.push(e);
    return e;
  },
}));

const tick = () => new Promise((r) => setTimeout(r, 0));
const user = (id: string) => ({ id });

async function load() {
  vi.resetModules();
  h.engines.length = 0;
  h.authCb = null;
  const rt = await import("./runtime");
  rt.initAppSession();
  const fire = async (u: { id: string } | null) => {
    await act(async () => {
      h.authCb!(u ? "SIGNED_IN" : "SIGNED_OUT", u ? { user: u } : null);
      await tick();
    });
  };
  const settle = (fn: () => void) => act(async () => { fn(); await tick(); });
  const sess = renderHook(() => rt.useAppSession());
  const info = renderHook(() => rt.useSyncInfo());
  return { rt, fire, settle, sess, info };
}

describe("app session runtime", () => {
  beforeEach(() => {
    h.signOut = vi.fn().mockResolvedValue({ error: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("a start that resolves after sign-out leaves the session signed out", async () => {
    const { fire, settle, sess } = await load();
    await fire(user("u1"));
    expect(sess.result.current).toMatchObject({ auth: "signedIn", sync: "starting" });
    await fire(null);
    expect(sess.result.current).toEqual({ auth: "signedOut" });
    await settle(() => h.engines[0].resolveStart());
    expect(sess.result.current).toEqual({ auth: "signedOut" });
  });

  it("a start that fails after sign-out leaves the session signed out", async () => {
    const { fire, settle, sess } = await load();
    await fire(user("u1"));
    await fire(null);
    await settle(() => h.engines[0].rejectStart());
    expect(sess.result.current).toEqual({ auth: "signedOut" });
  });

  it("a stale start for the previous user cannot replace the new user's session", async () => {
    const { fire, settle, sess } = await load();
    await fire(user("u1"));
    await fire(user("u2"));
    await settle(() => h.engines[0].resolveStart());
    expect(sess.result.current).toMatchObject({ auth: "signedIn", user: { id: "u2" }, sync: "starting" });
  });

  it("syncNow does nothing while the engine is still starting, and forwards once ready", async () => {
    const { rt, fire, settle } = await load();
    await fire(user("u1"));
    await rt.syncNow();
    expect(h.engines[0].syncNow).not.toHaveBeenCalled();
    await settle(() => h.engines[0].resolveStart());
    await rt.syncNow();
    expect(h.engines[0].syncNow).toHaveBeenCalledTimes(1);
  });

  it("the online event does not sync before ready", async () => {
    const { fire } = await load();
    await fire(user("u1"));
    window.dispatchEvent(new Event("online"));
    expect(h.engines[0].syncNow).not.toHaveBeenCalled();
  });

  it("retrySync while a start is in flight does not start a second one", async () => {
    const { rt, fire, settle } = await load();
    await fire(user("u1"));
    rt.retrySync();
    expect(h.engines[0].start).toHaveBeenCalledTimes(1);
    await settle(() => h.engines[0].rejectStart());
    await act(async () => rt.retrySync());
    expect(h.engines[0].start).toHaveBeenCalledTimes(2);
  });

  it("a plain SIGNED_OUT event forgets the previous user's data before stopping", async () => {
    const { fire } = await load();
    await fire(user("u1"));
    await fire(null);
    const e = h.engines[0];
    expect(e.forget).toHaveBeenCalledTimes(1);
    expect(e.stop).toHaveBeenCalledTimes(1);
    expect(e.forget.mock.invocationCallOrder[0]).toBeLessThan(e.stop.mock.invocationCallOrder[0]);
  });

  it("signOutAndForget signs out this phone only and forgets the data", async () => {
    const { rt, fire, sess } = await load();
    await fire(user("u1"));
    await act(async () => rt.signOutAndForget());
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(h.engines[0].forget).toHaveBeenCalled();
    expect(sess.result.current).toEqual({ auth: "signedOut" });
  });

  it("signOutAndForget still ends signed out when signOut rejects", async () => {
    h.signOut = vi.fn().mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rt, fire, sess } = await load();
    await fire(user("u1"));
    await act(async () => {
      await expect(rt.signOutAndForget()).resolves.toBeUndefined();
    });
    expect(warn).toHaveBeenCalled();
    expect(h.engines[0].forget).toHaveBeenCalled();
    expect(h.engines[0].stop).toHaveBeenCalled();
    expect(sess.result.current).toEqual({ auth: "signedOut" });
  });

  it("resets sync info on sign-out", async () => {
    const { fire, info } = await load();
    await fire(user("u1"));
    act(() => h.engines[0].emit({ status: "error", pending: 3, lastSyncedAt: 1, lastError: "x" }));
    expect(info.result.current.pending).toBe(3);
    await fire(null);
    expect(info.result.current).toEqual({ status: "idle", pending: 0, lastSyncedAt: null, lastError: null });
  });
});
