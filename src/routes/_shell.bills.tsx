import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BellRing, Check, ChevronLeft, ChevronRight, Minus, Plus, Trash2 } from "lucide-react";
import { actions, useFinance } from "@/lib/finance/store";
import { billState, daysUntil, monthBillsTotal, occurrencesInMonth } from "@/lib/finance/bills";
import { daySpendInMonth } from "@/lib/finance/calc";
import { compactINR } from "@/lib/finance/format";
import type { Bill, Repeat } from "@/lib/finance/types";
import { Amount, DemoBadge, Empty, PageTitle, Panel, Section } from "@/components/app/bits";
import { BottomSheet, Chips, Field } from "@/components/app/sheet";
import { useTxSheet } from "@/components/app/tx-sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/bills")({
  head: () => ({
    meta: [
      { title: "Bills & calendar — ExTrack" },
      { name: "description", content: "Bill reminders and a spending calendar. Tap any date to add an expense, income or bill." },
      { property: "og:title", content: "Bills & calendar — ExTrack" },
      { property: "og:description", content: "Bill reminders and a spending calendar. Tap any date to add an expense, income or bill." },
    ],
  }),
  component: Bills,
});

const WEEK = ["M", "T", "W", "T", "F", "S", "S"];
const STATE_STYLE = { overdue: "text-expense", today: "text-marigold", soon: "text-marigold", later: "text-muted-foreground", paid: "text-income" };

