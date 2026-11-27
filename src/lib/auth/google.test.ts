import { beforeEach, describe, expect, it, vi } from "vitest";

const appUrlHandlers: Array<(e: { url: string }) => void> = [];
let launchUrl: string | undefined;

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: async (_: string, h: (e: { url: string }) => void) => void appUrlHandlers.push(h),
    getLaunchUrl: async () => (launchUrl ? { url: launchUrl } : undefined),
  },
}));
vi.mock("@capacitor/browser", () => ({ Browser: { close: async () => {}, open: async () => {} } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("./supabase", () => ({ getSupabase: () => null }));

import { listenForNativeCallback } from "./google";

const LINK = "com.extrack.app://auth/callback?code=abc123";
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("listenForNativeCallback", () => {
  beforeEach(() => {
    appUrlHandlers.length = 0;
    launchUrl = undefined;
  });

  it("exchanges a repeated deep-link code only once", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    launchUrl = LINK;
    await listenForNativeCallback({ auth: { exchangeCodeForSession } } as never);
    appUrlHandlers[0]({ url: LINK });
    appUrlHandlers[0]({ url: LINK });
    await flush();
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
  });

  it("exchanges a different code", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    await listenForNativeCallback({ auth: { exchangeCodeForSession } } as never);
    appUrlHandlers[0]({ url: LINK });
    appUrlHandlers[0]({ url: "com.extrack.app://auth/callback?code=zzz" });
    await flush();
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(2);
  });
});
