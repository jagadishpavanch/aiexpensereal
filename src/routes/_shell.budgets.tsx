import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Repeat, AlertTriangle } from "lucide-react";
import { actions, useFinance } from "@/lib/finance/store";
import { budgetStatus, inMonth } from "@/lib/finance/calc";
import { formatINR } from "@/lib/finance/format";
import { Amount, Bar, CategoryIcon, DemoBadge, Empty, PageTitle, Panel, Section } from "@/components/app/bits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/budgets")({
  head: () => ({
    meta: [
      { title: "Budgets & goals — ExTrack" },
      { name: "description", content: "Monthly category budgets, savings goals and recurring bills." },
      { property: "og:title", content: "Budgets & goals — ExTrack" },
      { property: "og:description", content: "Monthly category budgets, savings goals and recurring bills." },
    ],
  }),
  component: Budgets,
});

function Budgets() {
  const txs = useFinance((s) => s.transactions);
  const cats = useFinance((s) => s.categories);
  const budgets = useFinance((s) => s.budgets);
  const goals = useFinance((s) => s.goals);
  const hidden = useFinance((s) => s.prefs.hideAmounts);
  const now = useMemo(() => new Date(), []);
  const month = useMemo(() => txs.filter((t) => inMonth(t.date, now)), [txs, now]);
  const [adding, setAdding] = useState<"budget" | "goal" | null>(null);
  const [celebrate, setCelebrate] = useState(false);

  const totalLimit = budgets.reduce((s, b) => s + b.limit, 0);
  const totalSpent = budgets.reduce((s, b) => s + budgetStatus(b, month).spent, 0);
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
  const recurring = Array.from(new Map(txs.filter((t) => t.recurring && t.type === "expense").map((t) => [t.merchant, t])).values());

  return (
    <div className="space-y-6">
      <PageTitle title="Budgets" sub={`${daysLeft} days left this month`} right={<DemoBadge />} />

      {budgets.length > 0 && (
        <Panel className="bg-ink text-ink-foreground">
          <p className="text-sm opacity-75">Budgeted spending</p>
          <p className="mt-1 font-display text-3xl font-bold tnum">{formatINR(totalSpent, { hidden })} <span className="text-lg font-medium opacity-60">of {formatINR(totalLimit, { hidden })}</span></p>
          <div className="mt-4"><Bar pct={totalLimit ? totalSpent / totalLimit : 0} state={totalSpent > totalLimit ? "over" : totalSpent > totalLimit * 0.8 ? "near" : "ok"} /></div>
          <p className="mt-3 text-sm opacity-75">
            {totalLimit - totalSpent > 0 ? `About ${formatINR((totalLimit - totalSpent) / daysLeft, { hidden })} a day keeps you on budget.` : "You're over budget for the month."}
          </p>
        </Panel>
      )}

      <Section title="Category budgets" action={<button onClick={() => setAdding("budget")} className="flex items-center gap-1 text-sm font-medium text-primary"><Plus className="size-4" />Add</button>}>
        {budgets.length === 0 ? <Empty text="No budgets yet. Add one to get alerts at 80% and 100%." /> : (
          <ul className="grid gap-3 md:grid-cols-2">
            <AnimatePresence>
              {budgets.map((b, i) => {
                const c = cats.find((x) => x.id === b.categoryId);
                const s = budgetStatus(b, month);
                return (
                  <motion.li key={b.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ delay: i * 0.04 }}
                    className="group rounded-3xl bg-card p-4 shadow-soft">
                    <div className="mb-3 flex items-center gap-3">
                      <CategoryIcon category={c} />
                      <div className="flex-1">
                        <p className="font-semibold">{c?.name}</p>
                        <p className="text-sm text-muted-foreground tnum">{formatINR(s.spent, { hidden })} of {formatINR(b.limit, { hidden })}</p>
                      </div>
                      {s.state !== "ok" && (
                        <span className={cn("flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium", s.state === "over" ? "bg-expense-soft text-expense" : "bg-marigold-soft text-foreground")}>
                          <AlertTriangle className="size-3" />{s.state === "over" ? "Over" : "Close"}
                        </span>
                      )}
                      <button aria-label={`Delete ${c?.name} budget`} onClick={() => { actions.deleteBudget(b.id); toast("Budget removed"); }} className="grid size-8 place-items-center rounded-full text-muted-foreground opacity-60 hover:bg-muted hover:opacity-100"><Trash2 className="size-4" /></button>
                    </div>
                    <Bar pct={s.pct} state={s.state} />
                    <p className="mt-2 text-xs text-muted-foreground">{s.remaining >= 0 ? `${formatINR(s.remaining, { hidden })} left` : `${formatINR(-s.remaining, { hidden })} over`}</p>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </Section>

      <Section title="Savings goals" action={<button onClick={() => setAdding("goal")} className="flex items-center gap-1 text-sm font-medium text-primary"><Plus className="size-4" />Add</button>}>
        {goals.length === 0 ? <Empty text="Set a goal, like a trip or an emergency fund." /> : (
          <ul className="grid gap-3 md:grid-cols-3">
            {goals.map((g) => {
              const pct = g.saved / g.target;
              return (
                <motion.li layout key={g.id} className="rounded-3xl bg-card p-4 shadow-soft">
                  <div className="flex items-center gap-3">
                    <span className="grid size-12 place-items-center rounded-2xl bg-marigold-soft text-2xl" aria-hidden>{g.emoji}</span>
                    <div className="flex-1"><p className="font-semibold">{g.name}</p><p className="text-sm text-muted-foreground tnum">{formatINR(g.saved, { hidden })} / {formatINR(g.target, { hidden })}</p></div>
                  </div>
                  <div className="mt-3"><Bar pct={pct} /></div>
                  <div className="mt-3 flex gap-2">
                    {[500, 2000].map((amt) => (
                      <Button key={amt} size="sm" variant="secondary" className="flex-1 rounded-xl" disabled={pct >= 1}
                        onClick={() => {
                          actions.contributeGoal(g.id, amt);
                          if (g.saved + amt >= g.target) { setCelebrate(true); setTimeout(() => setCelebrate(false), 2200); toast.success(`${g.name} reached!`); }
                          else toast.success(`Added ${formatINR(amt)} to ${g.name}`);
                        }}>+{formatINR(amt)}</Button>
                    ))}
                    <button aria-label={`Delete ${g.name}`} onClick={() => actions.deleteGoal(g.id)} className="grid size-9 place-items-center rounded-xl text-muted-foreground hover:bg-muted"><Trash2 className="size-4" /></button>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Recurring bills">
        {recurring.length === 0 ? <Empty text="Mark a transaction as recurring to track it here." /> : (
          <Panel className="p-2">
            <ul>
              {recurring.map((r) => {
                const next = new Date(now.getFullYear(), now.getMonth() + (new Date(r.date).getDate() < now.getDate() ? 1 : 0), new Date(r.date).getDate());
                return (
                  <li key={r.id} className="flex items-center gap-3 rounded-2xl p-2.5">
                    <CategoryIcon category={cats.find((c) => c.id === r.categoryId)} size="sm" />
                    <div className="flex-1"><p className="font-medium">{r.merchant}</p><p className="flex items-center gap-1 text-xs text-muted-foreground"><Repeat className="size-3" />Next around {next.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p></div>
                    <Amount value={r.amount} type="expense" />
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </Section>

      <AnimatePresence>{adding && <AddDialog kind={adding} onClose={() => setAdding(null)} />}</AnimatePresence>
      <AnimatePresence>{celebrate && <Confetti />}</AnimatePresence>
    </div>
  );
}

function AddDialog({ kind, onClose }: { kind: "budget" | "goal"; onClose: () => void }) {
  const allCats = useFinance((s) => s.categories);
  const cats = allCats.filter((c) => c.kind === "expense");
  const [cat, setCat] = useState(cats[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🎯");
  const [err, setErr] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!isFinite(n) || n <= 0) return setErr("Enter an amount above ₹0");
    if (kind === "goal" && !name.trim()) return setErr("Give your goal a name");
    if (kind === "budget") { actions.upsertBudget({ categoryId: cat, limit: n }); toast.success("Budget saved"); }
    else { actions.addGoal({ name: name.trim(), target: n, saved: 0, emoji }); toast.success("Goal added"); }
    onClose();
  };
  return (
    <>
      <motion.div className="fixed inset-0 z-50 bg-ink/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.form onSubmit={submit} role="dialog" aria-label={kind === "budget" ? "Add budget" : "Add goal"}
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 380, damping: 36 }}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md space-y-4 rounded-t-[2rem] bg-card p-6 shadow-lift md:bottom-8 md:rounded-[2rem]">
        <h2 className="font-display text-xl font-semibold">{kind === "budget" ? "Set a monthly budget" : "New savings goal"}</h2>
        {kind === "budget" ? (
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="input-base" aria-label="Category">
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : (
          <div className="flex gap-2">
            <select value={emoji} onChange={(e) => setEmoji(e.target.value)} className="input-base w-20" aria-label="Icon">
              {["🎯", "🏖️", "💻", "🏍️", "💍", "🏠", "🎓", "🛟"].map((x) => <option key={x}>{x}</option>)}
            </select>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Goal name" className="input-base" />
          </div>
        )}
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={kind === "budget" ? "Monthly limit, e.g. 5000" : "Target amount"} className="input-base" />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <Button type="submit" className="h-12 w-full rounded-2xl">{kind === "budget" ? "Save budget" : "Add goal"}</Button>
      </motion.form>
    </>
  );
}

function Confetti() {
  const pieces = Array.from({ length: 40 });
  const colors = ["var(--color-marigold)", "var(--color-primary)", "var(--color-income)", "var(--color-expense)"];
  return (
    <motion.div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" initial={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {pieces.map((_, i) => (
        <motion.span key={i} className="absolute top-1/3 size-2.5 rounded-sm" style={{ left: "50%", backgroundColor: colors[i % 4] }}
          initial={{ x: 0, y: 0, rotate: 0 }}
          animate={{ x: (Math.cos(i) * 0.5 + (i % 2 ? 0.3 : -0.3)) * 600, y: [0, -200 - (i % 5) * 40, 600], rotate: i * 47 }}
          transition={{ duration: 1.8, ease: "easeOut" }} />
      ))}
    </motion.div>
  );
}
