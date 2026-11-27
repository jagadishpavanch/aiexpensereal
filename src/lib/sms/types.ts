import type { Bill, Transaction } from "@/lib/finance/types";

/** Where a message came from: the SMS inbox, a live notification, or the built-in samples. */
export type AlertChannel = "sms" | "notification" | "sample";

export interface RawAlert {
  id: string;
  channel: AlertChannel;
  /** SMS sender id, or the notification title. */
  from: string;
  text: string;
  /** Epoch milliseconds. */
  at: number;
  /** Android package that posted the notification. */
  app?: string;
  /** The notification came from an SMS app, so the title is an SMS sender and must pass the bank check. */
  viaSmsApp?: boolean;
}

export type IgnoreReason = "sender" | "not-money" | "bills-off";

export type Outcome =
  | { kind: "tx"; tx: Omit<Transaction, "id"> }
  | { kind: "bill"; bill: Omit<Bill, "id" | "paidCount"> }
  | { kind: "duplicate" }
  | { kind: "unread" }
  | { kind: "ignored"; reason: IgnoreReason };

export interface ImportItem { alert: RawAlert; outcome: Outcome }
