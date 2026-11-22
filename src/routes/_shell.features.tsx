import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { CalendarClock, CreditCard, Fingerprint, Gift, Radar, Sparkles, Users, type LucideIcon } from "lucide-react";
import { actions, useFinance } from "@/lib/finance/store";
import type { Features } from "@/lib/finance/types";
import { PageTitle } from "@/components/app/bits";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/features")({
  head: () => ({
    meta: [
      { title: "Features — ExTrack" },
      { name: "description", content: "Turn ExTrack features on or off: AI, splits, cashback, bills, cards, app lock and auto-tracking." },
      { property: "og:title", content: "Features — ExTrack" },
      { property: "og:description", content: "Turn ExTrack features on or off: AI, splits, cashback, bills, cards, app lock and auto-tracking." },
    ],
  }),
  component: FeaturesPage,
});

const LIST: { k: keyof Features; label: string; sub: string; icon: LucideIcon }[] = [
  { k: "cards", label: "Cards & accounts", sub: "Bank, cards, UPI, wallets", icon: CreditCard },
  { k: "bills", label: "Bills & calendar", sub: "Reminders and tap-a-date", icon: CalendarClock },
  { k: "splits", label: "Splits", sub: "Share costs with people", icon: Users },
  { k: "cashback", label: "Cashback", sub: "Track UPI and card rewards", icon: Gift },
  { k: "lock", label: "App lock", sub: "Fingerprint or PIN", icon: Fingerprint },
  { k: "autoTracking", label: "Auto-tracking", sub: "Android app setup", icon: Radar },
];

function FeaturesPage() {
  const f = useFinance((s) => s.prefs.features);
  const ai = useFinance((s) => s.prefs.aiEnabled);
  const rows = [{ k: "ai" as const, label: "AI assistant", sub: "Lives in More", icon: Sparkles, on: ai }, ...LIST.map((l) => ({ ...l, on: f[l.k] }))];
  return (
    <div className="space-y-5">
      <PageTitle title="Features" sub="Switched-off features disappear everywhere" />
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((r, i) => (
          <motion.label key={r.k} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
            className={cn("flex cursor-pointer items-center gap-3 rounded-3xl bg-card p-4 shadow-soft transition-opacity", !r.on && "opacity-70")}>
            <motion.span animate={{ scale: r.on ? 1 : 0.9, rotate: r.on ? 0 : -8 }} className={cn("grid size-11 place-items-center rounded-2xl", r.on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}><r.icon className="size-5" /></motion.span>
            <span className="flex-1"><span className="block font-medium">{r.label}</span><span className="text-xs text-muted-foreground">{r.sub}</span></span>
            <Switch checked={r.on} aria-label={r.label}
              onCheckedChange={(v) => (r.k === "ai" ? actions.setPrefs({ aiEnabled: v }) : actions.setPrefs({ features: { ...f, [r.k]: v } }))} />
          </motion.label>
        ))}
      </div>
    </div>
  );
}
