import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useMemo } from "react";
import { Bar as RBar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Gift } from "lucide-react";
import { useFinance } from "@/lib/finance/store";
import { cashbackTotals, isCashback } from "@/lib/finance/cashback";
import { Amount, ChartTip, DemoBadge, Empty, PageTitle, Panel, Section, Ticker } from "@/components/app/bits";
import { useTxSheet } from "@/components/app/tx-sheet";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_shell/cashback")({
  head: () => ({
    meta: [
      { title: "Cashback — ExTrack" },
      { name: "description", content: "Total cashback from Google Pay, PhonePe, Paytm and cards, by month and year." },
      { property: "og:title", content: "Cashback — ExTrack" },
      { property: "og:description", content: "Total cashback from Google Pay, PhonePe, Paytm and cards, by month and year." },
    ],
  }),
  component: Cashback,
});

function Cashback() {
  const txs = useFinance((s) => s.transactions);
  const { open } = useTxSheet();
  const t = useMemo(() => cashbackTotals(txs), [txs]);
  const recent = useMemo(() => txs.filter(isCashback).slice(0, 8), [txs]);
  const top = t.bySource[0]?.amount || 1;

  return (
    <div className="space-y-6">
      <PageTitle title="Cashback" sub="Rewards from UPI apps and cards" right={<DemoBadge />} />

      <Panel className="relative overflow-hidden bg-marigold-card text-primary-foreground">
        <motion.div className="absolute -right-6 -top-6" initial={{ rotate: -20, scale: 0.6, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 0.25 }} transition={{ type: "spring" }}><Gift className="size-32" /></motion.div>
        <p className="relative text-sm opacity-90">This month</p>
        <Ticker value={t.month} className="relative font-display text-4xl font-bold" />
        <div className="relative mt-4 flex gap-6 text-sm">
          <div><p className="opacity-80">Last 12 months</p><Ticker value={t.year} className="font-semibold" /></div>
          <div><p className="opacity-80">All time</p><Ticker value={t.all} className="font-semibold" /></div>
        </div>
      </Panel>

      <Panel>
        <p className="mb-2 text-sm font-medium">Month by month</p>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={t.monthly}>
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
              <Tooltip content={<ChartTip />} cursor={{ fill: "var(--muted)" }} />
              <RBar dataKey="amount" name="cashback" fill="var(--marigold)" radius={[8, 8, 4, 4]} animationDuration={900} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Section title="By app">
        {t.bySource.length === 0 ? <Empty text="No cashback yet. When adding income, switch on Cashback and pick the app." /> : (
          <Panel className="space-y-3">
            {t.bySource.map((s, i) => (
              <div key={s.source} className="space-y-1">
                <div className="flex justify-between text-sm"><span className="font-medium">{s.source}</span><Amount value={s.amount} type="income" /></div>
                <div className="h-2 overflow-hidden rounded-full bg-muted"><motion.div className="h-full rounded-full bg-marigold" initial={{ width: 0 }} animate={{ width: `${(s.amount / top) * 100}%` }} transition={{ delay: 0.1 + i * 0.07, type: "spring", stiffness: 60 }} /></div>
              </div>
            ))}
          </Panel>
        )}
      </Section>

      <Section title="Recent cashback" action={<Button size="sm" variant="secondary" className="rounded-full" onClick={() => open(undefined, { type: "income" })}>Add cashback</Button>}>
        <Panel className="divide-y p-2">
          {recent.length ? recent.map((x) => (
            <button key={x.id} onClick={() => open(x)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm">
              <span><span className="block font-medium">{x.merchant}</span><span className="text-xs text-muted-foreground">{x.cashbackSource ?? "Other"} · {new Date(x.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span></span>
              <Amount value={x.amount} type="income" />
            </button>
          )) : <p className="p-3 text-sm text-muted-foreground">Nothing yet.</p>}
        </Panel>
      </Section>
    </div>
  );
}
