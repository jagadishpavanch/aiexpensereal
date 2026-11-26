import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useTransform, type MotionValue } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { ArrowDownLeft, ArrowUpRight, Bell, Eye, EyeOff, LayoutGrid, Repeat, Search, Settings } from "lucide-react";
import { actions, useFinance } from "@/lib/finance/store";
import { cashbackTotals } from "@/lib/finance/cashback";
import { dueSoon, daysUntil } from "@/lib/finance/bills";
import { splitSummary } from "@/lib/finance/splits";
import { budgetStatus, byCategory, dailySeries, inMonth, topMerchants, totals } from "@/lib/finance/calc";
import { compactINR, formatINR, greeting } from "@/lib/finance/format";
import type { WidgetId } from "@/lib/finance/types";
import { Amount, Bar, ChartTip, DemoBadge, Empty, Panel, RollingAmount, Section, Ticker } from "@/components/app/bits";
import { SpendRing } from "@/components/app/spend-ring";
import { TxRow } from "@/components/app/tx-row";
import { useFreshIds } from "@/components/app/use-fresh-ids";
import { useTxSheet } from "@/components/app/tx-sheet";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/home")({
  head: () => ({
    meta: [
      { title: "Home — ExTrack" },
      { name: "description", content: "Your month at a glance: balance, spending, budgets and goals." },
      { property: "og:title", content: "Home — ExTrack" },
      { property: "og:description", content: "Your month at a glance: balance, spending, budgets and goals." },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const txs = useFinance((s) => s.transactions);
  const cats = useFinance((s) => s.categories);
  const bills = useFinance((s) => s.bills);
  const splits = useFinance((s) => s.splits);
  const budgets = useFinance((s) => s.budgets);
  const goals = useFinance((s) => s.goals);
  const prefs = useFinance((s) => s.prefs);
  const { open } = useTxSheet();
  const fresh = useFreshIds(txs);

  const now = useMemo(() => new Date(), []);
  const month = useMemo(() => txs.filter((t) => inMonth(t.date, now)), [txs, now]);
  const lastMonth = useMemo(() => txs.filter((t) => inMonth(t.date, new Date(now.getFullYear(), now.getMonth() - 1, 1))), [txs, now]);
  const t = totals(month);
  const tPrev = totals(lastMonth);
  const cat = byCategory(month);
  const alerts = budgets.map((b) => budgetStatus(b, month)).filter((s) => s.state !== "ok").length;
  const catOf = (id: string) => cats.find((c) => c.id === id);
  const series = dailySeries(txs, 30, now);
  const monthName = now.toLocaleDateString("en-IN", { month: "long" });
  // 0 while the balance card is in view, 1 once it has scrolled under the dock.
  const collapse = useMotionValue(0);

  const cb = cashbackTotals(txs, now);
  const soon = dueSoon(bills, now);
  const sp = splitSummary(splits);
  const widgets: Record<WidgetId, React.ReactNode> = {
    bills: (
      <Panel>
        <h2 className="mb-3 font-display text-lg font-semibold">Due soon</h2>
        {soon.length === 0 ? <Empty text="No bills due this week." /> : (
          <ul className="space-y-3">{soon.slice(0, 4).map((b) => { const d = daysUntil(b, now); return (
            <li key={b.id} className="flex items-center gap-3 text-sm">
              <span className="flex-1"><span className="font-medium">{b.name}</span><span className={cn("block text-xs", d < 0 ? "text-expense" : "text-muted-foreground")}>{d < 0 ? `Overdue by ${-d} day${d === -1 ? "" : "s"}` : d === 0 ? "Due today" : `Due in ${d} day${d === 1 ? "" : "s"}`}</span></span>
              <Amount value={b.amount} />
              <button onClick={() => actions.payBill(b.id)} className="rounded-full bg-accent px-3 py-1 text-xs font-medium">Mark paid</button>
            </li>); })}</ul>
        )}
      </Panel>
    ),
    cashback: (
      <Panel className="h-full">
        <h2 className="mb-2 font-display text-lg font-semibold">Cashback</h2>
        <Ticker value={cb.month} className="font-display text-3xl font-bold text-income" />
        <p className="text-xs text-muted-foreground">this month · {formatINR(cb.year, { hidden: prefs.hideAmounts })} in the last year</p>
        <ul className="mt-3 space-y-1 text-sm">{cb.bySource.slice(0, 3).map((x) => <li key={x.source} className="flex justify-between"><span>{x.source}</span><Amount value={x.amount} /></li>)}</ul>
      </Panel>
    ),
    splits: (
      <Panel className="h-full">
        <h2 className="mb-3 font-display text-lg font-semibold">Splits</h2>
        <p className="text-xs text-muted-foreground">Others owe you</p>
        <Ticker value={sp.owedToMe} className="font-display text-2xl font-bold text-income" />
        <p className="mt-2 text-xs text-muted-foreground">You owe</p>
        <Ticker value={sp.iOwe} className="font-display text-2xl font-bold" />
      </Panel>
    ),
    balance: (
      <BalanceCard progress={collapse} net={t.net} income={t.income} spent={t.spent} prevSpent={tPrev.spent} monthName={monthName} hidden={prefs.hideAmounts} />
    ),
    ring: (
      <Panel>
        <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-lg font-semibold">Where it went</h2><Link to="/insights" className="text-sm font-medium text-primary">Details</Link></div>
        {cat.length ? <SpendRing data={cat} categories={cats} total={t.spent} /> : <Empty text="No spending yet this month." />}
      </Panel>
    ),
    budgets: (
      <Panel className="h-full">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-lg font-semibold">Budgets</h2><Link to="/budgets" className="text-sm font-medium text-primary">All</Link></div>
        {budgets.length === 0 ? <Empty text="Set a budget to see progress here." /> : (
          <ul className="space-y-4">
            {budgets.slice(0, 4).map((b) => {
              const s = budgetStatus(b, month);
              return (
                <li key={b.id}>
                  <div className="mb-1.5 flex justify-between text-sm"><span className="font-medium">{catOf(b.categoryId)?.name}</span><span className={cn("tnum", s.state === "over" ? "text-expense" : "text-muted-foreground")}>{prefs.hideAmounts ? "••" : `${compactINR(s.spent)} / ${compactINR(b.limit)}`}</span></div>
                  <Bar pct={s.pct} state={s.state} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    ),
    goals: (
      <Panel className="h-full">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-lg font-semibold">Goals</h2><Link to="/budgets" className="text-sm font-medium text-primary">All</Link></div>
        {goals.length === 0 ? <Empty text="Save towards something you want." /> : (
          <ul className="space-y-4">
            {goals.slice(0, 3).map((g) => (
              <li key={g.id} className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-2xl bg-marigold-soft text-lg" aria-hidden>{g.emoji}</span>
                <div className="flex-1">
                  <div className="mb-1.5 flex justify-between text-sm"><span className="font-medium">{g.name}</span><span className="tnum text-muted-foreground">{Math.round((g.saved / g.target) * 100)}%</span></div>
                  <Bar pct={g.saved / g.target} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    ),
    trend: (
      <Panel>
        <div className="mb-2 flex items-center justify-between"><h2 className="font-display text-lg font-semibold">Last 30 days</h2><span className="text-sm text-muted-foreground">Daily spending</span></div>
        <div className="h-40">
          <ResponsiveContainer>
            <AreaChart data={series} margin={{ left: 0, right: 0, top: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="g-spend" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" hide />
              <Tooltip content={<ChartTip />} cursor={{ stroke: "var(--color-border)" }} />
              <Area type="monotone" dataKey="spent" stroke="var(--color-primary)" strokeWidth={2.5} fill="url(#g-spend)" animationDuration={1200} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    ),
    recent: (
      <Section title="Recent" action={<Link to="/activity" className="text-sm font-medium text-primary">See all</Link>}>
        <Panel className="p-2">
          {txs.length === 0 ? <Empty text="Add your first transaction with the + button." /> : (
            <ul>
              <AnimatePresence initial={false}>
                {txs.slice(0, 6).map((tx) => <TxRow key={tx.id} tx={tx} category={catOf(tx.categoryId)} onOpen={() => open(tx)} fresh={fresh.has(tx.id)} />)}
              </AnimatePresence>
            </ul>
          )}
        </Panel>
      </Section>
    ),
    merchants: (
      <Panel className="h-full">
        <h2 className="mb-4 font-display text-lg font-semibold">Top merchants</h2>
        <ul className="space-y-3">
          {topMerchants(month, 4).map((m) => (
            <li key={m.merchant} className="flex items-center justify-between text-sm"><span>{m.merchant} <span className="text-muted-foreground">×{m.count}</span></span><Amount value={m.amount} /></li>
          ))}
        </ul>
      </Panel>
    ),
    recurring: (
      <Panel className="h-full">
        <h2 className="mb-4 font-display text-lg font-semibold">Recurring</h2>
        <ul className="space-y-3">
          {Array.from(new Map(txs.filter((x) => x.recurring && x.type === "expense").map((x) => [x.merchant, x])).values()).slice(0, 4).map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm"><Repeat className="size-4 text-muted-foreground" /><span className="flex-1">{r.merchant}</span><Amount value={r.amount} /></li>
          ))}
        </ul>
      </Panel>
    ),
  };

  const off: Partial<Record<WidgetId, boolean>> = { bills: !prefs.features.bills, cashback: !prefs.features.cashback, splits: !prefs.features.splits };
  const visible = prefs.widgets.filter((w) => w.visible && !off[w.id]);

  return (
    <>
    {visible.some((w) => w.id === "balance") && <BalanceDock progress={collapse} net={t.net} monthName={monthName} />}
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-2">
        <div>
          <p className="whitespace-nowrap text-sm text-muted-foreground">{greeting(now)}</p>
          <h1 className="font-display text-2xl font-bold">{prefs.name || "there"}</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <DemoBadge />
          <IconBtn label="Search" to="/activity"><Search className="size-5" /></IconBtn>
          <button aria-label={prefs.hideAmounts ? "Show amounts" : "Hide amounts"} onClick={() => actions.setPrefs({ hideAmounts: !prefs.hideAmounts })} className="grid size-10 place-items-center rounded-full bg-card shadow-soft">
            {prefs.hideAmounts ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
          <IconBtn label={`${alerts} budget alerts`} to="/budgets">
            <Bell className="size-5" />
            {alerts > 0 && <span className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-marigold ring-2 ring-card" />}
          </IconBtn>
          <IconBtn label="Settings" to="/settings" className="md:hidden"><Settings className="size-5" /></IconBtn>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4">
        {visible.map((w, i) => (
          <motion.div key={w.id}
            initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.07, type: "spring", stiffness: 220, damping: 24 }}
            className={cn(w.size === "full" ? "col-span-2" : "col-span-2 md:col-span-1")}>
            {widgets[w.id]}
          </motion.div>
        ))}
      </div>

      <Link to="/customize" className="mx-auto flex w-fit items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium shadow-soft">
        <LayoutGrid className="size-4" /> Customize home
      </Link>
    </div>
    </>
  );
}

function BalanceCard({ progress, net, income, spent, prevSpent, monthName, hidden }: {
  progress: MotionValue<number>; net: number; income: number; spent: number; prevSpent: number; monthName: string; hidden: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  // 76px is roughly the docked header's height: the card counts as gone once it is under the dock.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 76px", "end 76px"] });
  useEffect(() => scrollYProgress.on("change", (v) => progress.set(v)), [scrollYProgress, progress]);
  // The card recedes (shrinks toward its top edge and fades) as it slides under the dock.
  const scale = useTransform(scrollYProgress, [0, 1], [1, 0.92]);
  const opacity = useTransform(scrollYProgress, [0, 0.9], [1, 0.2]);
  return (
    <motion.div ref={ref} style={reduce ? undefined : { scale, opacity, transformOrigin: "50% 0%" }}
      className="relative overflow-hidden rounded-[2rem] bg-peacock p-6 text-primary-foreground shadow-lift">
      <div className="pointer-events-none absolute inset-0 bg-feather" />
      <svg className="pointer-events-none absolute -right-10 -top-10 size-64 opacity-25" viewBox="0 0 200 200" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <motion.ellipse key={i} cx="140" cy="60" rx={30 + i * 18} ry={18 + i * 12} fill="none" stroke="currentColor" strokeWidth="1"
            initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, delay: i * 0.12 }} />
        ))}
      </svg>
      <div className="relative">
        <p className="text-sm opacity-80">Left to spend in {monthName}</p>
        <RollingAmount id="home-net" value={net} className="mt-1 block font-display text-5xl font-bold sm:text-6xl" />
        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-primary-foreground/12 p-3 backdrop-blur">
            <p className="flex items-center gap-1 text-xs opacity-80"><ArrowDownLeft className="size-3.5" /> Money in</p>
            <RollingAmount id="home-in" value={income} className="block font-display text-xl font-semibold" />
          </div>
          <div className="rounded-2xl bg-primary-foreground/12 p-3 backdrop-blur">
            <p className="flex items-center gap-1 text-xs opacity-80"><ArrowUpRight className="size-3.5" /> Money out</p>
            <RollingAmount id="home-out" value={spent} className="block font-display text-xl font-semibold" />
          </div>
        </div>
        {prevSpent > 0 && (
          <p className="mt-4 text-sm opacity-85">
            {spent <= prevSpent ? "↓" : "↑"} {formatINR(Math.abs(spent - prevSpent), { hidden })} {spent <= prevSpent ? "less" : "more"} than all of last month
          </p>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Slim peacock bar that docks at the top of Home once the balance card has
 * scrolled away, so "left to spend" stays in sight. It is a zero-height sticky
 * strip, so it never pushes content. Tap it to go back to the top.
 */
function BalanceDock({ progress, net, monthName }: { progress: MotionValue<number>; net: number; monthName: string }) {
  const reduce = useReducedMotion();
  const [docked, setDocked] = useState(false);
  useMotionValueEvent(progress, "change", (v) => setDocked(v > 0.85));
  const opacity = useTransform(progress, [0.7, 0.95], [0, 1]);
  const y = useTransform(progress, [0.7, 0.95], [-12, 0]);
  const scale = useTransform(progress, [0.7, 0.95], [0.96, 1]);
  return (
    <div className="sticky top-0 z-30 -mx-4 h-0 md:-mx-8">
      <motion.div
        style={reduce ? { opacity: docked ? 1 : 0 } : { opacity, y, scale }}
        className={cn("px-4 pt-[max(env(safe-area-inset-top),0.5rem)] md:px-8", !docked && "pointer-events-none")}
        aria-hidden={!docked}
      >
        <button
          tabIndex={docked ? 0 : -1}
          onClick={() => window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" })}
          aria-label="Back to top"
          className="relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-2xl bg-peacock px-4 py-2.5 text-left text-primary-foreground shadow-lift"
        >
          <span className="pointer-events-none absolute inset-0 bg-feather" />
          <span className="relative text-xs opacity-85">Left to spend · {monthName}</span>
          <RollingAmount id="home-net" value={net} className="relative font-display text-lg font-bold" />
        </button>
      </motion.div>
    </div>
  );
}

function IconBtn({ to, label, children, className }: { to: "/activity" | "/budgets" | "/settings"; label: string; children: React.ReactNode; className?: string }) {
  return <Link to={to} aria-label={label} className={cn("relative grid size-10 place-items-center rounded-full bg-card shadow-soft", className)}>{children}</Link>;
}

