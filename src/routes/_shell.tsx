import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useHydrated } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { BarChart3, CalendarClock, CreditCard, Home, LayoutGrid, ListOrdered, Plus, Settings, Sparkles, Users, Wallet } from "lucide-react";
import { LockGate } from "@/components/app/lock-gate";
import { useFinance } from "@/lib/finance/store";
import { TxSheetProvider, useTxSheet } from "@/components/app/tx-sheet";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell")({
  component: Shell,
});

const TABS = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/activity", label: "Activity", icon: ListOrdered },
  { to: "/insights", label: "Insights", icon: BarChart3 },
  { to: "/budgets", label: "Budgets", icon: Wallet },
  { to: "/more", label: "More", icon: LayoutGrid },
] as const;
const MORE_PATHS = ["/more", "/ai", "/settings", "/accounts", "/bills", "/splits", "/cashback", "/features", "/lock", "/auto-tracking", "/customize"];

function Shell() {
  const hydrated = useHydrated();
  const onboarded = useFinance((s) => s.prefs.onboarded);
  const navigate = useNavigate();
  useEffect(() => {
    if (hydrated && !onboarded) navigate({ to: "/" });
  }, [hydrated, onboarded, navigate]);

  if (!hydrated) return <ShellSkeleton />;
  return (
    <LockGate>
      <TxSheetProvider>
        <Frame />
      </TxSheetProvider>
    </LockGate>
  );
}

function Frame() {
  const loc = useLocation();
  const ai = useFinance((s) => s.prefs.aiEnabled);
  const f = useFinance((s) => s.prefs.features);
  const side = [
    ...TABS.slice(0, 4),
    ...(f.cards ? [{ to: "/accounts", label: "Cards & accounts", icon: CreditCard }] : []),
    ...(f.bills ? [{ to: "/bills", label: "Bills", icon: CalendarClock }] : []),
    ...(f.splits ? [{ to: "/splits", label: "Splits", icon: Users }] : []),
    ...(ai ? [{ to: "/ai", label: "AI", icon: Sparkles }] : []),
  ] as { to: string; label: string; icon: typeof Home }[];
  const { open, isOpen } = useTxSheet();
  const isActive = (to: string) => (to === "/more" ? MORE_PATHS.some((p) => loc.pathname.startsWith(p)) : loc.pathname.startsWith(to));
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => { const y = window.scrollY; if (Math.abs(y - last) > 6) { setCompact(y > last && y > 80); last = y; } };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[17rem_1fr]">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-1 border-r bg-surface p-5 md:flex">
        <Link to="/home" className="mb-6 flex items-center gap-2 px-2">
          <Logo />
          <span className="font-display text-xl font-bold">ExTrack</span>
        </Link>
        {side.map((n) => {
          const active = loc.pathname.startsWith(n.to);
          return (
            <Link key={n.to} to={n.to as "/home"} className={cn("relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors", active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {active && <motion.span layoutId="side-pill" className="absolute inset-0 -z-0 rounded-2xl bg-primary" transition={{ type: "spring", stiffness: 450, damping: 35 }} />}
              <n.icon className="relative size-5" />
              <span className="relative">{n.label}</span>
            </Link>
          );
        })}
        <Link to="/settings" className={cn("flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium", loc.pathname.startsWith("/settings") ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>
          <Settings className="size-5" /> Settings
        </Link>
        <button onClick={() => open()} className="mt-auto flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary font-medium text-primary-foreground shadow-fab transition-transform active:scale-95">
          <Plus className="size-5" /> Add transaction
        </button>
      </aside>

      <main className="relative mx-auto w-full max-w-5xl px-4 pb-32 pt-3 md:px-8 md:pb-12 md:pt-8">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={loc.pathname}
            initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* mobile floating add button: bottom-right, above the tab bar */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button key="fab" onClick={() => open()} aria-label="Add transaction"
            initial={{ scale: 0, opacity: 0 }} animate={{ scale: compact ? 0.82 : 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
            whileTap={{ scale: 0.88, rotate: 90 }} transition={{ type: "spring", stiffness: 420, damping: 26 }}
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)" }}
            className="fixed right-4 z-40 grid size-14 place-items-center rounded-full bg-peacock text-primary-foreground shadow-fab ring-4 ring-background/70 md:hidden">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/25 [animation-duration:2.6s]" aria-hidden />
            <Plus className="relative size-6" strokeWidth={2.6} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* mobile bottom bar: 5 equal tabs */}
      <nav aria-label="Main" className="fixed inset-x-3 z-40 md:hidden" style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}>
        <div className="grid grid-cols-5 rounded-[1.75rem] border bg-card/90 p-1.5 shadow-lift backdrop-blur-xl">
          {TABS.map((n) => {
            const active = isActive(n.to);
            return (
              <Link key={n.to} to={n.to} aria-label={n.label} aria-current={active ? "page" : undefined} className="relative flex flex-col items-center gap-0.5 rounded-2xl py-2 text-[11px] font-medium">
                {active && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-2xl bg-accent" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                <motion.span animate={{ y: active ? -1 : 0, scale: active ? 1.1 : 1 }} className={cn("relative", active ? "text-primary" : "text-muted-foreground")}>
                  <n.icon className="size-5" strokeWidth={active ? 2.4 : 2} />
                </motion.span>
                <span className={cn("relative", active ? "text-foreground" : "text-muted-foreground")}>{n.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-9 place-items-center rounded-xl bg-peacock text-primary-foreground shadow-fab", className)}>
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M7 5h10M7 9h10M7 5c5 0 5 8 0 8l8 6" /></svg>
    </span>
  );
}

function ShellSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-8" aria-busy>
      <div className="h-10 w-40 rounded-xl shimmer" />
      <div className="h-52 rounded-3xl shimmer" />
      <div className="grid grid-cols-2 gap-4"><div className="h-36 rounded-3xl shimmer" /><div className="h-36 rounded-3xl shimmer" /></div>
      <div className="h-64 rounded-3xl shimmer" />
    </div>
  );
}
