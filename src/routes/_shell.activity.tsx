import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { actions, useFinance } from "@/lib/finance/store";
import { totals } from "@/lib/finance/calc";
import { dayLabel } from "@/lib/finance/format";
import type { TxSource, TxType } from "@/lib/finance/types";
import { Amount, DemoBadge, Empty, PageTitle } from "@/components/app/bits";
import { TxRow } from "@/components/app/tx-row";
import { useFreshIds } from "@/components/app/use-fresh-ids";
import { useTxSheet } from "@/components/app/tx-sheet";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/activity")({
  head: () => ({
    meta: [
      { title: "Activity — ExTrack" },
      { name: "description", content: "Search, filter and edit every transaction in one ledger." },
      { property: "og:title", content: "Activity — ExTrack" },
      { property: "og:description", content: "Search, filter and edit every transaction in one ledger." },
    ],
  }),
  component: Activity,
});

const RANGES = [
  { v: "7", label: "7 days" },
  { v: "30", label: "30 days" },
  { v: "90", label: "90 days" },
  { v: "all", label: "All" },
] as const;

function Activity() {
  const txs = useFinance((s) => s.transactions);
  const cats = useFinance((s) => s.categories);
  const accounts = useFinance((s) => s.accounts);
  const { open } = useTxSheet();
  const fresh = useFreshIds(txs);
  const reduce = useReducedMotion();
  const [q, setQ] = useState("");
  const [type, setType] = useState<TxType | "all">("all");
  const [range, setRange] = useState<(typeof RANGES)[number]["v"]>("30");
  const [cat, setCat] = useState<string>("all");
  const [acct, setAcct] = useState<string>("all");
  const [src, setSrc] = useState<TxSource | "all">("all");
  const [showFilters, setShowFilters] = useState(false);

  const filtered = useMemo(() => {
    const since = range === "all" ? 0 : Date.now() - Number(range) * 864e5;
    const ql = q.trim().toLowerCase();
    return txs.filter((t) =>
      (type === "all" || t.type === type) &&
      (cat === "all" || t.categoryId === cat) &&
      (acct === "all" || t.accountId === acct) &&
      (src === "all" || t.source === src) &&
      +new Date(t.date) >= since &&
      (!ql || t.merchant.toLowerCase().includes(ql) || (t.note ?? "").toLowerCase().includes(ql) || String(t.amount).includes(ql)),
    );
  }, [txs, q, type, range, cat, acct, src]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof filtered>();
    for (const t of filtered) {
      const k = new Date(t.date).toDateString();
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()];
  }, [filtered]);

  const tt = totals(filtered);
  const activeFilters = [cat, acct, src].filter((x) => x !== "all").length;

  const del = (id: string) => {
    const removed = actions.deleteTx(id);
    if (removed) toast("Transaction deleted", { action: { label: "Undo", onClick: () => actions.restoreTx(removed) } });
  };

  return (
    <div className="space-y-4">
      <PageTitle title="Activity" sub={`${filtered.length} transactions`} right={<DemoBadge />} />

      <div className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search transactions</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search merchant, note or amount" className="input-base pl-10" />
          {q && <button onClick={() => setQ("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2"><X className="size-4" /></button>}
        </label>
        <button onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters} aria-label="Filters"
          className={cn("relative grid size-12 place-items-center rounded-[0.9rem] border bg-surface", showFilters && "border-primary bg-accent")}>
          <SlidersHorizontal className="size-5" />
          {activeFilters > 0 && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{activeFilters}</span>}
        </button>
      </div>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {(["all", "expense", "income", "refund", "transfer"] as const).map((t) => (
          <Chip key={t} active={type === t} onClick={() => setType(t)} group="type">{t === "all" ? "All types" : t[0].toUpperCase() + t.slice(1)}</Chip>
        ))}
        <span className="mx-1 w-px shrink-0 bg-border" />
        {RANGES.map((r) => <Chip key={r.v} active={range === r.v} onClick={() => setRange(r.v)} group="range">{r.label}</Chip>)}
      </div>

      <AnimatePresence initial={false}>
        {showFilters && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="grid gap-3 rounded-3xl bg-card p-4 shadow-soft sm:grid-cols-3">
              <Sel label="Category" value={cat} onChange={setCat} options={[["all", "All categories"], ...cats.map((c) => [c.id, c.name] as [string, string])]} />
              <Sel label="Account" value={acct} onChange={setAcct} options={[["all", "All accounts"], ...accounts.map((a) => [a.id, a.name] as [string, string])]} />
              <Sel label="Source" value={src} onChange={(v) => setSrc(v as TxSource | "all")} options={[["all", "All sources"], ["manual", "Added by hand"], ["sms_demo", "Sample SMS"], ["csv", "CSV import"], ["ai", "AI"]]} />
              {activeFilters > 0 && <button className="text-left text-sm font-medium text-primary" onClick={() => { setCat("all"); setAcct("all"); setSrc("all"); }}>Clear filters</button>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-income-soft/60 p-3"><p className="text-xs text-muted-foreground">In</p><Amount value={tt.income} type="income" className="text-lg" /></div>
        <div className="rounded-2xl bg-expense-soft/60 p-3"><p className="text-xs text-muted-foreground">Spent</p><Amount value={tt.spent} type="expense" className="text-lg" /></div>
      </div>

      {groups.length === 0 ? (
        <Empty text={txs.length ? "No transactions match these filters." : "No transactions yet. Tap + to add your first one."} />
      ) : (
        <div className="space-y-5">
          <AnimatePresence initial={false}>
          {groups.map(([day, list]) => {
            // A day that only holds just-added rows is a new section: let its rows grow in too.
            const isNew = list.every((t) => fresh.has(t.id));
            return (
              <motion.section key={day} initial={isNew && !reduce ? { opacity: 0 } : false} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.2 } }}>
                <div className="sticky top-0 z-10 -mx-1 flex justify-between bg-background/85 px-2 py-2 text-sm backdrop-blur">
                  <h2 className="font-semibold">{dayLabel(list[0].date)}</h2>
                  <span className="text-muted-foreground"><Amount value={totals(list).spent} className="font-medium text-muted-foreground" /></span>
                </div>
                <ul className="rounded-3xl bg-card p-1.5 shadow-soft">
                  <AnimatePresence initial={isNew}>
                    {list.map((t) => <TxRow key={t.id} tx={t} category={cats.find((c) => c.id === t.categoryId)} onOpen={() => open(t)} onDelete={() => del(t.id)} fresh={fresh.has(t.id)} />)}
                  </AnimatePresence>
                </ul>
              </motion.section>
            );
          })}
          </AnimatePresence>
          <p className="text-center text-xs text-muted-foreground">Swipe a row left to delete it</p>
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children, group }: { active: boolean; onClick: () => void; children: React.ReactNode; group: string }) {
  return (
    <button onClick={onClick} aria-pressed={active} className={cn("relative shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors", active ? "text-primary-foreground" : "bg-card text-muted-foreground shadow-soft")}>
      {active && <motion.span layoutId={`chip-${group}`} className="absolute inset-0 rounded-full bg-primary" transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
      <span className="relative">{children}</span>
    </button>
  );
}

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-base">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
