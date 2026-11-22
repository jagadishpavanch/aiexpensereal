import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { CalendarClock, CreditCard, Fingerprint, Gift, LayoutGrid, Radar, Settings, Sparkles, ToggleRight, Users } from "lucide-react";
import { useFinance } from "@/lib/finance/store";
import { PageTitle } from "@/components/app/bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/more")({
  head: () => ({
    meta: [
      { title: "More — ExTrack" },
      { name: "description", content: "AI assistant, cards, bills, splits, cashback, app lock, auto-tracking and settings." },
      { property: "og:title", content: "More — ExTrack" },
      { property: "og:description", content: "AI assistant, cards, bills, splits, cashback, app lock, auto-tracking and settings." },
    ],
  }),
  component: More,
});

function More() {
  const ai = useFinance((s) => s.prefs.aiEnabled);
  const f = useFinance((s) => s.prefs.features);
  const tiles = [
    ...(ai ? [{ to: "/ai" as const, label: "AI assistant", icon: Sparkles, hero: true }] : []),
    ...(f.cards ? [{ to: "/accounts" as const, label: "Cards & accounts", icon: CreditCard }] : []),
    ...(f.bills ? [{ to: "/bills" as const, label: "Bills & calendar", icon: CalendarClock }] : []),
    ...(f.splits ? [{ to: "/splits" as const, label: "Splits", icon: Users }] : []),
    ...(f.cashback ? [{ to: "/cashback" as const, label: "Cashback", icon: Gift }] : []),
    ...(f.lock ? [{ to: "/lock" as const, label: "App lock", icon: Fingerprint }] : []),
    ...(f.autoTracking ? [{ to: "/auto-tracking" as const, label: "Auto-tracking", icon: Radar }] : []),
    { to: "/features" as const, label: "Features", icon: ToggleRight },
    { to: "/customize" as const, label: "Customize home", icon: LayoutGrid },
    { to: "/settings" as const, label: "Settings", icon: Settings },
  ];
  return (
    <div className="space-y-5">
      <PageTitle title="More" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((t, i) => (
          <motion.div key={t.to} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className={cn("hero" in t && "col-span-2 sm:col-span-3")}>
            <Link to={t.to} className={cn("flex h-28 flex-col justify-between rounded-3xl p-4 shadow-soft active:scale-95", "hero" in t ? "bg-peacock text-primary-foreground" : "bg-card")}>
              <t.icon className={cn("size-6", "hero" in t ? "" : "text-primary")} />
              <span className="font-medium">{t.label}</span>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
