import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, BellRing, MessageSquareText, ShieldCheck, Smartphone } from "lucide-react";
import { actions, useFinance } from "@/lib/finance/store";
import { DEMO_SMS, DEMO_SMS_EXTRA } from "@/lib/finance/demo";
import { PageTitle, Panel } from "@/components/app/bits";
import { SmsScanner } from "@/components/app/sms-scanner";
import { Button } from "@/components/ui/button";
import { nativeSmsAvailable, smsReader, type SmsStatus } from "@/lib/sms/native";
import { commitImport, planSamples, scanInbox, SmsPermissionError } from "@/lib/sms/runtime";

export const Route = createFileRoute("/_shell/auto-tracking")({
  head: () => ({
    meta: [
      { title: "Auto-tracking — ExTrack" },
      { name: "description", content: "How the ExTrack Android app will read only bank and UPI alerts on your phone, after you allow it." },
      { property: "og:title", content: "Auto-tracking — ExTrack" },
      { property: "og:description", content: "How the ExTrack Android app will read only bank and UPI alerts on your phone, after you allow it." },
    ],
  }),
  component: AutoTracking,
});

const NOISE = ["Your OTP for login is 482910. Do not share it.", "Mom: Dinner at 8? Bring curd.", "Flat 50% off on shoes! Shop now."];

function AutoTracking() {
  return nativeSmsAvailable() ? <PhoneSetup /> : <WebDemo />;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const addedLabel = ({ txs, bills }: { txs: number; bills: number }) => `Add ${plural(txs, "transaction")}${bills ? ` and ${plural(bills, "bill")}` : ""}`;

function PhoneSetup() {
  const demo = useFinance((s) => s.prefs.demoMode);
  const [status, setStatus] = useState<SmsStatus | null>(null);
  const refresh = useCallback(() => void smsReader.status().then(setStatus, () => setStatus(null)), []);
  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);
  const load = async () => {
    try {
      return await scanInbox();
    } catch (e) {
      if (e instanceof SmsPermissionError) throw new Error("ExTrack needs SMS access to import. If Android doesn't ask, open App info → ⋮ → Allow restricted settings, then try again.");
      throw e;
    } finally {
      refresh();
    }
  };
  return (
    <div className="space-y-5">
      <PageTitle title="Auto-tracking" sub="Bank SMS and alerts, read on this phone" />
      {demo && <p className="rounded-2xl bg-marigold-soft p-3 text-sm">You're looking at sample data. Imported transactions are added next to it.</p>}
      <SmsScanner
        title="Import past bank SMS"
        note="Reads the last 6 months of messages on this phone. Only bank, card and UPI alerts are kept, and nothing is added until you confirm."
        runLabel="Scan messages"
        load={load}
        onConfirm={(items) => {
          const r = commitImport(items);
          toast.success(`Added ${plural(r.txs, "transaction")}${r.bills ? ` and ${plural(r.bills, "bill")}` : ""}`);
        }}
        confirmLabel={addedLabel}
      />
      <Panel className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-semibold"><BellRing className="size-4 text-primary" />Live tracking</h2>
            <p className="text-sm text-muted-foreground">{status?.notifications ? "On. New bank and UPI alerts are added as they arrive." : "Off. Allow notification access so new alerts are added on their own."}</p>
          </div>
          <Button size="sm" variant={status?.notifications ? "secondary" : "default"} className="shrink-0 rounded-full" onClick={() => void smsReader.openNotificationSettings()}>{status?.notifications ? "Settings" : "Turn on"}</Button>
        </div>
        {!status?.notifications && <p className="text-xs text-muted-foreground">If ExTrack is greyed out in that list, open App info → ⋮ → Allow restricted settings first. Android asks this for apps installed outside the Play Store.</p>}
        <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-income" />Only transaction and due-bill alerts are kept. OTPs, chats and offers are ignored, and message text never leaves your phone.</p>
      </Panel>
    </div>
  );
}

function WebDemo() {
  const samples = [...DEMO_SMS, ...DEMO_SMS_EXTRA, ...NOISE].map(String);
  return (
    <div className="space-y-5">
      <PageTitle title="Auto-tracking" sub="Coming in the Android app" right={<span className="rounded-full bg-marigold-soft px-3 py-1 text-xs font-medium">Available in the Android app</span>} />
      <Panel className="relative overflow-hidden bg-peacock text-primary-foreground">
        <div className="absolute inset-0 bg-feather opacity-60" aria-hidden />
        <Smartphone className="relative mb-2 size-8" />
        <p className="relative font-display text-xl font-semibold">The Android app reads only bank and UPI alerts, on your phone, after you allow it.</p>
        <p className="relative mt-2 text-sm opacity-90">A website can't read SMS or notifications, so this page shows how it works.</p>
      </Panel>
      <div className="grid gap-3 md:grid-cols-2">
        <Step n={1} icon={MessageSquareText} title="Import past bank SMS once" text="ExTrack scans your messages one time and picks out bank, card and UPI transactions and due bills." />
        <Step n={2} icon={BellRing} title="Turn on notification access" text="From then on, new alerts from your bank and UPI apps are added automatically." />
      </div>
      <Panel className="space-y-3 border border-marigold/50">
        <p className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4 text-marigold" />What Android will show you on the next screen</p>
        <blockquote className="rounded-2xl bg-muted p-4 text-sm leading-relaxed">
          ExTrack will be able to read all notifications, including personal information such as contact names and the text of messages you receive. This app will also be able to dismiss notifications or take action on buttons in notifications.
        </blockquote>
        <p className="flex items-start gap-2 text-sm"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-income" />What ExTrack keeps: only transaction and due-bill alerts. Everything is read on your phone. OTPs, chats and offers are ignored and never saved or sent anywhere.</p>
      </Panel>
      <SmsScanner
        title="Live detection demo"
        note="Sample messages go through the same reader and categoriser the Android app uses."
        runLabel="Run demo"
        load={async () => planSamples(samples)}
        onConfirm={(items) => {
          const txs = items.flatMap((i) => (i.outcome.kind === "tx" ? [i.outcome.tx] : []));
          actions.importTxs(txs);
          toast.success(`Added ${plural(txs.length, "sample transaction")}`);
        }}
        confirmLabel={({ txs }) => `Add ${plural(txs, "sample transaction")}`}
      />
    </div>
  );
}

function Step({ n, icon: Icon, title, text }: { n: number; icon: typeof Smartphone; title: string; text: string }) {
  return (
    <Panel className="flex gap-3">
      <span className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-primary"><Icon className="size-5" /><span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{n}</span></span>
      <div><p className="font-medium">{title}</p><p className="text-sm text-muted-foreground">{text}</p></div>
    </Panel>
  );
}
