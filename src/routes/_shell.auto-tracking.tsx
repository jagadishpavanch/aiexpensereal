import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, BellRing, CheckCircle2, MessageSquareText, Play, ShieldCheck, Smartphone } from "lucide-react";
import { actions } from "@/lib/finance/store";
import { isFinanceAlert, parseAlert, type ParsedAlert } from "@/lib/finance/sms-parse";
import { DEMO_SMS, DEMO_SMS_EXTRA } from "@/lib/finance/demo";
import { formatINR } from "@/lib/finance/format";
import { PageTitle, Panel } from "@/components/app/bits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  const [results, setResults] = useState<{ text: string; parsed: ParsedAlert | null; kept: boolean }[]>([]);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setResults([]);
    setRunning(true);
    for (const text of samples) {
      await new Promise((r) => setTimeout(r, 260));
      const kept = isFinanceAlert(text);
      setResults((r) => [...r, { text, kept, parsed: kept ? parseAlert(text) : null }]);
    }
    setRunning(false);
  };
  const addFound = () => {
    const found = results.filter((r) => r.parsed && r.parsed.kind !== "bill").map((r) => r.parsed!);
    actions.importTxs(found.map((p) => ({ type: p.kind === "income" ? "income" : "expense", amount: p.amount, merchant: p.merchant ?? "Bank alert", categoryId: actions.categorize(p.merchant ?? "") ?? (p.kind === "income" ? "salary" : "other"), accountId: p.isUpi ? "upi" : "hdfc", date: new Date().toISOString(), source: "sms_demo", isDemo: true })));
    toast.success(`Added ${found.length} sample transactions`);
  };

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

      <Panel className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Live detection demo</h2>
          <Button size="sm" className="rounded-full" onClick={run} disabled={running}><Play className="size-4" />{running ? "Reading…" : "Run demo"}</Button>
        </div>
        <p className="text-sm text-muted-foreground">Sample messages go through the same reader the Android app will use.</p>
        <div className="space-y-2">
          <AnimatePresence>
            {results.map((r, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -16, height: 0 }} animate={{ opacity: 1, x: 0, height: "auto" }} className={cn("rounded-2xl border p-3 text-sm", !r.kept && "opacity-50")}>
                <p className="line-clamp-2 text-xs text-muted-foreground">{r.text}</p>
                {r.parsed ? (
                  <p className="mt-1.5 flex flex-wrap items-center gap-2 font-medium">
                    <CheckCircle2 className="size-4 text-income" />
                    <span className={cn("rounded-full px-2 py-0.5 text-xs", r.parsed.kind === "income" ? "bg-income/15 text-income" : r.parsed.kind === "bill" ? "bg-marigold-soft" : "bg-expense/15 text-expense")}>{r.parsed.kind === "bill" ? "Due bill" : r.parsed.kind}</span>
                    {formatINR(r.parsed.amount)}{r.parsed.merchant ? ` · ${r.parsed.merchant}` : ""}{r.parsed.last4 ? ` · ··${r.parsed.last4}` : ""}{r.parsed.isUpi ? " · UPI" : ""}
                    {r.parsed.dueDate && ` · due ${new Date(r.parsed.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                  </p>
                ) : <p className="mt-1 text-xs">Ignored — not a money alert</p>}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        {!running && results.some((r) => r.parsed && r.parsed.kind !== "bill") && <Button variant="secondary" className="h-11 w-full rounded-2xl" onClick={addFound}>Add detected transactions as samples</Button>}
      </Panel>
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
