import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, BellRing, MessageSquareText, ShieldCheck, Smartphone } from "lucide-react";
import { DEMO_SMS, DEMO_SMS_EXTRA } from "@/lib/finance/demo";
import { PageTitle, Panel } from "@/components/app/bits";
import { SmsScanner } from "@/components/app/sms-scanner";

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
  const samples = [...DEMO_SMS, ...DEMO_SMS_EXTRA, ...NOISE].map(String);

  return (
    <div className="space-y-5">
      <PageTitle title="Auto-tracking" sub="Coming in the Android app" right={<span className="rounded-full bg-marigold-soft px-3 py-1 text-xs font-medium">Available in the Android app</span>} />

      <Panel className="relative overflow-hidden bg-peacock text-primary-foreground">
        <div className="absolute inset-0 bg-feather opacity-60" aria-hidden />
        <Smartphone className="relative mb-2 size-8" />
        <p className="relative font-display text-xl font-semibold">The upcoming Android app will read only bank and UPI alerts, on your phone, after you allow it.</p>
        <p className="relative mt-2 text-sm opacity-90">A website can't read SMS or notifications, so this page shows how it will work.</p>
      </Panel>

      <div className="grid gap-3 md:grid-cols-2">
        <Step n={1} icon={MessageSquareText} title="Import past bank SMS once" text="On first launch, ExTrack scans your existing messages one time and picks out bank, card and UPI transactions and due bills." />
        <Step n={2} icon={BellRing} title="Turn on notification access" text="From then on, new alerts from your bank and UPI apps are tracked automatically, even in the background." />
      </div>

      <Panel className="space-y-3 border border-marigold/50">
        <p className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4 text-marigold" />What Android will show you on the next screen</p>
        <blockquote className="rounded-2xl bg-muted p-4 text-sm leading-relaxed">
          ExTrack will be able to read all notifications, including personal information such as contact names and the text of messages you receive. This app will also be able to dismiss notifications or take action on buttons in notifications.
          <span className="mt-2 block text-muted-foreground">It can read notifications from other apps (even when in background), which may include personal and sensitive data such as contacts, phone number, email address, inventory of installed apps, text of the messages & emails you receive etc.</span>
        </blockquote>
        <p className="flex items-start gap-2 text-sm"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-income" />What ExTrack keeps: only transaction and due-bill alerts. Everything is read on your phone. OTPs, chats and offers are ignored and never saved or sent anywhere.</p>
      </Panel>

      <SmsScanner samples={samples} />
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
