import { act, fireEvent, render, screen } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { describe, expect, it, vi } from "vitest";
import { SmsScanner } from "@/components/app/sms-scanner";
import type { ImportItem } from "@/lib/sms/types";

MotionGlobalConfig.skipAnimations = true;
// jsdom has no layout, so no scrollIntoView.
Element.prototype.scrollIntoView = () => {};

const item: ImportItem = {
  alert: { id: "sms:1", channel: "sms", from: "VM-HDFCBK", text: "Rs 250 debited", at: Date.parse("2026-11-20T06:00:00Z") },
  outcome: { kind: "tx", tx: { type: "expense", amount: 250, merchant: "Swiggy", categoryId: "food", accountId: "upi", date: "2026-11-20T06:00:00.000Z", source: "sms", isDemo: false } },
};

const scanner = (onConfirm: (items: ImportItem[]) => void, saveOnRead?: boolean) => (
  <SmsScanner title="Import" note="" runLabel="Scan messages" load={async () => ({ items: [item], scanned: 1 })} onConfirm={onConfirm} confirmLabel={() => "Add"} saveOnRead={saveOnRead} />
);

describe("SmsScanner", () => {
  // Messages used to show up in the list but reached Home only after a tap on a button under it; leaving the
  // screen first (or during the reading animation) dropped the whole import.
  it("with saveOnRead, saves what it read even if the screen closes during the animation", async () => {
    const onConfirm = vi.fn();
    const { unmount } = render(scanner(onConfirm, true));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /scan messages/i })); });
    unmount();
    expect(onConfirm).toHaveBeenCalledWith([item]);
  });

  it("without it, waits for the confirm button", async () => {
    const onConfirm = vi.fn();
    const { unmount } = render(scanner(onConfirm));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /scan messages/i })); });
    unmount();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