function Bills() {
  const bills = useFinance((s) => s.bills);
  const txs = useFinance((s) => s.transactions);
  const now = new Date();
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [picked, setPicked] = useState<Date | null>(null);
  const [billForm, setBillForm] = useState<{ bill?: Bill; date?: string } | null>(null);
  const { open } = useTxSheet();
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const spend = useMemo(() => daySpendInMonth(txs, y, m), [txs, y, m]);
  const dueDays = useMemo(() => {
    const map: Record<number, Bill[]> = {};
    for (const b of bills) for (const d of occurrencesInMonth(b, y, m)) (map[d] ??= []).push(b);
    return map;
  }, [bills, y, m]);
  const monthTotal = monthBillsTotal(bills, y, m);
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const max = Math.max(1, ...Object.values(spend));
  const sorted = [...bills].sort((a, b) => Number(!!a.done) - Number(!!b.done) || +new Date(a.dueDate) - +new Date(b.dueDate));
  const isToday = (d: number) => y === now.getFullYear() && m === now.getMonth() && d === now.getDate();

  const choose = (kind: "expense" | "income" | "bill") => {
    if (!picked) return;
    const iso = new Date(picked.getFullYear(), picked.getMonth(), picked.getDate(), isTodayDate(picked) ? now.getHours() : 12).toISOString();
    setPicked(null);
    if (kind === "bill") setBillForm({ date: iso });
    else setTimeout(() => open(undefined, { date: iso, type: kind }), 200);
  };

  return (
    <div className="space-y-6">
      <PageTitle title="Bills" sub="Tap a date to add something" right={<div className="flex items-center gap-2"><DemoBadge /><Button size="sm" className="rounded-full" onClick={() => setBillForm({})}><Plus className="size-4" />Bill</Button></div>} />

      <Panel className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <button onClick={() => setCursor(new Date(y, m - 1, 1))} aria-label="Previous month" className="grid size-9 place-items-center rounded-full bg-muted"><ChevronLeft className="size-4" /></button>
          <div className="text-center">
            <AnimatePresence mode="wait"><motion.p key={`${y}-${m}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="font-display text-lg font-semibold">{cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</motion.p></AnimatePresence>
            <p className="text-xs text-muted-foreground">Bills due: <Amount value={monthTotal} className="text-xs" /></p>
          </div>
          <button onClick={() => setCursor(new Date(y, m + 1, 1))} aria-label="Next month" className="grid size-9 place-items-center rounded-full bg-muted"><ChevronRight className="size-4" /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">{WEEK.map((w, i) => <span key={i}>{w}</span>)}</div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: offset }, (_, i) => <span key={`e${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const d = i + 1;
            const s = spend[d] ?? 0;
            const due = dueDays[d];
            return (
              <motion.button key={d} whileTap={{ scale: 0.88 }} onClick={() => setPicked(new Date(y, m, d))}
                initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.008 }}
                aria-label={`${d} ${cursor.toLocaleDateString("en-IN", { month: "long" })}${due ? `, ${due.length} bill due` : ""}`}
                className={cn("relative flex aspect-square flex-col items-center justify-center rounded-xl text-sm", isToday(d) && "ring-2 ring-primary")}
                style={{ backgroundColor: s > 0 ? `color-mix(in oklab, var(--primary) ${Math.round(8 + (s / max) * 40)}%, transparent)` : undefined }}>
                <span className="font-medium tnum">{d}</span>
                {s > 0 && <span className="text-[9px] leading-none text-muted-foreground tnum">{compactINR(s)}</span>}
                {due && <span className="absolute right-1 top-1 flex gap-0.5">{due.slice(0, 3).map((b) => <span key={b.id} className="size-1.5 rounded-full bg-marigold" />)}</span>}
              </motion.button>
            );
          })}
        </div>
      </Panel>

      <Section title="Reminders">
        {sorted.length === 0 ? <Empty text="No bills yet. Add rent, electricity, card dues or subscriptions." /> : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {sorted.map((b, i) => <BillCard key={b.id} b={b} i={i} onEdit={() => setBillForm({ bill: b })} />)}
          </div>
        )}
      </Section>

      <BottomSheet open={!!picked} onClose={() => setPicked(null)} title={picked ? picked.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }) : ""}>
        <p className="mb-4 text-sm text-muted-foreground">What do you want to add?</p>
        <div className="grid grid-cols-3 gap-3">
          {([["expense", "Expense", Minus, "bg-expense/15 text-expense"], ["income", "Income", Plus, "bg-income/15 text-income"], ["bill", "Bill / reminder", BellRing, "bg-marigold-soft text-foreground"]] as const).map(([k, label, Icon, tone], i) => (
            <motion.button key={k} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.06 }} whileTap={{ scale: 0.94 }}
              onClick={() => choose(k)} className="flex flex-col items-center gap-2 rounded-3xl border p-4 text-sm font-medium">
              <span className={cn("grid size-12 place-items-center rounded-2xl", tone)}><Icon className="size-5" /></span>{label}
            </motion.button>
          ))}
        </div>
        {picked && dueDays[picked.getDate()] && picked.getMonth() === m && (
          <div className="mt-4 space-y-1 rounded-2xl bg-muted p-3 text-sm">
            <p className="text-xs text-muted-foreground">Due on this day</p>
            {dueDays[picked.getDate()].map((b) => <p key={b.id} className="flex justify-between"><span>{b.name}</span><Amount value={b.amount} /></p>)}
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={!!billForm} onClose={() => setBillForm(null)} title={billForm?.bill ? "Edit bill" : "New bill"}>
        {billForm && <BillForm key={billForm.bill?.id ?? billForm.date ?? "new"} bill={billForm.bill} date={billForm.date} onDone={() => setBillForm(null)} />}
      </BottomSheet>
    </div>
  );
}

function isTodayDate(d: Date) {
  const n = new Date();
  return d.toDateString() === n.toDateString();
}

function Ring({ days }: { days: number }) {
  const pct = days < 0 ? 1 : Math.max(0.05, 1 - Math.min(days, 30) / 30);
  const c = 2 * Math.PI * 18;
  return (
    <svg viewBox="0 0 44 44" className="size-12 -rotate-90">
      <circle cx="22" cy="22" r="18" fill="none" strokeWidth="4" className="stroke-muted" />
      <motion.circle cx="22" cy="22" r="18" fill="none" strokeWidth="4" strokeLinecap="round" strokeDasharray={c}
        initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pct) }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        className={days < 0 ? "stroke-expense" : days <= 3 ? "stroke-marigold" : "stroke-primary"} />
    </svg>
  );
}

