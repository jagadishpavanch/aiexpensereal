import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  status: vi.fn(), requestSms: vi.fn(), readInbox: vi.fn(), openNotificationSettings: vi.fn(), queued: vi.fn(), ack: vi.fn(), addListener: vi.fn(),
}));
vi.mock("./native", () => ({ smsReader: native, nativeSmsAvailable: () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { toast } from "sonner";
import { syncPort } from "@/lib/finance/store";
import { SYNC_KEYS } from "@/lib/sync/engine";
import { commitImport, drainLive, FIRST_IMPORT_DAYS, planSamples, scanInbox, SmsPermissionError } from "./runtime";

const HDFC = "Sent Rs.250.00\nFrom HDFC Bank A/C *4821\nTo SWIGGY\nOn 21/10/26\nRef 629104837122\nNot You? Call 18002586161/SMS BLOCK UPI to 7308080808";
const NOW = Date.UTC(2026, 10, 27);
const SIX_MONTHS_AGO = NOW - FIRST_IMPORT_DAYS * 86_400_000;
const inbox = (date = NOW - 1000) => ({ messages: [{ id: "7", address: "VM-HDFCBK", body: HDFC, date }], scanned: 40 });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  syncPort.reset();
  localStorage.setItem(SYNC_KEYS.owner, "u1");
  native.status.mockResolvedValue({ sms: "granted", notifications: false });
  native.ack.mockResolvedValue(undefined);
});

describe("scanInbox", () => {
  it("reads six months back the first time and plans the messages", async () => {
    native.readInbox.mockResolvedValue(inbox());
    const { items, scanned } = await scanInbox(NOW);
    expect(native.readInbox).toHaveBeenCalledWith({ since: SIX_MONTHS_AGO, limit: 5000 });
    expect(scanned).toBe(40);
    expect(items[0].outcome).toMatchObject({ kind: "tx", tx: { amount: 250, source: "sms", merchant: "Swiggy" } });
  });

  it("asks for SMS access and stops when it's refused", async () => {
    native.status.mockResolvedValue({ sms: "prompt", notifications: false });
    native.requestSms.mockResolvedValue({ sms: "denied", notifications: false });
    await expect(scanInbox(NOW)).rejects.toBeInstanceOf(SmsPermissionError);
    expect(native.readInbox).not.toHaveBeenCalled();
  });
});

describe("commitImport", () => {
  it("saves transactions and continues the next scan from the newest message", async () => {
    native.readInbox.mockResolvedValue(inbox());
    const { items } = await scanInbox(NOW);
    expect(commitImport(items)).toEqual({ txs: 1, bills: 0 });
    expect(syncPort.getState().transactions[0]).toMatchObject({ amount: 250, merchant: "Swiggy", ref: "629104837122", source: "sms" });
    await scanInbox(NOW);
    expect(native.readInbox).toHaveBeenLastCalledWith({ since: NOW - 1000, limit: 5000 });
  });

  it("a different account on this phone starts from six months back again", async () => {
    native.readInbox.mockResolvedValue(inbox());
    commitImport((await scanInbox(NOW)).items);
    localStorage.setItem(SYNC_KEYS.owner, "u2");
    await scanInbox(NOW);
    expect(native.readInbox).toHaveBeenLastCalledWith({ since: SIX_MONTHS_AGO, limit: 5000 });
  });

  it("scanning twice doesn't import the same payment twice", async () => {
    native.readInbox.mockResolvedValue(inbox());
    commitImport((await scanInbox(NOW)).items);
    const again = await scanInbox(NOW);
    expect(again.items[0].outcome).toEqual({ kind: "duplicate" });
  });
});

describe("drainLive", () => {
  it("adds queued alerts, tells the user, then clears them from the phone queue", async () => {
    native.queued.mockResolvedValue({ alerts: [{ id: "n1", app: "com.phonepe.app", title: "PhonePe", text: HDFC, at: NOW, fromSmsApp: false }] });
    expect(await drainLive()).toBe(1);
    expect(syncPort.getState().transactions[0]).toMatchObject({ source: "notification", amount: 250 });
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(native.ack).toHaveBeenCalledWith({ ids: ["n1"] });
  });

  it("overlapping calls share one run", async () => {
    native.queued.mockResolvedValue({ alerts: [] });
    await Promise.all([drainLive(), drainLive()]);
    expect(native.queued).toHaveBeenCalledTimes(1);
  });
});

describe("planSamples", () => {
  it("plans the built-in samples as demo data, a day apart", () => {
    const { items, scanned } = planSamples([HDFC, HDFC], NOW);
    expect(scanned).toBe(2);
    expect(items.map((i) => i.outcome.kind)).toEqual(["tx", "tx"]);
    expect(items[0].outcome).toMatchObject({ tx: { isDemo: true, source: "sms_demo" } });
  });
});
