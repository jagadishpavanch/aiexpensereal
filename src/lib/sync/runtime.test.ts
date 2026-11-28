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
  storageKey: "sb-test-auth-token" as string | undefined,
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
      ...(h.storageKey === undefined ? {} : { storageKey: h.storageKey }),
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
  SYNC_KEYS: { outbox: "extrack:outbox:v1", cursor: "extrack:cursor:v1", owner: "extrack:owner:v1" },
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
  const fireEvent = async (event: string, u: { id: string } | null) => {
    await act(async () => {
      h.authCb!(event, u ? { user: u } : null);
      await tick();
    });
  };
  const settle = (fn: () => void) => act(async () => { fn(); await tick(); });
  const sess = renderHook(() => rt.useAppSession());
  const info = renderHook(() => rt.useSyncInfo());
  return { rt, fire, fireEvent, settle, sess, info };
}

describe("app session runtime", () => {
  beforeEach(() => {
    h.signOut = vi.fn().mockResolvedValue({ error: null });
    h.storageKey = "sb-test-auth-token";
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

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

  it("a plain SIGNED_OUT event keeps the user's data and only stops the engine", async () => {
    const { fire, sess } = await load();
    await fire(user("u1"));
    await fire(null);
    const e = h.engines[0];
    expect(e.forget).not.toHaveBeenCalled();
    expect(e.stop).toHaveBeenCalledTimes(1);
    expect(sess.result.current).toEqual({ auth: "signedOut" });
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
      await expect(rt.signOutAndForget()).resolves.toMatchObject({ signedOut: true });
    });
    expect(warn).toHaveBeenCalled();
    expect(h.engines[0].forget).toHaveBeenCalled();
    expect(h.engines[0].stop).toHaveBeenCalled();
    expect(sess.result.current).toEqual({ auth: "signedOut" });
  });

  it("signOutAndForget does not wait longer than 5 seconds for the final sync", async () => {
    const { rt, fire, sess } = await load();
    await fire(user("u1"));
    h.engines[0].syncNow.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers();
    try {
      await act(async () => {
        const p = rt.signOutAndForget();
        await vi.advanceTimersByTimeAsync(4999);
        expect(h.signOut).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await p;
      });
      expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(h.engines[0].forget).toHaveBeenCalled();
      expect(sess.result.current).toEqual({ auth: "signedOut" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("signOutAndForget clears its timeout once the final sync finishes", async () => {
    const { rt, fire } = await load();
    await fire(user("u1"));
    vi.useFakeTimers();
    try {
      await act(async () => rt.signOutAndForget());
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets sync info on sign-out", async () => {
    const { fire, info } = await load();
    await fire(user("u1"));
    act(() => h.engines[0].emit({ status: "error", pending: 3, lastSyncedAt: 1, lastError: "x" }));
    expect(info.result.current.pending).toBe(3);
    await fire(null);
    expect(info.result.current).toEqual({ status: "idle", pending: 0, lastSyncedAt: null, lastError: null });
  });
  it("signOutAndForget forgets the data even though supabase fires SIGNED_OUT before signOut resolves", async () => {
    const { rt, fire, sess } = await load();
    await fire(user("u1"));
    h.signOut = vi.fn(async () => {
      h.authCb!("SIGNED_OUT", null); // _removeSession notifies before the revoke request
      await tick(); // the deferred handler runs while the request is in flight
      await tick();
      return { error: null };
    });
    await act(async () => rt.signOutAndForget());
    const e = h.engines[0];
    expect(e.syncNow).toHaveBeenCalledTimes(1);
    expect(e.forget).toHaveBeenCalledTimes(1);
    expect(e.stop).toHaveBeenCalled();
    expect(sess.result.current).toEqual({ auth: "signedOut" });
  });

  it("INITIAL_SESSION with null but a session still in storage (offline, token expired) stays signed in", async () => {
    localStorage.setItem("sb-test-auth-token", JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 1, user: { id: "u1" } }));
    const { fireEvent, settle, sess } = await load();
    await fireEvent("INITIAL_SESSION", null);
    expect(sess.result.current).toMatchObject({ auth: "signedIn", user: { id: "u1" }, sync: "starting" });
    expect(h.engines).toHaveLength(1);
    expect(h.engines[0].start).toHaveBeenCalledWith("u1");
    await settle(() => h.engines[0].resolveStart());
    expect(sess.result.current).toMatchObject({ auth: "signedIn", sync: "ready" });
    await fireEvent("TOKEN_REFRESHED", user("u1")); // network back: same user, same engine
    expect(h.engines).toHaveLength(1);
    expect(sess.result.current).toMatchObject({ auth: "signedIn", user: { id: "u1" }, sync: "ready" });
  });

  it("derives the storage key from VITE_SUPABASE_URL when the client doesn't expose one", async () => {
    h.storageKey = undefined;
    vi.stubEnv("VITE_SUPABASE_URL", "https://abcdref.supabase.co");
    localStorage.setItem("sb-abcdref-auth-token", JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 1, user: { id: "u1" } }));
    const { fireEvent, sess } = await load();
    await fireEvent("INITIAL_SESSION", null);
    expect(sess.result.current).toMatchObject({ auth: "signedIn", user: { id: "u1" } });
  });

  it("INITIAL_SESSION with null and nothing stored is signed out", async () => {
    localStorage.setItem("sb-test-auth-token", "not json");
    const { fireEvent, sess } = await load();
    await fireEvent("INITIAL_SESSION", null);
    expect(sess.result.current).toEqual({ auth: "signedOut" });
    expect(h.engines).toHaveLength(0);
  });

  // Offline with an expired token, supabase retries the refresh for ~25 s before its first event. A returning user
  // whose data is already on this phone must not sit on the splash for that long.
  it("a returning user opens straight away, before supabase reports the session", async () => {
    localStorage.setItem("sb-test-auth-token", JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 1, user: { id: "u1" } }));
    localStorage.setItem("extrack:owner:v1", "u1");
    const { settle, fireEvent, sess } = await load(); // no auth event fired yet
    expect(sess.result.current).toMatchObject({ auth: "signedIn", user: { id: "u1" } });
    expect(h.engines).toHaveLength(1);
    await settle(() => h.engines[0].resolveStart());
    expect(sess.result.current).toMatchObject({ auth: "signedIn", sync: "ready" });
    await fireEvent("INITIAL_SESSION", user("u1")); // supabase catches up: same user, same engine
    expect(h.engines).toHaveLength(1);
  });

  it("a returning user whose session was revoked ends signed out once supabase reports it", async () => {
    localStorage.setItem("sb-test-auth-token", JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 1, user: { id: "u1" } }));
    localStorage.setItem("extrack:owner:v1", "u1");
    const { fireEvent, sess } = await load();
    localStorage.removeItem("sb-test-auth-token"); // supabase drops a rejected refresh token, then:
    await fireEvent("SIGNED_OUT", null);
    await fireEvent("INITIAL_SESSION", null);
    expect(sess.result.current).toEqual({ auth: "signedOut" });
    expect(h.engines[0].forget).not.toHaveBeenCalled(); // an unrequested sign-out keeps the data
  });

  it("a stored session for a different user than this phone's data waits for supabase", async () => {
    localStorage.setItem("sb-test-auth-token", JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 1, user: { id: "u2" } }));
    localStorage.setItem("extrack:owner:v1", "u1");
    const { sess } = await load();
    expect(sess.result.current).toEqual({ auth: "loading" });
    expect(h.engines).toHaveLength(0);
  });

  it("a real SIGNED_OUT never revives the stored session", async () => {
    localStorage.setItem("sb-test-auth-token", JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 1, user: { id: "u1" } }));
    const { fire, fireEvent, sess } = await load();
    await fire(user("u1"));
    await fireEvent("SIGNED_OUT", null);
    expect(sess.result.current).toEqual({ auth: "signedOut" });
    expect(h.engines).toHaveLength(1);
  });
});