function BillCard({ b, i, onEdit }: { b: Bill; i: number; onEdit: () => void }) {
  const st = billState(b);
  const d = daysUntil(b);
  const label = st === "paid" ? "Paid" : st === "overdue" ? `${-d} day${d === -1 ? "" : "s"} overdue` : st === "today" ? "Due today" : `Due in ${d} days`;
  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
      className={cn("flex items-center gap-3 rounded-3xl bg-card p-4 shadow-soft", st === "paid" && "opacity-60")}>
      <button onClick={onEdit} className="relative shrink-0" aria-label={`Edit ${b.name}`}>
        <Ring days={st === "paid" ? 30 : d} />
        <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold tnum">{st === "paid" ? <Check className="size-4 text-income" /> : d < 0 ? "!" : d}</span>
      </button>
      <button onClick={onEdit} className="min-w-0 flex-1 text-left">
        <p className="truncate font-medium">{b.name}</p>
        <p className={cn("text-xs", STATE_STYLE[st])}>{label}{b.repeat !== "none" ? ` · ${b.repeat}` : ""}</p>
      </button>
      <div className="flex flex-col items-end gap-1">
        <Amount value={b.amount} />
        {st !== "paid" && (
          <Button size="sm" variant="secondary" className="h-7 rounded-full px-3 text-xs"
            onClick={() => { actions.payBill(b.id); toast.success(`${b.name} marked paid`, { description: "Recorded as an expense" }); }}>Mark paid</Button>
        )}
      </div>
    </motion.div>
  );
}

function BillForm({ bill, date, onDone }: { bill?: Bill; date?: string; onDone: () => void }) {
  const cats = useFinance((s) => s.categories);
  const accounts = useFinance((s) => s.accounts);
  const iso = bill?.dueDate ?? date ?? new Date().toISOString();
  const d0 = new Date(iso);
  const [name, setName] = useState(bill?.name ?? "");
  const [amount, setAmount] = useState(bill ? String(bill.amount) : "");
  const [due, setDue] = useState(`${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-${String(d0.getDate()).padStart(2, "0")}`);
  const [repeat, setRepeat] = useState<Repeat>(bill?.repeat ?? "monthly");
  const [categoryId, setCategoryId] = useState(bill?.categoryId ?? "bills");
  const [accountId, setAccountId] = useState(bill?.accountId ?? accounts[0]?.id ?? "cash");
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!name.trim()) return toast.error("Name the bill");
    if (!(amt > 0)) return toast.error("Enter an amount more than ₹0");
    const [yy, mm, dd] = due.split("-").map(Number);
    actions.upsertBill({ id: bill?.id, name: name.trim(), amount: amt, dueDate: new Date(yy, mm - 1, dd, 9).toISOString(), repeat, categoryId, accountId, done: false });
    toast.success(bill ? "Bill updated" : "Reminder added");
    onDone();
  };
  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Bill name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Electricity" className="input-base h-11" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (₹)"><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" className="input-base h-11" /></Field>
        <Field label="Due date"><input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="input-base h-11" /></Field>
        <Field label="Category"><select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input-base h-11">{cats.filter((c) => c.kind === "expense").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Pay from"><select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input-base h-11">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      </div>
      <Field label="Repeats"><Chips value={repeat} onChange={setRepeat} options={[{ v: "none", label: "Once" }, { v: "weekly", label: "Weekly" }, { v: "monthly", label: "Monthly" }, { v: "yearly", label: "Yearly" }]} /></Field>
      <div className="flex gap-2">
        {bill && <Button type="button" variant="ghost" className="h-12 rounded-2xl text-expense" aria-label="Delete bill" onClick={() => { actions.deleteBill(bill.id); toast.success("Bill deleted"); onDone(); }}><Trash2 className="size-4" /></Button>}
        <Button type="submit" className="h-12 flex-1 rounded-2xl">{bill ? "Save" : "Add reminder"}</Button>
      </div>
    </form>
  );
}
