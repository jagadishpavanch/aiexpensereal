import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type SmsPermission = "granted" | "denied" | "prompt" | "prompt-with-rationale";
export interface SmsStatus { sms: SmsPermission; notifications: boolean }
export interface InboxMessage { id: string; address: string; body: string; date: number }
export interface QueuedAlert { id: string; app: string; title: string; text: string; at: number; fromSmsApp: boolean }

export interface SmsReaderPlugin {
  status(): Promise<SmsStatus>;
  requestSms(): Promise<SmsStatus>;
  readInbox(o: { since: number; limit: number }): Promise<{ messages: InboxMessage[]; scanned: number }>;
  openNotificationSettings(): Promise<void>;
  queued(): Promise<{ alerts: QueuedAlert[] }>;
  ack(o: { ids: string[] }): Promise<void>;
  addListener(event: "alert", fn: () => void): Promise<PluginListenerHandle>;
}

/** Implemented in android/app/src/main/java/com/extrack/app/SmsReaderPlugin.java. Android only. */
export const smsReader = registerPlugin<SmsReaderPlugin>("SmsReader");

export const nativeSmsAvailable = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
