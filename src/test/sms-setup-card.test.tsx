import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ android: true }));
vi.mock("@/lib/sms/native", () => ({ nativeSmsAvailable: () => h.android, smsReader: {} }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a> }));

import { SmsSetupCard } from "@/components/app/sms-setup-card";
import { actions, syncPort } from "@/lib/finance/store";
import { SYNC_KEYS } from "@/lib/sync/engine";

beforeEach(() => {
  localStorage.clear();
  syncPort.reset();
  localStorage.setItem(SYNC_KEYS.owner, "u1");
  h.android = true;
});

describe("SmsSetupCard", () => {
  it("points to SMS tracking on Android before the first import", () => {
    render(<SmsSetupCard />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/auto-tracking");
  });

  it("is gone once this account imported from this phone", () => {
    localStorage.setItem("extrack:sms:v1", JSON.stringify({ owner: "u1", smsSince: 1 }));
    render(<SmsSetupCard />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("stays hidden on the web and when auto-tracking is switched off", () => {
    h.android = false;
    const { unmount } = render(<SmsSetupCard />);
    expect(screen.queryByRole("link")).toBeNull();
    unmount();
    h.android = true;
    actions.setPrefs({ features: { ...syncPort.getState().prefs.features, autoTracking: false } });
    render(<SmsSetupCard />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
