import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { actions, useFinance } from "@/lib/finance/store";
import type { Bill, Repeat } from "@/lib/finance/types";
import { Chips, Field } from "@/components/app/sheet";
import { Button } from "@/components/ui/button";

/** Add or edit a bill. Shared by the Bills screen and the money calendar. `date` (ISO) prefills the due date of a new bill. */
export function BillForm({ bill, date, onDone }: { bill?: Bill; date?: string; onDone: () => void }) {
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
