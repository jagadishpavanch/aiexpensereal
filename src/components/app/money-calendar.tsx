import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { BellRing, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { actions, useFinance } from "@/lib/finance/store";
import { buildMonthGrid, entryTimeForDay, istMonthOf, shiftMonth, type BillStatus, type CalendarBill, type CalendarDay, type DayKey } from "@/lib/finance/calendar";
import { compactINR, formatINR } from "@/lib/finance/format";
import type { Bill, Transaction } from "@/lib/finance/types";
import { Amount, Empty, Panel } from "@/components/app/bits";
import { BillForm } from "@/components/app/bill-form";
import { BottomSheet } from "@/components/app/sheet";
import { TxRow } from "@/components/app/tx-row";
import { useTxSheet } from "@/components/app/tx-sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS_LABEL: Record<BillStatus, string> = { paid: "Paid", overdue: "Overdue", due: "Due" };
const STATUS_TEXT: Record<BillStatus, string> = { paid: "text-income", overdue: "text-expense", due: "text-marigold" };
const STATUS_DOT: Record<BillStatus, string> = { paid: "bg-income", overdue: "bg-expense", due: "bg-marigold" };

/** Noon IST of a day key: only used for naming the day, so no time zone can move it. */
const noon = (key: DayKey) => new Date(`${key}T12:00:00+05:30`);
const longDay = (key: DayKey) => noon(key).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });

function cellLabel(d: CalendarDay, monthName: string, hidden: boolean, billsOn: boolean) {
  const parts = [`${d.day} ${monthName}`];
  if (d.isToday) parts.push("today");
  if (d.count > 0) {
    parts.push(`${d.count} transaction${d.count === 1 ? "" : "s"}`);
    if (!hidden) {
      if (d.spent !== 0) parts.push(`spent ${formatINR(Math.abs(d.spent))}`);
      if (d.income > 0) parts.push(`income ${formatINR(d.income)}`);
    }
  }
  if (billsOn && d.bills.length) {
    const open = d.bills.filter((b) => b.status !== "paid").length;
    const overdue = d.bills.filter((b) => b.status === "overdue").length;
    parts.push(`${d.bills.length} bill${d.bills.length === 1 ? "" : "s"}${overdue ? `, ${overdue} overdue` : open === 0 ? ", paid" : ""}`);
  }
  return parts.join(", ");
}

/**
 * A month calendar for Insights. Cells are tinted by that day's spending and carry a dot per
 * bill; tapping one opens a panel with the day's transactions and bills and two ways to enter
 * something on that date. The bills half follows the Bills switch in Features.
 */
