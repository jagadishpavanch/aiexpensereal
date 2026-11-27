import { toast } from "sonner";
import { formatINR } from "@/lib/finance/format";
import { actions, syncPort } from "@/lib/finance/store";
import { SYNC_KEYS } from "@/lib/sync/engine";
import { nativeSmsAvailable, smsReader } from "./native";
import { planImport } from "./plan";
import type { ImportItem, RawAlert } from "./types";

export class SmsPermissionError extends Error {
  constructor() {
    super("SMS access was not allowed");
  }
}

export const FIRST_IMPORT_DAYS = 180;
const DAY = 86_400_000;
const INBOX_LIMIT = 5000;
/** Device-only: where the inbox import got to, for the account that ran it. Never synced. */
const CURSOR_KEY = "extrack:sms:v1";

const owner = () => localStorage.getItem(SYNC_KEYS.owner);

function cursor(): number {
  try {
    const c = JSON.parse(localStorage.getItem(CURSOR_KEY) ?? "null") as { owner?: unknown; smsSince?: unknown } | null;
    return c && c.owner === owner() && typeof c.smsSince === "number" ? c.smsSince : 0;
  } catch {
    return 0;
  }
}

const saveCursor = (smsSince: number) => localStorage.setItem(CURSOR_KEY, JSON.stringify({ owner: owner(), smsSince }));

function plan(alerts: RawAlert[]): ImportItem[] {
  const s = syncPort.getState();
  return planImport(alerts, s, {
    categorize: (merchant, text, type) => actions.categorize(merchant, { text, type }).categoryId,
    bills: s.prefs.features.bills,
  });
}

/** The demo's sample messages, one day apart, each planned on its own (samples repeat references on purpose). */
export function planSamples(texts: string[], now = Date.now()) {
  const items = texts.flatMap((text, i) => plan([{ id: `sample:${i}`, channel: "sample", from: "", text, at: now - (texts.length - i) * DAY }]));
  return { items, scanned: texts.length };
}

/** Reads the inbox since the last import (or six months back) and plans it. Nothing is saved until commitImport. */
export async function scanInbox(now = Date.now()) {
  let status = await smsReader.status();
  if (status.sms !== "granted") status = await smsReader.requestSms();
  if (status.sms !== "granted") throw new SmsPermissionError();
  const since = cursor() || now - FIRST_IMPORT_DAYS * DAY;
  const { messages, scanned } = await smsReader.readInbox({ since, limit: INBOX_LIMIT });
  const items = plan(messages.map((m) => ({ id: `sms:${m.id}`, channel: "sms" as const, from: m.address, text: m.body, at: m.date })));
  return { items, scanned };
}

/** Saves what the user confirmed and moves the inbox cursor past these messages. */
export function commitImport(items: ImportItem[]) {
  const txs = items.flatMap((i) => (i.outcome.kind === "tx" ? [i.outcome.tx] : []));
  const bills = items.flatMap((i) => (i.outcome.kind === "bill" ? [i.outcome.bill] : []));
  if (txs.length) actions.importTxs(txs);
  for (const b of bills) actions.upsertBill(b);
  const newest = items.reduce((m, i) => (i.alert.channel === "sms" && i.alert.at > m ? i.alert.at : m), 0);
  if (newest > cursor()) saveCursor(newest);
  return { txs: txs.length, bills: bills.length };
}

/** True once this account has imported from this phone's inbox, so later messages can be picked up on their own. */
export const hasImported = () => cursor() > 0;

/** Adds planned transactions and bills right away and shows them in a toast with Undo. */
function addPlanned(items: ImportItem[], description: string): number {
  const hidden = syncPort.getState().prefs.hideAmounts;
  const added = items.flatMap((i) => (i.outcome.kind === "tx" ? [actions.addTx(i.outcome.tx)] : []));
  for (const i of items) if (i.outcome.kind === "bill") actions.upsertBill(i.outcome.bill);
  if (added.length === 1) {
    const t = added[0];
    toast.success(`${t.type === "income" || t.type === "refund" ? "+" : "−"}${formatINR(t.amount, { hidden })} · ${t.merchant}`, { description, action: { label: "Undo", onClick: () => void actions.deleteTx(t.id) } });
  } else if (added.length > 1) {
    toast.success(`Added ${added.length} transactions from bank ${description.includes("SMS") ? "SMS" : "alerts"}`);
  }
  return added.length;
}

let draining: Promise<number> | null = null;

/** Adds alerts the listener queued, then removes them from the phone queue. Overlapping calls share one run. */
export function drainLive(): Promise<number> {
  // .finally is attached after the assignment, so a run that ends at once can't leave a stale promise behind.
  draining ??= (async () => {
    const { alerts } = await smsReader.queued();
    if (!alerts.length) return 0;
    const items = plan(alerts.map((a) => ({ id: a.id, channel: "notification" as const, app: a.app, viaSmsApp: a.fromSmsApp, from: a.title, text: a.text, at: a.at })));
    const added = addPlanned(items, "Added from a bank alert");
    await smsReader.ack({ ids: alerts.map((a) => a.id) });
    return added;
  })().finally(() => {
    draining = null;
  });
  return draining;
}

let catching: Promise<number> | null = null;

/**
 * Adds bank SMS that arrived since the last import. Live alerts need notification access, which
 * Android often greys out for apps installed outside the Play Store; this needs only SMS access.
 * Runs only after a first import, and never asks for permission itself. Duplicates of alerts the
 * listener already added are dropped by planImport (same reference, or same amount within 15 min).
 */
export function catchUpInbox(): Promise<number> {
  // .finally is attached after the assignment: with no import yet this run ends without awaiting,
  // and clearing the marker inside it would leave a finished promise that every later call reused.
  catching ??= (async () => {
    const since = cursor();
    if (!since) return 0;
    const status = await smsReader.status();
    if (status.sms !== "granted") return 0;
    const { messages } = await smsReader.readInbox({ since, limit: INBOX_LIMIT });
    if (!messages.length) return 0;
    const items = plan(messages.map((m) => ({ id: `sms:${m.id}`, channel: "sms" as const, from: m.address, text: m.body, at: m.date })));
    const added = addPlanned(items, "Added from a bank SMS");
    const newest = messages.reduce((m, x) => Math.max(m, x.date), since);
    if (newest > since) saveCursor(newest);
    return added;
  })().finally(() => {
    catching = null;
  });
  return catching;
}

/** Android only: picks up queued alerts now, whenever the app comes back, and while it's open. Returns a stop function. */
export function startLiveTracking(): () => void {
  if (!nativeSmsAvailable()) return () => {};
  // Queued live alerts first, then the inbox since the last import (covers phones without notification access).
  const drain = () =>
    void drainLive()
      .catch((err) => console.warn("[sms]", err))
      .then(() => catchUpInbox())
      .catch((err) => console.warn("[sms]", err));
  drain();
  const onVisible = () => {
    if (document.visibilityState === "visible") drain();
  };
  document.addEventListener("visibilitychange", onVisible);
  const sub = smsReader.addListener("alert", drain);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    void sub.then((h) => h.remove());
  };
}
