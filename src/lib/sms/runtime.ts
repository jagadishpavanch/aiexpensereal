import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { formatINR } from "@/lib/finance/format";
import { actions, syncPort } from "@/lib/finance/store";
import { SYNC_KEYS } from "@/lib/sync/engine";
import { nativeSmsAvailable, smsReader } from "./native";
import { planImport } from "./plan";
import type { Bill, FinanceState, Transaction } from "@/lib/finance/types";
import type { ImportItem, RawAlert } from "./types";

export class SmsPermissionError extends Error {
  constructor() {
    super("SMS access was not allowed");
  }
}

/** Default import window: one year (six months held only a few transactions on a real phone). */
export const FIRST_IMPORT_DAYS = 365;
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

function plan(alerts: RawAlert[], s: FinanceState = syncPort.getState()): ImportItem[] {
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

/** How far back an import reads: days, or the whole inbox (newest INBOX_LIMIT messages). */
export type ImportRange = 365 | 730 | "all";

/**
 * Reads the inbox since the last import (or six months back) and plans it. Nothing is saved until
 * commitImport. With a `range` it reads that far back regardless of earlier imports; messages
 * already imported come back as duplicates.
 */
export async function scanInbox(now = Date.now(), { range }: { range?: ImportRange } = {}) {
  let status = await smsReader.status();
  if (status.sms !== "granted") status = await smsReader.requestSms();
  if (status.sms !== "granted") throw new SmsPermissionError();
  const since = range === "all" ? 0 : range ? now - range * DAY : cursor() || now - FIRST_IMPORT_DAYS * DAY;
  const { messages, scanned } = await smsReader.readInbox({ since, limit: INBOX_LIMIT });
  const items = plan(messages.map((m) => ({ id: `sms:${m.id}`, channel: "sms" as const, from: m.address, text: m.body, at: m.date })));
  return { items, scanned };
}

/** Saves what the user confirmed and moves the inbox cursor past these messages. */
export function commitImport(items: ImportItem[], scannedUpTo = 0) {
  const txs = items.flatMap((i) => (i.outcome.kind === "tx" ? [i.outcome.tx] : []));
  const bills = items.flatMap((i) => (i.outcome.kind === "bill" ? [i.outcome.bill] : []));
  const ids = txs.length ? actions.importTxs(txs) : [];
  for (const b of bills) actions.upsertBill(b);
  const newest = items.reduce((m, i) => (i.alert.channel === "sms" && i.alert.at > m ? i.alert.at : m), scannedUpTo);
  if (newest > cursor()) saveCursor(newest);
  return { txs: txs.length, bills: bills.length, ids };
}

/** Device-only, per account: the first-launch SMS question was answered (Allow or Not now). */
const PROMPT_KEY = "extrack:sms-prompt:v1";

/** Android first launch: ask once per account on this phone, unless the inbox was already imported. */
export function smsPromptDue(): boolean {
  if (hasImported()) return false;
  try {
    const answered = JSON.parse(localStorage.getItem(PROMPT_KEY) ?? "[]") as unknown;
    return !(Array.isArray(answered) && answered.includes(owner()));
  } catch {
    return true;
  }
}

export function markSmsPromptAnswered() {
  let answered: unknown[] = [];
  try {
    const v = JSON.parse(localStorage.getItem(PROMPT_KEY) ?? "[]") as unknown;
    if (Array.isArray(v)) answered = v;
  } catch {
    /* start over */
  }
  if (!answered.includes(owner())) localStorage.setItem(PROMPT_KEY, JSON.stringify([...answered, owner()]));
}

export type ImportStage = "reading" | "sorting" | "saving";
export interface ImportProgress { stage: ImportStage; read: number; total: number; found: number }

const BATCH = 200;
const toAlert = (m: { id: string; address: string; body: string; date: number }): RawAlert => ({ id: `sms:${m.id}`, channel: "sms", from: m.address, text: m.body, at: m.date });

/**
 * Plans in batches so a big inbox doesn't freeze the screen, yielding between batches. Each batch
 * sees the transactions and bills found before it, so duplicates across batches are still caught.
 */
async function planInBatches(alerts: RawAlert[], onProgress: (p: ImportProgress) => void): Promise<ImportItem[]> {
  let working = syncPort.getState();
  const out: ImportItem[] = [];
  let found = 0;
  for (let i = 0; i < alerts.length; i += BATCH) {
    const items = plan(alerts.slice(i, i + BATCH), working);
    out.push(...items);
    const txs: Transaction[] = items.flatMap((it, n) => (it.outcome.kind === "tx" ? [{ ...it.outcome.tx, id: `pending:${i + n}` }] : []));
    const bills: Bill[] = items.flatMap((it, n) => (it.outcome.kind === "bill" ? [{ ...it.outcome.bill, id: `pending:${i + n}`, paidCount: 0 } as Bill] : []));
    if (txs.length || bills.length) working = { ...working, transactions: [...working.transactions, ...txs], bills: [...working.bills, ...bills] };
    found += txs.length;
    onProgress({ stage: "sorting", read: Math.min(i + BATCH, alerts.length), total: alerts.length, found });
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

/**
 * Asks for SMS access (if needed), reads the chosen range (one year by default) and saves everything
 * it can read, without a review step. Returns the new transaction ids so the whole import can be
 * undone. Throws SmsPermissionError when access is refused.
 */
export async function importAll(now = Date.now(), range: ImportRange = 365, onProgress: (p: ImportProgress) => void = () => {}) {
  onProgress({ stage: "reading", read: 0, total: 0, found: 0 });
  let status = await smsReader.status();
  if (status.sms !== "granted") status = await smsReader.requestSms();
  if (status.sms !== "granted") throw new SmsPermissionError();
  const since = range === "all" ? 0 : now - range * DAY;
  const { messages, scanned } = await smsReader.readInbox({ since, limit: INBOX_LIMIT });
  const alerts = messages.map(toAlert).sort((a, b) => a.at - b.at);
  const items = await planInBatches(alerts, onProgress);
  onProgress({ stage: "saving", read: alerts.length, total: alerts.length, found: items.filter((i) => i.outcome.kind === "tx").length });
  // Even an inbox with no bank messages counts as imported, so the catch-up takes over from now.
  return { ...commitImport(items, now - 1), scanned };
}

// One import at a time, shared by the first-launch prompt, Auto-tracking and the progress pill.
let job: Promise<Awaited<ReturnType<typeof importAll>> | null> | null = null;
let progress: ImportProgress | null = null;
const progressSubs = new Set<() => void>();
const setProgress = (p: ImportProgress | null) => {
  progress = p;
  progressSubs.forEach((f) => f());
};

export const getImportProgress = () => progress;

/** Live progress of the running import, or null. */
export function useImportProgress(): ImportProgress | null {
  return useSyncExternalStore((f) => (progressSubs.add(f), () => void progressSubs.delete(f)), getImportProgress, () => null);
}

/**
 * Starts (or joins) the background import. It keeps running if the screen that started it closes,
 * and ends with a toast that can undo the whole import. Rejects only with SmsPermissionError, so the
 * caller can explain it; any other failure ends with an error toast and resolves to null.
 */
export function startImport(range: ImportRange = 365, now = Date.now()) {
  if (job) return job;
  setProgress({ stage: "reading", read: 0, total: 0, found: 0 });
  job = importAll(now, range, setProgress)
    .then((r) => {
      if (r.txs || r.bills) {
        const parts = [r.txs && `${r.txs} transaction${r.txs === 1 ? "" : "s"}`, r.bills && `${r.bills} bill${r.bills === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
        toast.success(`Added ${parts} from bank SMS`, { description: "New bank messages will be added on their own.", duration: 8000, action: r.ids.length ? { label: "Undo", onClick: () => undoImport(r.ids) } : undefined });
      } else {
        toast.success("SMS tracking is on", { description: "No bank messages found in that range. New ones will be added as they arrive." });
      }
      return r;
    })
    .catch((e: unknown) => {
      if (e instanceof SmsPermissionError) throw e;
      console.warn("[sms]", e);
      toast.error("Couldn't read messages. Try again from More → Auto-tracking.");
      return null;
    })
    .finally(() => {
      job = null;
      setProgress(null);
    });
  return job;
}

export function undoImport(ids: string[]) {
  if (ids.length) actions.removeTxs(ids);
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