export function MoneyCalendar({ now }: { now?: Date }) {
  const txs = useFinance((s) => s.transactions);
  const allBills = useFinance((s) => s.bills);
  const cats = useFinance((s) => s.categories);
  const hidden = useFinance((s) => s.prefs.hideAmounts);
  const billsOn = useFinance((s) => s.prefs.features.bills);
  const { open } = useTxSheet();
  const [clock] = useState(() => now ?? new Date());
  const [cursor, setCursor] = useState(() => istMonthOf(clock));
  const [picked, setPicked] = useState<DayKey | null>(null);
  const [billForm, setBillForm] = useState<{ bill?: Bill; date?: string } | null>(null);

  const bills = useMemo<Bill[]>(() => (billsOn ? allBills : []), [billsOn, allBills]);
  const grid = useMemo(() => buildMonthGrid(txs, bills, cursor.year, cursor.month, clock), [txs, bills, cursor, clock]);
  const monthName = new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" });
  const current = istMonthOf(clock);
  const onCurrent = cursor.year === current.year && cursor.month === current.month;
  const day = picked ? grid.days.find((d) => d.key === picked) ?? null : null;

  const go = (delta: number) => setCursor((c) => shiftMonth(c.year, c.month, delta));
  const addTx = (key: DayKey) => {
    setPicked(null);
    open(undefined, { date: entryTimeForDay(key, clock) });
  };
  const addBill = (key: DayKey) => {
    setPicked(null);
    setBillForm({ date: entryTimeForDay(key, clock) });
  };
  const editTx = (t: Transaction) => {
    setPicked(null);
    open(t);
  };
  const editBill = (b: Bill) => {
    setPicked(null);
    setBillForm({ bill: b });
  };

  return (
    <Panel className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Calendar</h2>
        <Button size="sm" variant="secondary" className="h-9 rounded-full px-4" onClick={() => setCursor(current)} disabled={onCurrent}>Today</Button>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => go(-1)} aria-label="Previous month" className="grid size-11 touch-manipulation place-items-center rounded-full bg-muted"><ChevronLeft className="size-5" /></button>
        <div className="text-center" aria-live="polite">
          <p className="font-display text-base font-semibold">{monthName} {cursor.year}</p>
          <p className="text-xs text-muted-foreground">
            Spent <Amount value={Math.max(0, grid.totals.spent)} className="text-xs" />
            {grid.totals.income > 0 && <> · Income <Amount value={grid.totals.income} className="text-xs text-income" /></>}
          </p>
          {billsOn && grid.totals.billsDue > 0 && (
            <p className="text-xs text-muted-foreground">
              Bills due <Amount value={grid.totals.billsDue} className="text-xs" />
              {grid.totals.overdue > 0 && <span className="text-expense"> · <Amount value={grid.totals.overdue} className="text-xs text-expense" /> overdue</span>}
            </p>
          )}
        </div>
        <button type="button" onClick={() => go(1)} aria-label="Next month" className="grid size-11 touch-manipulation place-items-center rounded-full bg-muted"><ChevronRight className="size-5" /></button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground" aria-hidden>
        {WEEK.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1" role="group" aria-label={`${monthName} ${cursor.year}`}>
        {grid.weeks.flat().map((d, i) => {
          if (!d) return <span key={`e${i}`} aria-hidden />;
          const pct = Math.max(0, d.spent) / grid.maxSpent;
          const shown = billsOn ? d.bills : [];
          return (
            <motion.button
              key={d.key} type="button" whileTap={{ scale: 0.9 }} onClick={() => setPicked(d.key)}
              aria-label={cellLabel(d, monthName, hidden, billsOn)}
              className={cn("relative flex aspect-square min-h-10 touch-manipulation flex-col items-center justify-center gap-px rounded-xl text-sm", d.isToday && "ring-2 ring-primary")}
              style={d.spent > 0 ? { backgroundColor: `color-mix(in oklab, var(--color-primary) ${Math.round(10 + pct * 55)}%, transparent)`, color: pct > 0.6 ? "var(--color-primary-foreground)" : undefined } : undefined}
            >
              <span className="font-medium tnum leading-none">{d.day}</span>
              {!hidden && d.spent > 0 && <span className="text-[9px] leading-none tnum opacity-80">{compactINR(d.spent)}</span>}
              {d.income > 0 && <span aria-hidden className="absolute left-1 top-0.5 text-[10px] font-bold leading-none text-income">+</span>}
              {shown.length > 0 && (
                <span className="flex gap-0.5" aria-hidden>
                  {shown.slice(0, 3).map((b, k) => <span key={`${b.bill.id}${k}`} className={cn("size-1.5 rounded-full", STATUS_DOT[b.status])} />)}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Darker days spent more. <span className="text-income font-semibold">+</span> income.
        {billsOn && <> Dots are bills: <span className="text-expense">red</span> overdue, <span className="text-marigold">gold</span> due, <span className="text-income">green</span> paid.</>} Tap a day to add or see its entries.
      </p>

      <BottomSheet open={!!day} onClose={() => setPicked(null)} title={picked ? longDay(picked) : ""}>
        {day && (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              {day.count === 0 ? "Nothing recorded" : <>Spent <Amount value={Math.max(0, day.spent)} className="text-sm" />{day.income > 0 && <> · Income <Amount value={day.income} className="text-sm text-income" /></>}</>}
            </p>

            <div className="space-y-1">
              <p className="px-1 text-xs font-medium text-muted-foreground">Transactions</p>
              {day.txs.length === 0 ? <Empty text="No transactions on this day." /> : (
                <ul className="space-y-1">
                  {day.txs.map((t) => <TxRow key={t.id} tx={t} category={cats.find((c) => c.id === t.categoryId)} onOpen={() => editTx(t)} />)}
                </ul>
              )}
            </div>

            {billsOn && (
              <div className="space-y-1">
                <p className="px-1 text-xs font-medium text-muted-foreground">Bills</p>
                {day.bills.length === 0 ? <Empty text="No bills due on this day." /> : (
                  <ul className="space-y-2">
                    {day.bills.map((b, i) => <BillRow key={`${b.bill.id}${i}`} b={b} onEdit={() => editBill(b.bill)} />)}
                  </ul>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <Button type="button" className="h-12 rounded-2xl" onClick={() => addTx(day.key)}><Plus className="size-4" />Add transaction on this day</Button>
              {billsOn && <Button type="button" variant="secondary" className="h-12 rounded-2xl" onClick={() => addBill(day.key)}><BellRing className="size-4" />Add bill due this day</Button>}
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={!!billForm} onClose={() => setBillForm(null)} title={billForm?.bill ? "Edit bill" : "New bill"}>
        {billForm && <BillForm key={billForm.bill?.id ?? billForm.date ?? "new"} bill={billForm.bill} date={billForm.date} onDone={() => setBillForm(null)} />}
      </BottomSheet>
    </Panel>
  );
}

function BillRow({ b, onEdit }: { b: CalendarBill; onEdit: () => void }) {
  const { bill, status } = b;
  return (
    <li className={cn("flex items-center gap-3 rounded-2xl bg-muted/60 p-3", status === "paid" && "opacity-70")}>
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 touch-manipulation text-left" aria-label={`Edit ${bill.name}`}>
        <p className="truncate font-medium">{bill.name}</p>
        <p className={cn("text-xs", STATUS_TEXT[status])}>{STATUS_LABEL[status]}{bill.repeat !== "none" ? ` · ${bill.repeat}` : ""}</p>
      </button>
      <div className="flex flex-col items-end gap-1">
        <Amount value={bill.amount} />
        {b.isNext && status !== "paid" && (
          <Button type="button" size="sm" variant="secondary" className="h-8 rounded-full px-3 text-xs"
            onClick={() => { actions.payBill(bill.id); toast.success(`${bill.name} marked paid`, { description: "Recorded as an expense" }); }}>Mark paid</Button>
        )}
      </div>
    </li>
  );
}
