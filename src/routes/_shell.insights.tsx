import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { TrendingDown, TrendingUp, Repeat } from "lucide-react";
import { useFinance } from "@/lib/finance/store";
import { anomalies, budgetStatus, byCategory, dailySeries, heatmap, inMonth, monthlySeries, topMerchants, totals } from "@/lib/finance/calc";
import { compactINR } from "@/lib/finance/format";
import { Amount, CategoryIcon, ChartTip, DemoBadge, Empty, PageTitle, Panel, RollingAmount } from "@/components/app/bits";
import { RangeChart } from "@/components/app/range-chart";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/insights")({
  head: () => ({
    meta: [
      { title: "Insights — ExTrack" },
      { name: "description", content: "Charts for categories, trends, cash flow, merchants and unusual spending." },
      { property: "og:title", content: "Insights — ExTrack" },
      { property: "og:description", content: "Charts for categories, trends, cash flow, merchants and unusual spending." },
    ],
  }),
  component: Insights,
});

const axis = { stroke: "var(--color-muted-foreground)", fontSize: 11, tickLine: false, axisLine: false } as const;

function Insights() {
  const txs = useFinance((s) => s.transactions);
  const cats = useFinance((s) => s.categories);
  const budgets = useFinance((s) => s.budgets);
  const goals = useFinance((s) => s.goals);
  const hidden = useFinance((s) => s.prefs.hideAmounts);
  const [offset, setOffset] = useState(0);
  const [trendDays, setTrendDays] = useState(30);
  const [activeCat, setActiveCat] = useState<number | null>(null);
  // Recharts animates in JS, outside MotionConfig, so reduced motion is applied by hand.
  const reduce = useReducedMotion();
  const animated = !reduce;

  const now = useMemo(() => new Date(), []);
  const ref = useMemo(() => new Date(now.getFullYear(), now.getMonth() - offset, offset === 0 ? now.getDate() : 28), [now, offset]);
  const month = useMemo(() => txs.filter((t) => inMonth(t.date, ref)), [txs, ref]);
  const cat = byCategory(month).map((c) => ({ ...c, cat: cats.find((x) => x.id === c.categoryId) }));
  const monthSpent = totals(month).spent;
  const monthly = monthlySeries(txs, 6, now);
  const daily = dailySeries(txs, trendDays, now);
  const bva = budgets.map((b) => ({ name: cats.find((c) => c.id === b.categoryId)?.name.split(" ")[0] ?? "", budget: b.limit, spent: budgetStatus(b, month).spent }));
  const heat = heatmap(txs, now);
  const maxHeat = Math.max(1, ...heat.cells.map((c) => c.spent));
  const merchants = topMerchants(month, 6);
  const anom = anomalies(txs, now);
  let running = 0;
  const cash = dailySeries(txs, now.getDate(), now).map((d) => ({ label: d.label, balance: (running += d.income - d.spent) }));
  const recurring = Array.from(new Map(txs.filter((t) => t.recurring).map((t) => [t.merchant, t])).values());

  return (
    <div className="space-y-5">
      <PageTitle title="Insights" sub="See patterns, not just numbers" right={<DemoBadge />} />

      <div className="flex items-center gap-2">
        {[0, 1, 2].map((o) => {
          const d = new Date(now.getFullYear(), now.getMonth() - o, 1);
          return (
            <button key={o} onClick={() => setOffset(o)} aria-pressed={offset === o}
              className={cn("relative rounded-full px-4 py-2 text-sm font-medium", offset === o ? "text-primary-foreground" : "bg-card text-muted-foreground shadow-soft")}>
              {offset === o && <motion.span layoutId="month-pill" className="absolute inset-0 rounded-full bg-primary" />}
              <span className="relative">{d.toLocaleDateString("en-IN", { month: "short", year: o === 0 ? undefined : "2-digit" })}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <RangeChart className="md:col-span-2" />

        <Card title="Spending by category" className="md:col-span-2" right={<RollingAmount id="insights-month-spent" value={monthSpent} className="font-display text-lg font-semibold" />}>
          {cat.length === 0 ? <Empty text="No spending in this month." /> : (
            <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[14rem_1fr]">
              <div className="h-56">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={cat} dataKey="amount" nameKey="cat.name" innerRadius="58%" outerRadius="92%" paddingAngle={2} cornerRadius={6}
                      onMouseEnter={(_, i) => setActiveCat(i)} onMouseLeave={() => setActiveCat(null)}
                      isAnimationActive={animated} animationBegin={0} animationDuration={700} animationEasing="ease-out">
                      {cat.map((c, i) => <Cell key={c.categoryId} fill={`var(--${c.cat?.color ?? "chart-6"})`} opacity={activeCat === null || activeCat === i ? 1 : 0.35} stroke="none" />)}
                    </Pie>
                    <Tooltip content={<ChartTip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-2">
                <AnimatePresence initial={false} mode="popLayout">
                {cat.map((c, i) => {
                  const total = cat.reduce((s, x) => s + x.amount, 0);
                  return (
                    <motion.li layout="position" key={c.categoryId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }}
                      onMouseEnter={() => setActiveCat(i)} onMouseLeave={() => setActiveCat(null)} className={cn("flex items-center gap-3 rounded-2xl p-1.5 transition-colors", activeCat === i && "bg-muted")}>
                      <CategoryIcon category={c.cat} size="sm" />
                      <span className="flex-1 text-sm font-medium">{c.cat?.name}</span>
                      <span className="text-xs text-muted-foreground tnum">{Math.round((c.amount / total) * 100)}%</span>
                      <Amount value={c.amount} className="w-24 text-right text-sm" />
                    </motion.li>
                  );
                })}
                </AnimatePresence>
              </ul>
            </div>
          )}
        </Card>

        <Card title="Spending trend" className="md:col-span-2" right={
          <div className="flex rounded-full bg-muted p-0.5 text-xs">
            {[7, 30, 90].map((d) => <button key={d} onClick={() => setTrendDays(d)} className={cn("rounded-full px-3 py-1 font-medium", trendDays === d ? "bg-card shadow-soft" : "text-muted-foreground")}>{d}d</button>)}
          </div>
        }>
          <div className="h-56">
            <ResponsiveContainer>
              <AreaChart data={daily}>
                <defs><linearGradient id="trend" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.4} /><stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="var(--color-border)" />
                <XAxis dataKey="label" {...axis} minTickGap={30} />
                <YAxis {...axis} tickFormatter={(v) => (hidden ? "" : compactINR(v))} width={44} />
                <Tooltip content={<ChartTip />} />
                <Area key={trendDays} type="monotone" dataKey="spent" name="spent" stroke="var(--color-chart-1)" strokeWidth={2.5} fill="url(#trend)" isAnimationActive={animated} animationDuration={900} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Income vs expense">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={monthly} barGap={4}>
                <CartesianGrid vertical={false} stroke="var(--color-border)" />
                <XAxis dataKey="label" {...axis} />
                <YAxis {...axis} tickFormatter={(v) => (hidden ? "" : compactINR(v))} width={44} />
                <Tooltip content={<ChartTip />} cursor={{ fill: "var(--color-muted)" }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name="income" fill="var(--color-income)" radius={[6, 6, 0, 0]} isAnimationActive={animated} />
                <Bar dataKey="spent" name="spent" fill="var(--color-expense)" radius={[6, 6, 0, 0]} isAnimationActive={animated} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Budget vs actual">
          {bva.length === 0 ? <Empty text="Add budgets to compare." /> : (
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={bva} layout="vertical" barGap={-14}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" {...axis} width={80} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: "var(--color-muted)" }} />
                  <Bar dataKey="budget" name="budget" fill="var(--color-muted)" radius={8} barSize={14} isAnimationActive={animated} />
                  <Bar dataKey="spent" name="spent" radius={8} barSize={14} isAnimationActive={animated} animationBegin={0} animationDuration={700} animationEasing="ease-out">
                    {bva.map((b) => <Cell key={b.name} fill={b.spent > b.budget ? "var(--color-expense)" : b.spent > b.budget * 0.8 ? "var(--color-marigold)" : "var(--color-primary)"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title={`Spending calendar · ${now.toLocaleDateString("en-IN", { month: "long" })}`}>
          <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] text-muted-foreground">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}
            {Array.from({ length: heat.offset }).map((_, i) => <span key={`o${i}`} />)}
            {heat.cells.map((c, i) => (
              <motion.span key={c.day} initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.012 }}
                title={`${c.day}: ₹${Math.round(c.spent)}`}
                className={cn("grid aspect-square place-items-center rounded-lg text-[11px] font-medium", c.future ? "border border-dashed" : "")}
                style={c.future ? undefined : { backgroundColor: `color-mix(in oklab, var(--color-primary) ${Math.round(8 + (c.spent / maxHeat) * 85)}%, var(--color-card))`, color: c.spent / maxHeat > 0.5 ? "var(--color-primary-foreground)" : undefined }}>
                {c.day}
              </motion.span>
            ))}
          </div>
        </Card>

        <Card title="Top merchants">
          {merchants.length === 0 ? <Empty text="No merchants yet." /> : (
            <ul className="space-y-3">
              <AnimatePresence initial={false} mode="popLayout">
              {merchants.map((m, i) => (
                <motion.li layout="position" key={m.merchant} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }}>
                  <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{m.merchant} <span className="font-normal text-muted-foreground">· {m.count} times</span></span><Amount value={m.amount} /></div>
                  <div className="h-2 rounded-full bg-muted"><motion.div className="h-full rounded-full bg-chart-2" initial={{ width: 0 }} animate={{ width: `${(m.amount / merchants[0].amount) * 100}%` }} transition={reduce ? { duration: 0 } : { delay: 0.1 + i * 0.06, type: "spring", stiffness: 60, damping: 14 }} /></div>
                </motion.li>
              ))}
              </AnimatePresence>
            </ul>
          )}
        </Card>

        <Card title="Cash flow this month">
          <div className="h-48">
            <ResponsiveContainer>
              <LineChart data={cash}>
                <CartesianGrid vertical={false} stroke="var(--color-border)" />
                <XAxis dataKey="label" {...axis} minTickGap={30} />
                <YAxis {...axis} tickFormatter={(v) => (hidden ? "" : compactINR(v))} width={44} />
                <Tooltip content={<ChartTip />} />
                <Line type="stepAfter" dataKey="balance" name="net" stroke="var(--color-chart-4)" strokeWidth={2.5} dot={false} isAnimationActive={animated} animationDuration={1100} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Unusual changes vs last month">
          {anom.length === 0 ? <Empty text="Nothing unusual. Spending looks steady." /> : (
            <ul className="space-y-2">
              {anom.slice(0, 5).map((a) => {
                const c = cats.find((x) => x.id === a.categoryId);
                const up = a.change > 0;
                return (
                  <li key={a.categoryId} className="flex items-center gap-3 rounded-2xl bg-muted/60 p-2.5">
                    <CategoryIcon category={c} size="sm" />
                    <span className="flex-1 text-sm font-medium">{c?.name}</span>
                    <span className={cn("flex items-center gap-1 text-sm font-semibold tnum", up ? "text-expense" : "text-income")}>
                      {up ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}{a.before === 0 ? "new" : `${up ? "+" : ""}${Math.round(a.change * 100)}%`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Savings goals">
          {goals.length === 0 ? <Empty text="No goals yet." /> : (
            <div className="flex justify-around">
              {goals.map((g) => <GoalDial key={g.id} pct={g.saved / g.target} label={g.name} emoji={g.emoji} />)}
            </div>
          )}
        </Card>

        <Card title="Recurring payments">
          {recurring.length === 0 ? <Empty text="No recurring payments detected." /> : (
            <ul className="space-y-2.5">
              {recurring.map((r) => (
                <li key={r.merchant} className="flex items-center gap-3 text-sm">
                  <Repeat className="size-4 text-muted-foreground" /><span className="flex-1 font-medium">{r.merchant}</span>
                  <span className="text-xs text-muted-foreground">Monthly · around the {new Date(r.date).getDate()}th</span>
                  <Amount value={r.amount} type={r.type} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="text-center text-xs text-muted-foreground">Insights are estimates from your records, not financial advice.</p>
    </div>
  );
}

function Card({ title, right, children, className }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ type: "spring", stiffness: 200, damping: 24 }} className={className}>
      <Panel className="h-full">
        <div className="mb-4 flex items-center justify-between gap-2"><h2 className="font-display text-lg font-semibold">{title}</h2>{right}</div>
        {children}
      </Panel>
    </motion.div>
  );
}

function GoalDial({ pct, label, emoji }: { pct: number; label: string; emoji: string }) {
  const C = 2 * Math.PI * 30;
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="relative size-20">
        <svg viewBox="0 0 72 72" className="size-full -rotate-90">
          <circle cx="36" cy="36" r="30" fill="none" stroke="var(--color-muted)" strokeWidth="7" />
          <motion.circle cx="36" cy="36" r="30" fill="none" stroke="var(--color-marigold)" strokeWidth="7" strokeLinecap="round" strokeDasharray={C}
            initial={{ strokeDashoffset: C }} whileInView={{ strokeDashoffset: C * (1 - Math.min(1, pct)) }} viewport={{ once: true }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }} />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-xl">{emoji}</span>
      </div>
      <p className="text-xs font-medium">{label}</p>
      <p className="text-xs text-muted-foreground tnum">{Math.round(pct * 100)}%</p>
    </div>
  );
}
