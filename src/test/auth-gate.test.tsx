import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/lib/sync/runtime";

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  session: { auth: "signedOut" } as AppSession,
  subs: new Set<() => void>(),
}));

vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  useNavigate: () => h.navigate,
  useHydrated: () => true,
}));
vi.mock("@/lib/sync/runtime", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useAppSession: () =>
      useSyncExternalStore(
        (f) => (h.subs.add(f), () => void h.subs.delete(f)),
        () => h.session,
      ),
    retrySync: vi.fn(),
  };
});
vi.mock("@/lib/auth/google", () => ({ signInWithGoogle: vi.fn() }));

const setSession = (s: AppSession) =>
  act(() => {
    h.session = s;
    h.subs.forEach((f) => f());
  });
const signedIn = (sync: "starting" | "ready" | "failed"): AppSession => ({
  auth: "signedIn",
  user: { id: "u1", user_metadata: {} } as never,
  sync,
});

beforeEach(() => {
  localStorage.clear();
  h.navigate.mockReset();
  h.session = { auth: "signedOut" };
});

describe("auth gate", () => {
  it("the shell's redirect to / replaces the history entry, so Android back can exit", async () => {
    const { Route } = await import("@/routes/_shell");
    const Shell = Route.options.component as ComponentType;
    render(<Shell />);
    expect(h.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("losing the session mid-onboarding goes back to the sign-in step", async () => {
    h.session = signedIn("ready");
    const { Route } = await import("@/routes/index");
    const Onboarding = Route.options.component as ComponentType;
    render(<Onboarding />);
    fireEvent.click(screen.getByRole("button", { name: "Start with my own data" }));
    expect(await screen.findByText("How transactions get in")).toBeInTheDocument();
    setSession({ auth: "signedOut" });
    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});
