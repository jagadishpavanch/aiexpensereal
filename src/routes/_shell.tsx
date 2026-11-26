import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useHydrated } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { FloatingNav } from "@/components/app/floating-nav";
import { BarChart3, CalendarClock, CreditCard, Home, LayoutGrid, ListOrdered, Plus, Settings, Sparkles, Users, Wallet } from "lucide-react";
import { LockGate } from "@/components/app/lock-gate";
import { useFinance } from "@/lib/finance/store";
import { TxSheetProvider, useTxSheet } from "@/components/app/tx-sheet";
import { useAppSession } from "@/lib/sync/runtime";
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
  const session = useAppSession();
  const onboarded = useFinance((s) => s.prefs.onboarded);
  const navigate = useNavigate();
  const ready = session.auth === "signedIn" && session.sync === "ready";
  const leave = session.auth === "signedOut" || session.auth === "misconfigured" || (session.auth === "signedIn" && session.sync === "failed") || (ready && !onboarded);
  useEffect(() => {
    if (hydrated && leave) navigate({ to: "/", replace: true });
  }, [hydrated, leave, navigate]);

  if (!hydrated || !ready || !onboarded) return <ShellSkeleton />;
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
            // end at filter: none, any filter (even blur(0)) traps position: fixed children
            animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
            exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      <FloatingNav tabs={TABS} isActive={isActive} onAdd={() => open()} addOpen={isOpen} />
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
