import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  status: vi.fn(), requestSms: vi.fn(), readInbox: vi.fn(), openNotificationSettings: vi.fn(), queued: vi.fn(), ack: vi.fn(), addListener: vi.fn(),
}));
vi.mock("./native", () => ({ smsReader: native, nativeSmsAvailable: () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { toast } from "sonner";
import { syncPort } from "@/lib/finance/store";
import { SYNC_KEYS } from "@/lib/sync/engine";
import { catchUpInbox, commitImport, drainLive, FIRST_IMPORT_DAYS, getImportProgress, hasImported, importAll, markSmsPromptAnswered, planSamples, scanInbox, smsPromptDue, SmsPermissionError, startImport, undoImport } from "./runtime";

const HDFC = "Sent Rs.250.00\nFrom HDFC Bank A/C *4821\nTo SWIGGY\nOn 21/10/26\nRef 629104837122\nNot You? Call 18002586161/SMS BLOCK UPI to 7308080808";
const NOW = Date.UTC(2026, 10, 27);
const SIX_MONTHS_AGO = NOW - FIRST_IMPORT_DAYS * 86_400_000; // the default window (one year)
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
    expect(commitImport(items)).toMatchObject({ txs: 1, bills: 0 });
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

// Live alerts need notification access, which Android often greys out for apps installed
// outside the Play Store. With only SMS access, new bank messages were never added after the
// first import. The catch-up reads the inbox since the last import whenever the app opens.
describe("catchUpInbox", () => {
  const SWIGGY_2 = HDFC.replace("Rs.250.00", "Rs.180.00").replace("629104837122", "629104837999");

  it("does nothing before the first import", async () => {
    expect(hasImported()).toBe(false);
    expect(await catchUpInbox()).toBe(0);
    expect(native.readInbox).not.toHaveBeenCalled();
  });

  it("adds bank SMS that arrived since the last import, tells the user, and moves on", async () => {
    native.readInbox.mockResolvedValueOnce(inbox(NOW - 5000));
    commitImport((await scanInbox(NOW)).items);
    expect(hasImported()).toBe(true);
    native.readInbox.mockResolvedValueOnce({ messages: [{ id: "8", address: "VM-HDFCBK", body: SWIGGY_2, date: NOW - 1000 }], scanned: 3 });
    const n = await catchUpInbox();
    expect(n).toBe(1);
    expect(native.readInbox).toHaveBeenLastCalledWith({ since: NOW - 5000, limit: 5000 });
    expect(syncPort.getState().transactions.map((t) => t.amount)).toEqual([180, 250]);
    expect(toast.success).toHaveBeenCalled();
    native.readInbox.mockResolvedValueOnce({ messages: [], scanned: 0 });
    await catchUpInbox();
    expect(native.readInbox).toHaveBeenLastCalledWith({ since: NOW - 1000, limit: 5000 });
  });

  it("never asks for permission on its own, and skips when SMS access was taken away", async () => {
    native.readInbox.mockResolvedValueOnce(inbox(NOW - 5000));
    commitImport((await scanInbox(NOW)).items);
    native.status.mockResolvedValue({ sms: "denied", notifications: false });
    expect(await catchUpInbox()).toBe(0);
    expect(native.requestSms).not.toHaveBeenCalled();
  });

  it("doesn't add a message twice when the notification listener already added it", async () => {
    native.readInbox.mockResolvedValueOnce(inbox(NOW - 5000));
    commitImport((await scanInbox(NOW)).items);
    native.queued.mockResolvedValueOnce({ alerts: [{ id: "n1", app: "com.google.android.apps.messaging", title: "VM-HDFCBK", text: SWIGGY_2, at: NOW - 1000, fromSmsApp: true }] });
    await drainLive();
    native.readInbox.mockResolvedValueOnce({ messages: [{ id: "8", address: "VM-HDFCBK", body: SWIGGY_2, date: NOW - 1000 }], scanned: 1 });
    expect(await catchUpInbox()).toBe(0);
    expect(syncPort.getState().transactions.filter((t) => t.amount === 180)).toHaveLength(1);
  });
});

// First launch on Android: one prompt asks for SMS access, imports the last six months right
// away and remembers that it asked, so it never nags again on this phone for this account.
describe("smsPrompt and importAll", () => {
  it("is due once per account on this phone, until answered", () => {
    expect(smsPromptDue()).toBe(true);
    markSmsPromptAnswered();
    expect(smsPromptDue()).toBe(false);
    localStorage.setItem(SYNC_KEYS.owner, "u2");
    expect(smsPromptDue()).toBe(true);
  });

  it("is not due once the inbox was imported another way", async () => {
    native.readInbox.mockResolvedValueOnce(inbox());
    commitImport((await scanInbox(NOW)).items);
    expect(smsPromptDue()).toBe(false);
  });

  it("imports everything it finds and can undo the whole import", async () => {
    native.readInbox.mockResolvedValueOnce(inbox());
    const r = await importAll(NOW);
    expect(r).toMatchObject({ txs: 1, bills: 0, scanned: 40 });
    expect(syncPort.getState().transactions).toHaveLength(1);
    expect(hasImported()).toBe(true);
    undoImport(r.ids);
    expect(syncPort.getState().transactions).toHaveLength(0);
  });

  it("passes on a refusal so the screen can explain it", async () => {
    native.status.mockResolvedValue({ sms: "prompt", notifications: false });
    native.requestSms.mockResolvedValue({ sms: "denied", notifications: false });
    await expect(importAll(NOW)).rejects.toBeInstanceOf(SmsPermissionError);
  });
});

describe("scanInbox range", () => {
  it("re-reads the chosen range even after an import, and already imported messages come back as duplicates", async () => {
    native.readInbox.mockResolvedValue(inbox(NOW - 5000));
    commitImport((await scanInbox(NOW)).items);
    const { items } = await scanInbox(NOW, { range: 365 });
    expect(native.readInbox).toHaveBeenLastCalledWith({ since: SIX_MONTHS_AGO, limit: 5000 });
    expect(items[0].outcome.kind).toBe("duplicate");
  });

  // Real phone: 352 bank transactions in the inbox, only 30 of them in the last six months.
  it("reads two years back, or the whole inbox", async () => {
    native.readInbox.mockResolvedValue(inbox());
    await scanInbox(NOW, { range: 730 });
    expect(native.readInbox).toHaveBeenLastCalledWith({ since: NOW - 730 * 86_400_000, limit: 5000 });
    await scanInbox(NOW, { range: "all" });
    expect(native.readInbox).toHaveBeenLastCalledWith({ since: 0, limit: 5000 });
  });

  it("the first-launch import reads one year by default", async () => {
    native.readInbox.mockResolvedValue(inbox());
    await importAll(NOW);
    expect(native.readInbox).toHaveBeenLastCalledWith({ since: NOW - 365 * 86_400_000, limit: 5000 });
  });
});

describe("importAll in batches", () => {
  const msg = (i: number, ref: string, amount = 100 + i) => ({ id: String(i), address: "VM-HDFCBK", body: HDFC.replace("Rs.250.00", `Rs.${amount}.00`).replace("629104837122", ref), date: NOW - (1000 - i) * 60_000 });

  it("reports progress through every batch and finds duplicates across batches", async () => {
    const messages = Array.from({ length: 450 }, (_, i) => msg(i, `9${String(i).padStart(11, "0")}`));
    messages.push(msg(450, "900000000003", 103)); // same reference as message 3, in a later batch
    native.readInbox.mockResolvedValue({ messages, scanned: 451 });
    const seen: string[] = [];
    const r = await importAll(NOW, 365, (p) => seen.push(`${p.stage}:${p.read}`));
    expect(r.txs).toBe(450);
    expect(seen[0]).toBe("reading:0");
    expect(seen).toContain("sorting:200");
    expect(seen).toContain("sorting:451");
    expect(seen.at(-1)).toBe("saving:451");
  });

  it("startImport shares one running job and exposes its progress", async () => {
    native.readInbox.mockResolvedValue(inbox());
    const a = startImport(365, NOW);
    const b = startImport(365, NOW);
    expect(a).toBe(b);
    expect(getImportProgress()).not.toBeNull();
    await a;
    expect(getImportProgress()).toBeNull();
    expect(syncPort.getState().transactions).toHaveLength(1);
  });
});
