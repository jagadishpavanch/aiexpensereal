import { act, fireEvent, render, screen } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  status: vi.fn(), requestSms: vi.fn(), readInbox: vi.fn(), openNotificationSettings: vi.fn(), queued: vi.fn(), ack: vi.fn(), addListener: vi.fn(),
}));
vi.mock("@/lib/sms/native", () => ({ smsReader: native, nativeSmsAvailable: () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { SmsPermissionPrompt } from "@/components/app/sms-permission-prompt";
import { TxSheetProvider } from "@/components/app/tx-sheet";
import { syncPort } from "@/lib/finance/store";
import { getImportProgress, smsPromptDue } from "@/lib/sms/runtime";
import { SYNC_KEYS } from "@/lib/sync/engine";

const HDFC = "Sent Rs.250.00\nFrom HDFC Bank A/C *4821\nTo SWIGGY\nOn 21/10/26\nRef 629104837122\nNot You? Call 18002586161/SMS BLOCK UPI to 7308080808";

const show = async () => {
  render(<TxSheetProvider><SmsPermissionPrompt /></TxSheetProvider>);
  await act(async () => { vi.advanceTimersByTime(800); });
};

// Fake timers strand motion's frame loop between tests, so exit animations never finish here.
MotionGlobalConfig.skipAnimations = true;

beforeEach(async () => {
  // The import is a shared background job; let one from an earlier test finish first.
  vi.useRealTimers();
  await vi.waitFor(() => expect(getImportProgress()).toBeNull());
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  syncPort.reset();
  localStorage.setItem(SYNC_KEYS.owner, "u1");
  native.status.mockResolvedValue({ sms: "prompt", notifications: false });
  native.requestSms.mockResolvedValue({ sms: "granted", notifications: false });
  native.readInbox.mockResolvedValue({ messages: [{ id: "7", address: "VM-HDFCBK", body: HDFC, date: Date.now() - 1000 }], scanned: 12 });
});

describe("SmsPermissionPrompt", () => {
  it("asks after sign-in, and Allow imports the inbox and remembers the answer", async () => {
    await show();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Allow SMS access" })); });
    // the import yields between batches and the sheet animates between steps
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(native.requestSms).toHaveBeenCalled();
    expect(syncPort.getState().transactions[0]).toMatchObject({ amount: 250, source: "sms" });
    expect(toast.success).toHaveBeenCalledWith("Added 1 transaction from bank SMS", expect.anything());
    expect(smsPromptDue()).toBe(false);
  });

  it("Not now is remembered, so it doesn't ask again", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(smsPromptDue()).toBe(false);
    expect(native.requestSms).not.toHaveBeenCalled();
  });

  it("explains the restricted-settings switch when Android refuses", async () => {
    native.requestSms.mockResolvedValue({ sms: "denied", notifications: false });
    await show();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Allow SMS access" })); });
    // the import yields between batches and the sheet animates between steps
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText(/Allow restricted settings/)).toBeTruthy();
  });
});
